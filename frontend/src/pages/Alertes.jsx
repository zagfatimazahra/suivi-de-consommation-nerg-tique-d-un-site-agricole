import { useState, useEffect, useRef, useCallback } from "react";
import {
  Bell, AlertTriangle, ShieldCheck, Settings,
  Target, Clock, Leaf, History, Save, X,
  CheckCircle, XCircle, Sun, TrendingUp, Zap
} from "lucide-react";

const API = "http://localhost:8000";

const theme = {
  bg:      "#0a0f1e",
  card:    "#111827",
  border:  "#1f2937",
  accent:  "#10b981",
  accent2: "#3b82f6",
  danger:  "#ef4444",
  warning: "#f59e0b",
  text:    "#f9fafb",
  muted:   "#6b7280",
};

function formatEnergie(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "--";
  if (kwh === 0) return "0.00 kWh";
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${Number(kwh).toFixed(2)} kWh`;
}

const SEUILS_DEFAUT_SITE = {
  tension_min:         207,
  tension_max:         233,
  courant_max:         200,
  puissance_max:       160,
  puissance_souscrite: 50,
  fp_min:              0.85,
  objectif_mensuel:    10,
  co2_max_jour:        100,
  co2_max_mois:        3000,
};

// ⭐ co2_evite_min_jour / co2_evite_min_mois retires : ils n'etaient jamais
// utilises dans verifierAlertes/alertesActives (decoratifs, sans effet).
const SEUILS_DEFAUT_SOLAIRE = {
  tension_min:           195,
  tension_max:           250,
  courant_max:           100,
  puissance_min:         1,
  fp_min:                0.80,
  objectif_production:   8,
};

export default function Alertes({ source }) {
  const isSolaire = source === "solaire";

  const [realtime,       setRealtime]       = useState(null);
  const [seuils,         setSeuils]         = useState(isSolaire ? SEUILS_DEFAUT_SOLAIRE : SEUILS_DEFAUT_SITE);
  const [historique,     setHistorique]     = useState([]);
  const [editMode,       setEditMode]       = useState(false);
  const [tempSeuils,     setTempSeuils]     = useState(isSolaire ? SEUILS_DEFAUT_SOLAIRE : SEUILS_DEFAUT_SITE);
  const [cout,           setCout]           = useState(null);
  const [bilan24,        setBilan24]        = useState(null);
  const [bilan30,        setBilan30]        = useState(null);
  const [changingSource, setChangingSource] = useState(false);

  const seuilsRef = useRef(seuils);
  useEffect(() => { seuilsRef.current = seuils; }, [seuils]);

  // Reset au changement de source
  useEffect(() => {
    setChangingSource(true);
    const defaut = isSolaire ? SEUILS_DEFAUT_SOLAIRE : SEUILS_DEFAUT_SITE;
    setSeuils(defaut);
    setTempSeuils(defaut);
    setHistorique([]);
    setRealtime(null);
    setCout(null);
    const t = setTimeout(() => setChangingSource(false), 300);
    return () => clearTimeout(t);
  }, [source]);

  // ✅ verifierAlertes — alimente l'historique
  const verifierAlertes = useCallback((data, coutData) => {
    const s   = seuilsRef.current;
    const now = new Date().toLocaleTimeString();
    const nouvelles = [];

    if (isSolaire) {
      if (data.tension < s.tension_min || data.tension > s.tension_max)
        nouvelles.push({ type: "danger",  message: `Tension onduleur hors plage : ${data.tension?.toFixed(2)}V (plage: ${s.tension_min}-${s.tension_max}V)`, time: now });
      if (data.puissance_active < s.puissance_min && data.puissance_active > 0)
        nouvelles.push({ type: "warning", message: `Production faible : ${data.puissance_active?.toFixed(2)} kW (min: ${s.puissance_min} kW)`, time: now });
      // ⭐ Nouveau : courant max
      if (data.courant > s.courant_max)
        nouvelles.push({ type: "danger",  message: `Courant onduleur eleve : ${data.courant?.toFixed(2)}A (max: ${s.courant_max}A)`, time: now });
      // ⭐ Nouveau : facteur de puissance min
      if (data.facteur_puissance !== -1 && data.facteur_puissance < s.fp_min)
        nouvelles.push({ type: "warning", message: `Facteur puissance onduleur bas : ${data.facteur_puissance?.toFixed(2)} (min: ${s.fp_min})`, time: now });
    } else {
      if (data.tension < s.tension_min)
        nouvelles.push({ type: "danger",  message: `Tension basse : ${data.tension?.toFixed(2)}V (min: ${s.tension_min}V)`, time: now });
      if (data.tension > s.tension_max)
        nouvelles.push({ type: "danger",  message: `Tension haute : ${data.tension?.toFixed(2)}V (max: ${s.tension_max}V)`, time: now });
      if (data.courant > s.courant_max)
        nouvelles.push({ type: "danger",  message: `Courant eleve : ${data.courant?.toFixed(2)}A (max: ${s.courant_max}A)`, time: now });
      if (data.puissance_active > s.puissance_max)
        nouvelles.push({ type: "warning", message: `Puissance elevee : ${data.puissance_active?.toFixed(2)}kW (max: ${s.puissance_max}kW)`, time: now });
      if (data.facteur_puissance !== -1 && data.facteur_puissance < s.fp_min)
        nouvelles.push({ type: "warning", message: `Facteur puissance bas : ${data.facteur_puissance?.toFixed(2)} (min: ${s.fp_min})`, time: now });
      // ✅ Alerte dépassement puissance souscrite
      if (data.puissance_apparente > s.puissance_souscrite)
        nouvelles.push({ type: "danger",  message: `DEPASSEMENT puissance souscrite : ${data.puissance_apparente?.toFixed(2)} kVA > ${s.puissance_souscrite} kVA — Penalite ONEE !`, time: now });
      if (coutData?.co2_jour > s.co2_max_jour)
        nouvelles.push({ type: "warning", message: `CO2 jour eleve : ${coutData.co2_jour} kg (max: ${s.co2_max_jour} kg)`, time: now });
      if (coutData?.co2_mois > s.co2_max_mois)
        nouvelles.push({ type: "danger",  message: `CO2 mois depasse : ${coutData.co2_mois} kg (max: ${s.co2_max_mois} kg)`, time: now });
    }

    if (nouvelles.length > 0)
      setHistorique(prev => [...nouvelles, ...prev].slice(0, 20));
  }, [isSolaire]);

  // Fetch données toutes les 5 secondes
  useEffect(() => {
    const fetchRealtime = async () => {
      try {
        const [data, coutData, b24, b30] = await Promise.all([
          fetch(`${API}/api/realtime?source=${source}`).then(r => r.json()),
          fetch(`${API}/api/cout?source=${source}&periode=24h`).then(r => r.json()),
          isSolaire ? Promise.resolve(null) : fetch(`${API}/api/bilan?periode=24h`).then(r => r.json()),
          isSolaire ? Promise.resolve(null) : fetch(`${API}/api/bilan?periode=30d`).then(r => r.json()),
        ]);
        const coutFinal = coutData.erreur ? null : coutData;
        const b24f = b24?.erreur ? null : b24;
        const b30f = b30?.erreur ? null : b30;
        setCout(coutFinal);
        setBilan24(b24f);
        setBilan30(b30f);
        const coutAlertes = isSolaire ? coutFinal : (coutFinal && {
          ...coutFinal,
          co2_jour: b24f?.co2_reseau ?? coutFinal.co2_jour,
          co2_mois: b30f?.co2_reseau ?? coutFinal.co2_mois,
        });
        if (!data.error) {
          setRealtime(data);
          verifierAlertes(data, coutAlertes);
        }
      } catch(e) { console.error(e); }
    };

    fetchRealtime();
    const interval = setInterval(fetchRealtime, 5000);
    return () => clearInterval(interval);
  }, [source, verifierAlertes]);

  // Re-vérifier quand seuils changent
  useEffect(() => {
    if (realtime && cout) verifierAlertes(realtime, cout);
  }, [seuils]);

  // ✅ Alertes actives temps réel
  const alertesActives = [];
  if (realtime) {
    if (isSolaire) {
      if (realtime.tension < seuils.tension_min || realtime.tension > seuils.tension_max)
        alertesActives.push({ type: "danger",  label: "Tension onduleur hors plage", value: `${realtime.tension?.toFixed(2)} V` });
      if (realtime.puissance_active < seuils.puissance_min && realtime.puissance_active > 0)
        alertesActives.push({ type: "warning", label: "Production faible",            value: `${realtime.puissance_active?.toFixed(2)} kW` });
      // ⭐ Nouveau : courant max
      if (realtime.courant > seuils.courant_max)
        alertesActives.push({ type: "danger",  label: "Courant onduleur eleve",       value: `${realtime.courant?.toFixed(2)} A` });
      // ⭐ Nouveau : facteur de puissance min
      if (realtime.facteur_puissance !== -1 && realtime.facteur_puissance < seuils.fp_min)
        alertesActives.push({ type: "warning", label: "Facteur puissance onduleur bas", value: realtime.facteur_puissance?.toFixed(2) });
    } else {
      if (realtime.tension < seuils.tension_min || realtime.tension > seuils.tension_max)
        alertesActives.push({ type: "danger",  label: "Tension hors plage",           value: `${realtime.tension?.toFixed(2)} V` });
      if (realtime.courant > seuils.courant_max)
        alertesActives.push({ type: "danger",  label: "Courant eleve",                value: `${realtime.courant?.toFixed(2)} A` });
      if (realtime.puissance_active > seuils.puissance_max)
        alertesActives.push({ type: "warning", label: "Puissance elevee",             value: `${realtime.puissance_active?.toFixed(2)} kW` });
      if (realtime.facteur_puissance !== -1 && realtime.facteur_puissance < seuils.fp_min)
        alertesActives.push({ type: "warning", label: "Facteur puissance bas",        value: realtime.facteur_puissance?.toFixed(2) });
      // ✅ Alerte dépassement puissance souscrite 50 kVA
      if (realtime.puissance_apparente > seuils.puissance_souscrite)
        alertesActives.push({ type: "danger",  label: "DEPASSEMENT puissance souscrite !", value: `${realtime.puissance_apparente?.toFixed(2)} kVA > ${seuils.puissance_souscrite} kVA` });
      const co2JourReseau = bilan24?.co2_reseau;
      const co2MoisReseau = bilan30?.co2_reseau;
      if (co2JourReseau > seuils.co2_max_jour)
        alertesActives.push({ type: "warning", label: "CO2 jour eleve",               value: `${co2JourReseau} kg` });
      if (co2MoisReseau > seuils.co2_max_mois)
        alertesActives.push({ type: "danger",  label: "CO2 mois depasse",             value: `${co2MoisReseau} kg` });
    }
  }

  const seuilsConfig = isSolaire ? [
    { key: "tension_min",         label: "Tension min onduleur (V)"       },
    { key: "tension_max",         label: "Tension max onduleur (V)"       },
    { key: "courant_max",         label: "Courant max (A)"                },
    { key: "puissance_min",       label: "Production min (kW)"            },
    { key: "fp_min",              label: "Facteur puissance min"          },
    { key: "objectif_production", label: "Objectif production (MWh/mois)" },
  ] : [
    { key: "tension_min",         label: "Tension min (V)"               },
    { key: "tension_max",         label: "Tension max (V)"               },
    { key: "courant_max",         label: "Courant max (A)"               },
    { key: "puissance_max",       label: "Puissance max (kW)"            },
    { key: "puissance_souscrite", label: "Puissance souscrite (kVA)"     },
    { key: "fp_min",              label: "Facteur puissance min"         },
    { key: "objectif_mensuel",    label: "Objectif mensuel (MWh)"        },
    { key: "co2_max_jour",        label: "CO2 max jour (kg)"             },
    { key: "co2_max_mois",        label: "CO2 max mois (kg)"             },
  ];

  return (
    <div style={{ color: theme.text }}>

      {/* TITRE */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: isSolaire ? "rgba(245,158,11,0.15)" : "rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isSolaire ? <Sun size={18} color="#f59e0b" /> : <Bell size={18} color="#ef4444" />}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 }}>
            {isSolaire ? "Surveillance Production Solaire" : "Alertes et Objectifs"}
          </h2>
        </div>
        <p style={{ color: theme.muted, fontSize: 13, margin: 0, paddingLeft: 46 }}>
          {isSolaire ? "Surveillance de la production et des panneaux solaires" : "Surveillance en temps reel et gestion des seuils"}
        </p>
      </div>

      {/* ALERTES ACTIVES */}
      <div style={{
        background: alertesActives.length > 0 ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
        border: `1px solid ${alertesActives.length > 0 ? "rgba(239,68,68,0.3)" : "rgba(16,185,129,0.3)"}`,
        borderRadius: 14, padding: 16, marginBottom: 20,
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: alertesActives.length > 0 ? 12 : 0, color: alertesActives.length > 0 ? theme.danger : theme.accent, display: "flex", alignItems: "center", gap: 8 }}>
          {alertesActives.length > 0 ? <AlertTriangle size={16} color="#ef4444" /> : <ShieldCheck size={16} color="#10b981" />}
          {alertesActives.length > 0
            ? `${alertesActives.length} alerte(s) active(s)`
            : isSolaire ? "Production normale — tout est normal" : "Aucune alerte — tout est normal"
          }
        </div>
        {alertesActives.map((a, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: a.type === "danger" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 6, fontSize: 13,
            border: `1px solid ${a.type === "danger" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)"}`,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {a.type === "danger" ? <XCircle size={14} color="#ef4444" /> : <AlertTriangle size={14} color="#f59e0b" />}
              <span style={{ color: a.type === "danger" ? "#fca5a5" : "#fde68a" }}>{a.label}</span>
            </div>
            <span style={{ color: "white", fontWeight: 600 }}>{a.value}</span>
          </div>
        ))}
      </div>

      {/* ✅ Indicateur puissance souscrite temps réel */}
      {!isSolaire && realtime && (
        <div style={{
          background: realtime.puissance_apparente > seuils.puissance_souscrite
            ? "rgba(239,68,68,0.08)" : "rgba(16,185,129,0.08)",
          border: `1px solid ${realtime.puissance_apparente > seuils.puissance_souscrite
            ? "rgba(239,68,68,0.2)" : "rgba(16,185,129,0.2)"}`,
          borderRadius: 14, padding: 16, marginBottom: 20,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Zap size={16} color={realtime.puissance_apparente > seuils.puissance_souscrite ? "#ef4444" : "#10b981"} />
            <span style={{ fontWeight: 600, fontSize: 14, color: realtime.puissance_apparente > seuils.puissance_souscrite ? theme.danger : theme.accent }}>
              Surveillance puissance souscrite ONEE
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: theme.muted, fontSize: 12 }}>Puissance apparente actuelle</span>
            <span style={{ color: realtime.puissance_apparente > seuils.puissance_souscrite ? "#ef4444" : theme.text, fontWeight: 700, fontSize: 14 }}>
              {realtime.puissance_apparente?.toFixed(2)} kVA
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ color: theme.muted, fontSize: 12 }}>Puissance souscrite (contrat ONEE)</span>
            <span style={{ color: theme.accent, fontWeight: 700, fontSize: 14 }}>{seuils.puissance_souscrite} kVA</span>
          </div>
          {/* Barre progression */}
          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 10, overflow: "hidden", marginBottom: 6 }}>
            <div style={{
              height: "100%",
              width: `${Math.min((realtime.puissance_apparente / seuils.puissance_souscrite) * 100, 100)}%`,
              background: realtime.puissance_apparente > seuils.puissance_souscrite
                ? "linear-gradient(90deg, #ef4444, #dc2626)"
                : realtime.puissance_apparente > seuils.puissance_souscrite * 0.85
                  ? "linear-gradient(90deg, #f59e0b, #d97706)"
                  : "linear-gradient(90deg, #10b981, #059669)",
              borderRadius: 6, transition: "width 0.5s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: theme.muted }}>
            <span>
              {realtime.puissance_apparente > seuils.puissance_souscrite
                ? `Depassement : +${(realtime.puissance_apparente - seuils.puissance_souscrite).toFixed(2)} kVA`
                : `Marge disponible : ${(seuils.puissance_souscrite - realtime.puissance_apparente).toFixed(2)} kVA`
              }
            </span>
            <span>{Math.min((realtime.puissance_apparente / seuils.puissance_souscrite) * 100, 100).toFixed(1)}% utilise</span>
          </div>
          {realtime.puissance_apparente > seuils.puissance_souscrite && (
            <div style={{ marginTop: 10, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 8, padding: "8px 12px" }}>
              <span style={{ color: "#fca5a5", fontSize: 12 }}>
                Penalite ONEE estimee : {((realtime.puissance_apparente - seuils.puissance_souscrite) * 54.30375 * 1.18).toFixed(2)} DH
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

        {/* SEUILS */}
        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Settings size={16} color={theme.muted} />
              <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Seuils de surveillance</h3>
            </div>
            <button onClick={() => { setEditMode(!editMode); setTempSeuils(seuils); }} style={{
              background: editMode ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.15)",
              color: editMode ? theme.danger : theme.accent2,
              border: `1px solid ${editMode ? "rgba(239,68,68,0.3)" : "rgba(59,130,246,0.3)"}`,
              borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600,
              display: "flex", alignItems: "center", gap: 5,
            }}>
              {editMode ? <><X size={12} /> Annuler</> : <><Settings size={12} /> Modifier</>}
            </button>
          </div>
          {seuilsConfig.map(item => (
            <div key={item.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <span style={{ color: theme.muted, fontSize: 12 }}>{item.label}</span>
              {editMode ? (
                <input
                  type="number"
                  step={item.key === "objectif_mensuel" || item.key === "objectif_production" ? "0.1" : "any"}
                  value={tempSeuils[item.key]}
                  onChange={e => setTempSeuils({ ...tempSeuils, [item.key]: parseFloat(e.target.value) })}
                  style={{ background: "rgba(255,255,255,0.05)", color: theme.text, border: "1px solid rgba(16,185,129,0.4)", borderRadius: 6, padding: "4px 8px", width: 80, fontSize: 12, outline: "none" }}
                />
              ) : (
                <span style={{ color: isSolaire ? "#f59e0b" : theme.accent, fontWeight: 600, fontSize: 13 }}>{seuils[item.key]}</span>
              )}
            </div>
          ))}
          {editMode && (
            <button onClick={() => { setSeuils(tempSeuils); setEditMode(false); }} style={{
              background: "linear-gradient(135deg, #10b981, #059669)", color: "white", border: "none",
              borderRadius: 10, padding: "10px 20px", fontSize: 13, cursor: "pointer", fontWeight: 600,
              marginTop: 14, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            }}>
              <Save size={14} /> Sauvegarder
            </button>
          )}
        </div>

        {/* OBJECTIF */}
        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            {isSolaire ? <Sun size={16} color="#f59e0b" /> : <Target size={16} color="#10b981" />}
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>
              {isSolaire ? "Objectif de production" : "Objectif mensuel"}
            </h3>
          </div>
          <div style={{ textAlign: "center", marginBottom: 20 }}>
            <div style={{ color: theme.muted, fontSize: 12, marginBottom: 6 }}>Objectif fixe</div>
            <div style={{ color: isSolaire ? "#f59e0b" : theme.accent, fontSize: 44, fontWeight: 700, lineHeight: 1 }}>
              {isSolaire ? seuils.objectif_production : seuils.objectif_mensuel}
            </div>
            <div style={{ color: theme.muted, fontSize: 13, marginTop: 4 }}>
              MWh / mois {isSolaire ? "produits" : "consommes"}
            </div>
          </div>

          <div style={{ color: theme.muted, fontSize: 12, marginBottom: 8 }}>
            {isSolaire ? "Produit ce mois (estime)" : "Consomme ce mois (estime)"}
          </div>
          <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 8, height: 10, overflow: "hidden", marginBottom: 8 }}>
            <div style={{
              height: "100%",
              width: `${Math.min(((cout?.kwh_mois || 0) / 1000 / (isSolaire ? seuils.objectif_production : seuils.objectif_mensuel)) * 100, 100)}%`,
              background: isSolaire
                ? "linear-gradient(90deg, #f59e0b, #d97706)"
                : (cout?.kwh_mois || 0) / 1000 > seuils.objectif_mensuel
                  ? "linear-gradient(90deg, #ef4444, #dc2626)"
                  : "linear-gradient(90deg, #10b981, #059669)",
              borderRadius: 8, transition: "width 0.5s ease",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: theme.muted, marginBottom: 14 }}>
            <span>{formatEnergie(cout?.kwh_mois)}</span>
            <span style={{ color: isSolaire ? "#f59e0b" : theme.accent, fontWeight: 600 }}>
              {Math.min(((cout?.kwh_mois || 0) / 1000 / (isSolaire ? seuils.objectif_production : seuils.objectif_mensuel)) * 100, 100).toFixed(1)}%
            </span>
          </div>

          <div style={{ background: isSolaire ? "rgba(245,158,11,0.08)" : "rgba(16,185,129,0.08)", border: `1px solid ${isSolaire ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.15)"}`, borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Leaf size={12} color={isSolaire ? "#f59e0b" : "#10b981"} />
              <div style={{ color: theme.muted, fontSize: 11 }}>{isSolaire ? "CO2 evite" : "Impact CO2 (reseau)"}</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: theme.muted }}>Aujourd hui</span>
              <span style={{ color: isSolaire ? "#f59e0b" : theme.accent, fontWeight: 600 }}>{isSolaire ? (cout?.co2_jour ?? "--") : (bilan24?.co2_reseau ?? "--")} kg</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
              <span style={{ color: theme.muted }}>Ce mois (30j)</span>
              <span style={{ color: isSolaire ? "#f59e0b" : theme.accent, fontWeight: 600 }}>{isSolaire ? (cout?.co2_mois ?? "--") : (bilan30?.co2_reseau ?? "--")} kg</span>
            </div>
          </div>
        </div>
      </div>

      {/* HISTORIQUE */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <History size={16} color={theme.muted} />
          <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Historique des alertes</h3>
          {historique.length > 0 && (
            <span style={{ background: "rgba(239,68,68,0.15)", color: theme.danger, fontSize: 11, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>
              {historique.length}
            </span>
          )}
        </div>

        {changingSource ? (
          <div style={{ textAlign: "center", color: theme.muted, padding: "30px 0", fontSize: 13 }}>
            Chargement...
          </div>
        ) : historique.length === 0 ? (
          <div style={{ textAlign: "center", color: theme.muted, padding: "30px 0", fontSize: 13, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px dashed rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <CheckCircle size={24} color="#374151" />
            Aucune alerte detectee depuis le demarrage
          </div>
        ) : (
          historique.map((a, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "10px 14px", borderRadius: 10, marginBottom: 6, fontSize: 12,
              background: a.type === "danger" ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${a.type === "danger" ? "rgba(239,68,68,0.15)" : "rgba(245,158,11,0.15)"}`,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {a.type === "danger" ? <XCircle size={13} color="#ef4444" /> : <AlertTriangle size={13} color="#f59e0b" />}
                <span style={{ color: a.type === "danger" ? "#fca5a5" : "#fde68a" }}>{a.message}</span>
              </div>
              <span style={{ color: theme.muted, marginLeft: 12, whiteSpace: "nowrap", fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={10} /> {a.time}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
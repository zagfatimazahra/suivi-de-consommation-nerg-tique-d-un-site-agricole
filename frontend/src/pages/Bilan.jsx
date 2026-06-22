import { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, LineChart, Line
} from "recharts";
import {
  Zap, Sun, TrendingUp, DollarSign, Leaf,
  Battery, RefreshCw, Calendar, Clock,
  TreePine, Search, BarChart2, Activity
} from "lucide-react";

const API = "http://localhost:8000";

const theme = {
  bg:      "#0a0f1e",
  card:    "#111827",
  border:  "#1f2937",
  accent:  "#10b981",
  accent2: "#3b82f6",
  warning: "#f59e0b",
  text:    "#f9fafb",
  muted:   "#6b7280",
};

const PERIODES = [
  { value: "24h", label: "24 heures" },
  { value: "7d",  label: "7 jours"   },
  { value: "30d", label: "30 jours"  },
];

function formatEnergie(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "--";
  if (kwh === 0) return "0.00 kWh";
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${Number(kwh).toFixed(2)} kWh`;
}

function formatEnergieVal(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "--";
  if (kwh === 0) return "0.00";
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)}`;
  return `${Number(kwh).toFixed(2)}`;
}

function formatEnergieUnit(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "kWh";
  if (kwh >= 1000) return "MWh";
  return "kWh";
}

// ✅ Format heure correct — UTC+1 Maroc
function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth()+1}`;
}

// ✅ Tooltip professionnel date complète
function formatDateHeure(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const jour  = d.getDate().toString().padStart(2, "0");
  const mois  = (d.getMonth() + 1).toString().padStart(2, "0");
  const annee = d.getFullYear();
  const hh    = d.getHours().toString().padStart(2, "0");
  const mm    = d.getMinutes().toString().padStart(2, "0");
  return `${jour}/${mois}/${annee} ${hh}:${mm}`;
}

function TooltipPro({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
      <div style={{ color: "#9ca3af", marginBottom: 6, fontWeight: 600, fontSize: 11 }}>
        {formatDateHeure(label)}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || "#10b981", fontWeight: 600, marginBottom: 2 }}>
          {p.name} : {formatEnergie(p.value)}
        </div>
      ))}
    </div>
  );
}

function calculProjectionAnnuelle(economies, periode) {
  if (!economies) return "--";
  const joursParPeriode = { "24h": 1, "7d": 7, "30d": 30 };
  const jours   = joursParPeriode[periode] ?? 1;
  const parJour = economies / jours;
  return (parJour * 365).toFixed(2);
}

function CartePeriode({ label, sublabel, kwh, cout, tarif, pct, color }) {
  return (
    <div style={{ background: `${color}10`, border: `1px solid ${color}25`, borderRadius: 12, padding: 16 }}>
      <div style={{ color, fontWeight: 700, fontSize: 13, marginBottom: 2 }}>{label}</div>
      <div style={{ color: theme.muted, fontSize: 10, marginBottom: 12 }}>{sublabel}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: theme.muted, fontSize: 11 }}>Energie reseau</span>
        <span style={{ color: theme.text, fontWeight: 600, fontSize: 12 }}>{formatEnergie(kwh)}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ color: theme.muted, fontSize: 11 }}>Cout TTC</span>
        <span style={{ color, fontWeight: 700, fontSize: 15 }}>{cout?.toFixed(2) ?? "--"} DH</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ color: theme.muted, fontSize: 11 }}>Tarif TTC</span>
        <span style={{ color: theme.muted, fontSize: 11 }}>{tarif} DH/kWh</span>
      </div>
      <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 4, height: 6, overflow: "hidden", marginBottom: 4 }}>
        <div style={{ height: "100%", width: `${Math.min(pct || 0, 100)}%`, background: color, borderRadius: 4, transition: "width 0.5s ease" }} />
      </div>
      <div style={{ color: theme.muted, fontSize: 10, textAlign: "right" }}>{pct ?? 0}% du total</div>
    </div>
  );
}

export default function Bilan() {
  const [periode,       setPeriode]       = useState("24h");
  const [dateDebut,     setDateDebut]     = useState("");
  const [dateFin,       setDateFin]       = useState("");
  const [bilan,         setBilan]         = useState(null);
  const [historique,    setHistorique]    = useState([]);
  const [bilanCout,     setBilanCout]     = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [loadingDate,   setLoadingDate]   = useState(false);
  const [filtreActif,   setFiltreActif]   = useState(false);

  const fetchBilan = async (p = periode) => {
    setLoading(true);
    try {
      const [bilanData, histData, coutData] = await Promise.all([
        fetch(`${API}/api/bilan?periode=${p}`).then(r => r.json()),
        fetch(`${API}/api/bilan/historique?periode=${p}`).then(r => r.json()),
        fetch(`${API}/api/bilan/cout/detail?periode=${p}`).then(r => r.json()),
      ]);
      setBilan(bilanData.erreur ? null : bilanData);
      setHistorique(Array.isArray(histData) ? histData : []);
      setBilanCout(coutData.erreur ? null : coutData);
      setFiltreActif(false);
    } catch(e) { console.error(e); }
    setLoading(false);
  };

  const fetchBilanDate = async () => {
    if (!dateDebut || !dateFin || dateFin < dateDebut) return;
    setLoadingDate(true);
    try {
      const bilanData = await fetch(
        `${API}/api/bilan/daterange?date_debut=${dateDebut}&date_fin=${dateFin}`
      ).then(r => r.json());
      setBilan(bilanData.erreur ? null : bilanData);
      setFiltreActif(true);
    } catch(e) { console.error(e); }
    setLoadingDate(false);
  };

  const resetFiltre = () => {
    setFiltreActif(false);
    setDateDebut("");
    setDateFin("");
    fetchBilan();
  };

  useEffect(() => {
    if (!filtreActif) fetchBilan(periode);
  }, [periode]);

  const taux       = bilan?.taux_auto ?? 0;
  const jaugeColor = taux >= 70 ? "#10b981" : taux >= 40 ? "#f59e0b" : "#ef4444";
  const isLong     = periode === "7d" || periode === "30d" || filtreActif;

  const periodeLabel = filtreActif && dateDebut && dateFin
    ? `${dateDebut} → ${dateFin}`
    : PERIODES.find(p => p.value === periode)?.label;

  return (
    <div style={{ color: theme.text }}>

      {/* TITRE */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Zap size={18} color="#f59e0b" />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 }}>Bilan Énergétique</h2>
        </div>
        <p style={{ color: theme.muted, fontSize: 13, margin: 0, paddingLeft: 46 }}>
          Comparaison réseau électrique vs production solaire — Tarification MT ONEE
        </p>
      </div>

      {/* ✅ FILTRES — même style que Analyse.jsx — tout sur une ligne */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "16px 20px", marginBottom: 20, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>

        {/* Période */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Clock size={12} color={theme.muted} />
            <label style={{ color: theme.muted, fontSize: 12 }}>Période</label>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {PERIODES.map(p => (
              <button key={p.value} onClick={() => { setPeriode(p.value); setFiltreActif(false); }} style={{
                background: periode === p.value && !filtreActif ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.04)",
                color:      periode === p.value && !filtreActif ? "#f59e0b" : theme.muted,
                border:     `1px solid ${periode === p.value && !filtreActif ? "rgba(245,158,11,0.5)" : "rgba(255,255,255,0.08)"}`,
                borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer",
                fontWeight: periode === p.value && !filtreActif ? 600 : 400,
              }}>{p.label}</button>
            ))}
          </div>
        </div>

        {/* Séparateur */}
        <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)", alignSelf: "center" }} />

        {/* Plage de dates */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Calendar size={12} color={theme.muted} />
            <label style={{ color: theme.muted, fontSize: 12 }}>Plage de dates</label>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)}
              style={{ background: "rgba(255,255,255,0.05)", color: theme.text, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none" }}
            />
            <span style={{ color: theme.muted, fontSize: 12 }}>→</span>
            <input
              type="date" value={dateFin} onChange={e => setDateFin(e.target.value)}
              style={{ background: "rgba(255,255,255,0.05)", color: theme.text, border: `1px solid ${dateDebut && dateFin && dateFin < dateDebut ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none" }}
            />
            <button
              onClick={fetchBilanDate}
              disabled={!dateDebut || !dateFin || loadingDate || (dateFin < dateDebut)}
              style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.4)", borderRadius: 8, padding: "7px 16px", fontSize: 12, cursor: !dateDebut || !dateFin || dateFin < dateDebut ? "not-allowed" : "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: dateDebut && dateFin && dateFin < dateDebut ? 0.5 : 1 }}
            >
              <Search size={13} />{loadingDate ? "Chargement..." : "Filtrer"}
            </button>
            {filtreActif && (
              <button onClick={resetFiltre} style={{ background: "rgba(255,255,255,0.04)", color: theme.muted, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                <RefreshCw size={12} /> Réinitialiser
              </button>
            )}
          </div>
          {dateDebut && dateFin && dateFin < dateDebut && (
            <div style={{ color: "#ef4444", fontSize: 11, marginTop: 4 }}>La date de fin doit être après la date de début</div>
          )}
          {filtreActif && (
            <div style={{ color: "#f59e0b", fontSize: 11, marginTop: 4 }}>{dateDebut} → {dateFin}</div>
          )}
        </div>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: theme.accent, fontSize: 12, marginLeft: "auto" }}>
            <RefreshCw size={12} /> Chargement...
          </div>
        )}
      </div>

      {/* KPI CARTES */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginBottom: 20 }}>
        {[
          { label: "Achete (ONEE)",      value: formatEnergie(bilan?.kwh_reseau),  color: "#3b82f6", Icon: Zap,        bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.2)"  },
          { label: "Produit (Solaire)",  value: formatEnergie(bilan?.kwh_solaire), color: "#f59e0b", Icon: Sun,        bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.2)"  },
          { label: "Conso. totale site", value: formatEnergie(bilan?.kwh_total),   color: "#8b5cf6", Icon: Battery,    bg: "rgba(139,92,246,0.08)",  border: "rgba(139,92,246,0.2)"  },
          { label: "Taux autoconsomm.",  value: `${bilan?.taux_auto ?? "--"} %`,   color: jaugeColor, Icon: TrendingUp, bg: `${jaugeColor}15`,       border: `${jaugeColor}30`       },
          { label: "Economies",          value: `${bilan?.economies ?? "--"} DH`,  color: "#10b981", Icon: DollarSign, bg: "rgba(16,185,129,0.08)",  border: "rgba(16,185,129,0.2)"  },
          { label: "CO2 evite",          value: `${bilan?.co2_evite ?? "--"} kg`,  color: "#10b981", Icon: Leaf,       bg: "rgba(16,185,129,0.08)",  border: "rgba(16,185,129,0.2)"  },
        ].map((item, i) => (
          <div key={i} style={{ background: item.bg, border: `1px solid ${item.border}`, borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: theme.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{item.label}</span>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: `${item.color}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <item.Icon size={15} color={item.color} />
              </div>
            </div>
            <div style={{ color: item.color, fontSize: 22, fontWeight: 700 }}>{item.value}</div>
            <div style={{ color: theme.muted, fontSize: 11 }}>{periodeLabel}</div>
          </div>
        ))}
      </div>

      {/* COUT RESEAU PAR PERIODE TARIFAIRE */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Activity size={16} color="#3b82f6" />
          </div>
          <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>
            Coût énergie réseau ONEE — Tarification MT — {periodeLabel}
          </h3>
        </div>
        {bilanCout ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 14 }}>
              <CartePeriode label="Heures Normales"  sublabel="07h-17h + 21h-23h — Lun-Sam" kwh={bilanCout.kwh_HN} cout={bilanCout.cout_HN} tarif={bilanCout.tarif_HN} pct={bilanCout.pct_HN} color="#10b981" />
              <CartePeriode label="Heures Creuses"   sublabel="23h-07h + Dimanche"           kwh={bilanCout.kwh_HC} cout={bilanCout.cout_HC} tarif={bilanCout.tarif_HC} pct={bilanCout.pct_HC} color="#3b82f6" />
              <CartePeriode label="Heures de Pointe" sublabel="17h-21h — Lun-Sam"            kwh={bilanCout.kwh_HP} cout={bilanCout.cout_HP} tarif={bilanCout.tarif_HP} pct={bilanCout.pct_HP} color="#ef4444" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <div style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, padding: 16 }}>
                <div style={{ color: theme.muted, fontSize: 12, marginBottom: 8 }}>Total coût énergie réseau — {periodeLabel}</div>
                <div style={{ color: "#3b82f6", fontWeight: 700, fontSize: 36, lineHeight: 1, marginBottom: 4 }}>{bilanCout.cout_total?.toFixed(2) ?? "--"}</div>
                <div style={{ color: theme.muted, fontSize: 13, marginBottom: 12 }}>DH TTC</div>
                <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>Énergie réseau totale : {formatEnergie(bilanCout.kwh_total)}</div>
                <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>Énergie solaire (déduite) : {formatEnergie(bilan?.kwh_solaire)}</div>
                <div style={{ color: theme.muted, fontSize: 10 }}>Distribution Moyenne Tension — TVA 18% incluse</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 16 }}>
                <div style={{ color: theme.muted, fontSize: 12, marginBottom: 10 }}>Répartition consommation réseau</div>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={[
                    { name: "HN", kwh: bilanCout.kwh_HN, cout: bilanCout.cout_HN },
                    { name: "HC", kwh: bilanCout.kwh_HC, cout: bilanCout.cout_HC },
                    { name: "HP", kwh: bilanCout.kwh_HP, cout: bilanCout.cout_HP },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis dataKey="name" tick={{ fill: theme.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ background: "#1f2937", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }} formatter={(v, name) => [name === "Énergie (kWh)" ? `${Number(v).toFixed(2)} kWh` : `${Number(v).toFixed(2)} DH`, name === "Énergie (kWh)" ? "Énergie" : "Coût"]} />
                    <Legend wrapperStyle={{ fontSize: 11, color: theme.muted }} />
                    <Bar dataKey="kwh"  fill="#10b981" radius={[4,4,0,0]} name="Énergie (kWh)" />
                    <Bar dataKey="cout" fill="#3b82f6" radius={[4,4,0,0]} name="Coût (DH)"     />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div style={{ background: "rgba(107,114,128,0.08)", border: "1px solid rgba(107,114,128,0.15)", borderRadius: 10, padding: "10px 14px" }}>
              <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4, fontWeight: 600 }}>Note — Frais fixes mensuels non inclus :</div>
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <span style={{ color: theme.muted, fontSize: 11 }}>Redevance puissance (50 kVA) : ~2 136 DH/mois TTC</span>
                <span style={{ color: theme.muted, fontSize: 11 }}>Entretien compteur : 391 DH/mois TTC</span>
                <span style={{ color: theme.muted, fontSize: 11 }}>Location compteur : 215 DH/mois TTC</span>
              </div>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", color: theme.muted, padding: "30px 0", fontSize: 13 }}>Chargement des données tarifaires...</div>
        )}
      </div>

      {/* GRAPHIQUE BARRES + JAUGE */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <BarChart2 size={16} color={theme.muted} />
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Réseau vs Solaire — {periodeLabel}</h3>
          </div>
          {historique.length === 0 ? (
            <div style={{ textAlign: "center", color: theme.muted, padding: "40px 0", fontSize: 13 }}>Aucune donnée disponible</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={historique}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="time" tickFormatter={isLong ? formatDate : formatTime} tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip content={<TooltipPro />} />
                <Legend wrapperStyle={{ fontSize: 12, color: theme.muted }} formatter={v => v === "reseau" ? "Réseau" : "Solaire"} />
                <Bar dataKey="reseau"  fill="#3b82f6" radius={[4,4,0,0]} name="reseau"  />
                <Bar dataKey="solaire" fill="#f59e0b" radius={[4,4,0,0]} name="solaire" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <Sun size={16} color="#f59e0b" />
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Taux autoconsommation</h3>
          </div>
          <div style={{ position: "relative", width: 160, height: 160, marginBottom: 16 }}>
            <svg width="160" height="160" style={{ transform: "rotate(-90deg)" }}>
              <circle cx="80" cy="80" r="65" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="12" />
              <circle cx="80" cy="80" r="65" fill="none" stroke={jaugeColor} strokeWidth="12"
                strokeDasharray={`${2 * Math.PI * 65}`}
                strokeDashoffset={`${2 * Math.PI * 65 * (1 - Math.min(taux, 100) / 100)}`}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.8s ease", filter: `drop-shadow(0 0 8px ${jaugeColor})` }}
              />
            </svg>
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
              <div style={{ color: jaugeColor, fontSize: 32, fontWeight: 700, lineHeight: 1 }}>{taux.toFixed(1)}</div>
              <div style={{ color: theme.muted, fontSize: 13, marginTop: 4 }}>%</div>
            </div>
          </div>
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: theme.muted }}>Solaire utilisé</span>
              <span style={{ color: "#f59e0b", fontWeight: 600 }}>{formatEnergie(bilan?.kwh_solaire)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span style={{ color: theme.muted }}>Acheté ONEE</span>
              <span style={{ color: "#3b82f6", fontWeight: 600 }}>{formatEnergie(bilan?.kwh_reseau)}</span>
            </div>
            <div style={{ marginTop: 8 }}>
              <div style={{ color: theme.muted, fontSize: 11, marginBottom: 6 }}>Couverture solaire</div>
              <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min(taux, 100)}%`, background: `linear-gradient(90deg, ${jaugeColor}, ${jaugeColor}aa)`, borderRadius: 6, transition: "width 0.8s ease" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: theme.muted, marginTop: 4 }}>
                <span>{taux.toFixed(1)}% solaire</span>
                <span>{(100 - taux).toFixed(1)}% réseau</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* BILAN FINANCIER + CO2 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <DollarSign size={16} color="#f59e0b" />
            </div>
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Bilan financier</h3>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              { label: `HN ${bilan?.tarif_HN ?? "1.010"}`, color: "#10b981" },
              { label: `HC ${bilan?.tarif_HC ?? "0.740"}`, color: "#3b82f6" },
              { label: `HP ${bilan?.tarif_HP ?? "1.416"}`, color: "#ef4444" },
            ].map((t, i) => (
              <span key={i} style={{ background: `${t.color}15`, color: t.color, fontSize: 10, padding: "2px 8px", borderRadius: 20, border: `1px solid ${t.color}30`, fontWeight: 600 }}>
                {t.label} DH/kWh
              </span>
            ))}
          </div>
          {[
            { label: "Coût sans solaire",   value: `${bilan?.cout_sans ?? "--"} DH`,  color: "#ef4444", desc: "Si tout venait du réseau ONEE" },
            { label: "Coût avec solaire",   value: `${bilan?.cout_avec ?? "--"} DH`,  color: "#f59e0b", desc: "Ce qu'on paie vraiment à ONEE" },
            { label: "Economies réalisées", value: `${bilan?.economies ?? "--"} DH`,  color: "#10b981", desc: "Coût sans solaire − Coût avec solaire" },
            { label: "Projection annuelle", value: `${calculProjectionAnnuelle(bilan?.economies, periode)} DH`, color: "#3b82f6", desc: "Economies / nb jours × 365" },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              <div>
                <div style={{ color: theme.text, fontSize: 13, fontWeight: 500 }}>{item.label}</div>
                <div style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}>{item.desc}</div>
              </div>
              <div style={{ color: item.color, fontSize: 16, fontWeight: 700 }}>{item.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Leaf size={16} color="#10b981" />
            </div>
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Impact environnemental</h3>
          </div>
          {[
            { label: "CO2 émis (réseau)",   value: `${bilan?.co2_reseau ?? "--"} kg`, color: "#ef4444", Icon: Zap      },
            { label: "CO2 évité (solaire)", value: `${bilan?.co2_evite  ?? "--"} kg`, color: "#10b981", Icon: Leaf     },
            { label: "Équivalent arbres",   value: `${bilan?.co2_evite ? (bilan.co2_evite / 21.7).toFixed(1) : "--"} arbres`, color: "#10b981", Icon: TreePine },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderRadius: 10, marginBottom: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: 8, background: `${item.color}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <item.Icon size={14} color={item.color} />
                </div>
                <span style={{ color: theme.muted, fontSize: 13 }}>{item.label}</span>
              </div>
              <span style={{ color: item.color, fontWeight: 700, fontSize: 15 }}>{item.value}</span>
            </div>
          ))}
          {bilan && bilan.co2_reseau > 0 && (
            <div style={{ marginTop: 12, padding: "12px 14px", background: "rgba(16,185,129,0.06)", borderRadius: 10, border: "1px solid rgba(16,185,129,0.15)" }}>
              <div style={{ color: theme.muted, fontSize: 11, marginBottom: 8 }}>Réduction CO2 grâce au solaire</div>
              <div style={{ background: "rgba(255,255,255,0.06)", borderRadius: 6, height: 8, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.min((bilan.co2_evite / bilan.co2_reseau) * 100, 100)}%`, background: "linear-gradient(90deg, #10b981, #059669)", borderRadius: 6 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: theme.muted, marginTop: 4 }}>
                <span>CO2 évité : {bilan.co2_evite} kg</span>
                <span>{((bilan.co2_evite / bilan.co2_reseau) * 100).toFixed(1)}% réduit</span>
              </div>
            </div>
          )}
          <div style={{ color: theme.muted, fontSize: 11, marginTop: 12, textAlign: "right" }}>Facteur ONEE Maroc : 0.233 kg CO2/kWh</div>
        </div>
      </div>

      {/* GRAPHIQUE EVOLUTION */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(16,185,129,0.15)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Leaf size={16} color="#10b981" />
          <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Évolution énergétique — Réseau vs Solaire</h3>
        </div>
        {historique.length === 0 ? (
          <div style={{ textAlign: "center", color: theme.muted, padding: "40px 0", fontSize: 13 }}>Aucune donnée disponible</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={historique}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tickFormatter={isLong ? formatDate : formatTime} tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<TooltipPro />} />
              <Legend wrapperStyle={{ fontSize: 12, color: theme.muted }} formatter={v => v === "reseau" ? "Réseau" : "Solaire"} />
              <Line type="monotone" dataKey="reseau"  stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} name="reseau"  />
              <Line type="monotone" dataKey="solaire" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} name="solaire" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* TABLEAU RECAPITULATIF */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Calendar size={16} color={theme.muted} />
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>Tableau récapitulatif</h3>
          </div>
          <span style={{ background: filtreActif ? "rgba(245,158,11,0.1)" : "rgba(16,185,129,0.1)", color: filtreActif ? "#f59e0b" : theme.accent, fontSize: 11, padding: "3px 10px", borderRadius: 20, fontWeight: 500 }}>
            {periodeLabel}
          </span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                {["Indicateur", "Valeur", "Unité", "Description"].map((h, i) => (
                  <th key={i} style={{ padding: "10px 14px", textAlign: "left", color: theme.muted, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                { ind: "Énergie achetée ONEE (total)",   val: formatEnergieVal(bilan?.kwh_reseau),    unit: formatEnergieUnit(bilan?.kwh_reseau),  desc: "Depuis le réseau ONEE uniquement"                     },
                { ind: "  dont Heures Normales (HN)",    val: formatEnergieVal(bilanCout?.kwh_HN),    unit: formatEnergieUnit(bilanCout?.kwh_HN),  desc: `07h-17h + 21h-23h — ${bilanCout?.tarif_HN ?? "1.010"} DH/kWh TTC` },
                { ind: "  dont Heures Creuses (HC)",     val: formatEnergieVal(bilanCout?.kwh_HC),    unit: formatEnergieUnit(bilanCout?.kwh_HC),  desc: `23h-07h + Dimanche — ${bilanCout?.tarif_HC ?? "0.740"} DH/kWh TTC` },
                { ind: "  dont Heures de Pointe (HP)",   val: formatEnergieVal(bilanCout?.kwh_HP),    unit: formatEnergieUnit(bilanCout?.kwh_HP),  desc: `17h-21h Lun-Sam — ${bilanCout?.tarif_HP ?? "1.416"} DH/kWh TTC`  },
                { ind: "Énergie produite (solaire)",     val: formatEnergieVal(bilan?.kwh_solaire),   unit: formatEnergieUnit(bilan?.kwh_solaire), desc: "Par les panneaux solaires"                            },
                { ind: "Consommation totale site",       val: formatEnergieVal(bilan?.kwh_total),     unit: formatEnergieUnit(bilan?.kwh_total),   desc: "Réseau + Solaire"                                     },
                { ind: "Coût réseau (HN+HC+HP)",         val: `${bilanCout?.cout_total ?? "--"}`,     unit: "DH",                                  desc: "Calcul exact par période tarifaire"                   },
                { ind: "Coût sans solaire",              val: `${bilan?.cout_sans ?? "--"}`,          unit: "DH",                                  desc: `Tarif moyen ${bilan?.tarif ?? "--"} DH/kWh`           },
                { ind: "Économies réalisées",            val: `${bilan?.economies ?? "--"}`,          unit: "DH",                                  desc: "Coût sans solaire − Coût avec solaire"     },
                { ind: "Taux autoconsommation",          val: `${bilan?.taux_auto ?? "--"} %`,        unit: "%",                                   desc: "Solaire / Total × 100"                                },
                { ind: "CO2 émis (réseau)",              val: `${bilan?.co2_reseau ?? "--"}`,         unit: "kg",                                  desc: "Facteur ONEE 0.233 kg/kWh"                           },
                { ind: "CO2 évité (solaire)",            val: `${bilan?.co2_evite ?? "--"}`,          unit: "kg",                                  desc: "Réduction grâce au solaire"                           },
                { ind: "Projection annuelle économies",  val: calculProjectionAnnuelle(bilan?.economies, periode), unit: "DH", desc: "Économies normalisées × 365 jours"             },
              ].map((row, i) => (
                <tr key={i} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                  <td style={{ padding: "10px 14px", color: row.ind.startsWith("  ") ? theme.muted : theme.text, fontWeight: row.ind.startsWith("  ") ? 400 : 500, paddingLeft: row.ind.startsWith("  ") ? 28 : 14 }}>{row.ind.trim()}</td>
                  <td style={{ padding: "10px 14px", color: theme.accent, fontWeight: 700 }}>{row.val}</td>
                  <td style={{ padding: "10px 14px", color: theme.muted }}>{row.unit}</td>
                  <td style={{ padding: "10px 14px", color: theme.muted, fontSize: 12 }}>{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
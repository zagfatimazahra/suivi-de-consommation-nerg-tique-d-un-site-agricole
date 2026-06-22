import { useState, useEffect, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Legend
} from "recharts";
import {
  TrendingUp, Filter, Calendar, BarChart2,
  Activity, Zap, Battery, Clock, Leaf, Search, RefreshCw, Sun
} from "lucide-react";

const API = "http://localhost:8000";

const theme = {
  bg:      "#0a0f1e",
  card:    "#111827",
  border:  "#1f2937",
  accent:  "#10b981",
  accent2: "#3b82f6",
  accent3: "#f59e0b",
  text:    "#f9fafb",
  muted:   "#6b7280",
};

const MAX_DELTA_KWH = 200; // borne anti-reset compteur (cf. backend MAX_PUISSANCE_KW)

function formatEnergie(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "--";
  if (kwh === 0) return "0.00 kWh";
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${Number(kwh).toFixed(2)} kWh`;
}

function formatEnergieRaw(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "--";
  return `${(kwh / 1000).toFixed(2)} MWh`;
}

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

function formatAxisX(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}`;
}

function formatAxisXLong(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}h`;
}

const FIELDS = [
  { value: "tension",              label: "Tension (V)"                },
  { value: "courant",              label: "Courant (A)"                },
  { value: "frequence",            label: "Fréquence (Hz)"             },
  { value: "facteur_puissance",    label: "Facteur Puissance"          },
  { value: "puissance_active",     label: "Puissance Active (kW)"      },
  { value: "puissance_reactive",   label: "Puissance Réactive (kVAR)"  },
  { value: "puissance_apparente",  label: "Puissance Apparente (kVA)"  },
  { value: "energie_active",       label: "Énergie Active (MWh)"       },
  { value: "energie_reactive",     label: "Énergie Réactive (MVARh)"   },
  { value: "energie_apparente",    label: "Énergie Apparente (MVAh)"   },
];

const PERIODES = [
  { value: "1h",  label: "1 heure"   },
  { value: "24h", label: "24 heures" },
  { value: "7d",  label: "7 jours"   },
  { value: "30d", label: "30 jours"  },
];

function mergeMultiData(dataObj) {
  const timeMap = {};
  Object.entries(dataObj).forEach(([field, points]) => {
    if (!Array.isArray(points)) return;
    points.forEach(p => {
      if (!timeMap[p.time]) timeMap[p.time] = { time: p.time };
      timeMap[p.time][field] = p.value;
    });
  });
  return Object.values(timeMap).sort((a, b) => new Date(a.time) - new Date(b.time));
}

// ✅ Liste des deltas valides (positifs, bornés) entre points consécutifs d'un compteur cumulatif
function calculerDeltas(points) {
  const deltas = [];
  for (let i = 1; i < points.length; i++) {
    const d = points[i].value - points[i - 1].value;
    if (d >= 0 && d <= MAX_DELTA_KWH) {
      deltas.push({ time: points[i].time, prevTime: points[i - 1].time, value: d });
    }
  }
  return deltas;
}

function TooltipPro({ active, payload, label, fieldLabel }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: "10px 14px", fontSize: 12, boxShadow: "0 4px 20px rgba(0,0,0,0.4)" }}>
      <div style={{ color: "#9ca3af", marginBottom: 6, fontWeight: 600, fontSize: 11 }}>
        {formatDateHeure(label)}
      </div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || "#10b981", fontWeight: 600 }}>
          {p.name || fieldLabel} : {typeof p.value === "number" ? p.value.toFixed(3) : p.value}
        </div>
      ))}
    </div>
  );
}

export default function Analyse({ source }) {
  const isSolaire = source === "solaire";

  const [field,        setField]        = useState("tension");
  const [periode,      setPeriode]      = useState("24h");
  const [data,         setData]         = useState([]);
  const [loading,      setLoading]      = useState(false);
  const [energieTotal, setEnergieTotal] = useState(null);
  const [comparaison,  setComparaison]  = useState({ jour: 0, nuit: 0 });
  const [histCo2,      setHistCo2]      = useState([]);
  const [puissances,   setPuissances]   = useState([]);
  const [energies,     setEnergies]     = useState([]);
  const [dateDebut,    setDateDebut]    = useState("");
  const [dateFin,      setDateFin]      = useState("");
  const [filtreDate,   setFiltreDate]   = useState(false);
  const [dataDate,     setDataDate]     = useState([]);
  const [loadingDate,  setLoadingDate]  = useState(false);

  const isEnergieField = field.startsWith("energie");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const controller = new AbortController();
    const signal = controller.signal;
    try {
      const [hist, total, co2Hist, co2HistSolaire, puissData, energData] = await Promise.all([
        fetch(`${API}/api/historique?field=${field}&periode=${periode}&source=${source}`, { signal }).then(r => r.json()),
        fetch(`${API}/api/energie/total?periode=${periode}&source=${source}`, { signal }).then(r => r.json()),
        fetch(`${API}/api/co2/historique?periode=${periode}&source=${source}`, { signal }).then(r => r.json()),
        // ✅ pour le site, le CO2 doit dependre du RESEAU (total - solaire), pas du total
        isSolaire
          ? Promise.resolve(null)
          : fetch(`${API}/api/co2/historique?periode=${periode}&source=solaire`, { signal }).then(r => r.json()),
        fetch(`${API}/api/historique/multi?fields=puissance_active,puissance_reactive,puissance_apparente&periode=${periode}&source=${source}`, { signal }).then(r => r.json()),
        fetch(`${API}/api/historique/multi?fields=energie_active,energie_reactive,energie_apparente&periode=${periode}&source=${source}`, { signal }).then(r => r.json()),
      ]);
      const histArray = Array.isArray(hist) ? hist : [];
      setData(histArray);
      setEnergieTotal(total.erreur ? null : total);

      // ✅ CO2 reseau = CO2 total - CO2 solaire (point le plus proche)
      const co2TotalArr   = Array.isArray(co2Hist) ? co2Hist : [];
      const co2SolaireArr = Array.isArray(co2HistSolaire) ? co2HistSolaire : [];
      if (!isSolaire && co2SolaireArr.length > 0) {
        const parseT = t => new Date(t).getTime();
        const reseauArr = co2TotalArr.map(p => {
          const tp = parseT(p.time);
          let best = null, bestD = Infinity;
          for (const s of co2SolaireArr) {
            const d = Math.abs(parseT(s.time) - tp);
            if (d < bestD) { bestD = d; best = s; }
          }
          const solVal = best ? best.co2_kg : 0;
          return { time: p.time, co2_kg: Math.max(p.co2_kg - solVal, 0) };
        });
        setHistCo2(reseauArr);
      } else {
        setHistCo2(co2TotalArr);
      }

      setPuissances(puissData.erreur ? [] : mergeMultiData(puissData));
      setEnergies(energData.erreur ? [] : mergeMultiData(energData));

      // ✅ Comparaison Jour / Nuit
      if (field.startsWith("energie")) {
        // Champ cumulatif : on calcule l'energie REELLE consommee par intervalle
        // (delta = valeur[i] - valeur[i-1]), affectee a Jour ou Nuit selon
        // l'heure de DEBUT de l'intervalle (points[i-1]).
        const deltas = calculerDeltas(histArray);
        let jour = 0, nuit = 0;
        deltas.forEach(d => {
          const h = new Date(d.prevTime).getHours();
          if (h >= 6 && h < 18) jour += d.value;
          else nuit += d.value;
        });
        setComparaison({ jour, nuit });
      } else {
        // Champs instantanes (tension, courant, puissance...) : moyenne par periode
        let jour = 0, nuit = 0, countJour = 0, countNuit = 0;
        histArray.forEach(point => {
          const h = new Date(point.time).getHours();
          if (h >= 6 && h < 18) { jour += point.value; countJour++; }
          else { nuit += point.value; countNuit++; }
        });
        setComparaison({
          jour: countJour > 0 ? Number((jour / countJour).toFixed(2)) : 0,
          nuit: countNuit > 0 ? Number((nuit / countNuit).toFixed(2)) : 0,
        });
      }
    } catch(e) {
      if (e.name !== "AbortError") console.error("Erreur:", e);
    }
    setLoading(false);
    return controller;
  }, [field, periode, source, isSolaire]);

  const fetchDateRange = async () => {
    if (!dateDebut || !dateFin || dateFin < dateDebut) return;
    setLoadingDate(true);
    try {
      const json = await fetch(
        `${API}/api/historique/daterange?field=${field}&date_debut=${dateDebut}&date_fin=${dateFin}&source=${source}`
      ).then(r => r.json());
      setDataDate(Array.isArray(json) ? json : []);
      setFiltreDate(true);
    } catch(e) { console.error(e); }
    setLoadingDate(false);
  };

  const resetDateFilter = () => {
    setFiltreDate(false); setDataDate([]);
    setDateDebut(""); setDateFin("");
  };

  useEffect(() => {
    let controller;
    const run = async () => { controller = await fetchData(); };
    run();
    return () => { if (controller) controller.abort(); };
  }, [fetchData]);

  const selectedField = FIELDS.find(f => f.value === field);
  const displayData   = filtreDate ? dataDate : data;
  const accentColor   = isSolaire ? "#f59e0b" : "#10b981";
  const periodeLabel  = PERIODES.find(p => p.value === periode)?.label ?? periode;
  const isLong        = periode === "7d" || periode === "30d" || filtreDate;

  // ✅ Cartes résumé : pour les champs énergie (compteurs cumulatifs), les stats
  // brutes (moyenne/min/max de la valeur compteur) ne sont pas significatives.
  // On affiche à la place : énergie totale consommée (delta global, depuis le
  // backend /api/energie/total) et le delta max/min entre 2 points consécutifs
  // (= consommation par intervalle, en kWh).
  const deltasDisplay = isEnergieField ? calculerDeltas(displayData) : [];
  const deltaValues   = deltasDisplay.map(d => d.value);

  const cartesResume = isEnergieField ? [
    { label: "Points de données",        value: displayData.length, color: accentColor,   Icon: Activity  },
    { label: "Énergie totale (période)", value: formatEnergie(energieTotal?.total_kwh), color: theme.accent2, Icon: Battery, isText: true },
    { label: "Consommation maximale (pic)",  value: deltaValues.length > 0 ? formatEnergie(Math.max(...deltaValues)) : "--", color: "#f59e0b", Icon: TrendingUp, isText: true },
    { label: "Consommation minimale",  value: deltaValues.length > 0 ? formatEnergie(Math.min(...deltaValues)) : "--", color: "#8b5cf6", Icon: Zap, isText: true },
  ] : [
    { label: "Points de données", value: displayData.length, color: accentColor,   Icon: Activity  },
    { label: "Valeur moyenne",    value: displayData.length > 0 ? (displayData.reduce((s,d)=>s+d.value,0)/displayData.length).toFixed(3) : "--", color: theme.accent2, Icon: BarChart2  },
    { label: "Valeur max",        value: displayData.length > 0 ? Math.max(...displayData.map(d=>d.value)).toFixed(3) : "--", color: "#f59e0b", Icon: TrendingUp },
    { label: "Valeur min",        value: displayData.length > 0 ? Math.min(...displayData.map(d=>d.value)).toFixed(3) : "--", color: "#8b5cf6", Icon: Zap        },
  ];

  // ✅ Données pour le graphique Jour/Nuit
  const comparaisonData = isEnergieField ? [
    { name: "Jour (6h-18h)", value: comparaison.jour },
    { name: "Nuit (18h-6h)", value: comparaison.nuit },
  ] : [
    { name: "Jour (6h-18h)", value: parseFloat(comparaison.jour) },
    { name: "Nuit (18h-6h)", value: parseFloat(comparaison.nuit) },
  ];

  return (
    <div style={{ color: theme.text }}>

      {/* TITRE */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: isSolaire ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isSolaire ? <Sun size={18} color="#f59e0b" /> : <TrendingUp size={18} color="#10b981" />}
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: theme.text, margin: 0 }}>
            {isSolaire ? "Analyse de production solaire" : "Analyse de consommation"}
          </h2>
        </div>
        <p style={{ color: theme.muted, fontSize: 13, margin: 0, paddingLeft: 46 }}>
          {isSolaire ? "Visualisez et analysez la production énergétique solaire" : "Visualisez et analysez les données énergétiques"}
        </p>
      </div>

      {/* FILTRES */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: "16px 20px", marginBottom: 20, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Filter size={12} color={theme.muted} />
            <label style={{ color: theme.muted, fontSize: 12 }}>Grandeur</label>
          </div>
          <select value={field} onChange={e => setField(e.target.value)} style={{ background: "rgba(255,255,255,0.05)", color: theme.text, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 12px", fontSize: 13, cursor: "pointer", outline: "none", minWidth: 200 }}>
            {FIELDS.map(f => (
              <option key={f.value} value={f.value} style={{ background: "#1f2937", color: "#f9fafb" }}>{f.label}</option>
            ))}
          </select>
        </div>

        <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)", alignSelf: "center" }} />

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Clock size={12} color={theme.muted} />
            <label style={{ color: theme.muted, fontSize: 12 }}>Période</label>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {PERIODES.map(p => (
              <button key={p.value} onClick={() => { setPeriode(p.value); setFiltreDate(false); }} style={{
                background: periode === p.value && !filtreDate ? `${accentColor}30` : "rgba(255,255,255,0.04)",
                color:      periode === p.value && !filtreDate ? accentColor : theme.muted,
                border:     `1px solid ${periode === p.value && !filtreDate ? `${accentColor}60` : "rgba(255,255,255,0.08)"}`,
                borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer",
                fontWeight: periode === p.value && !filtreDate ? 600 : 400,
              }}>{p.label}</button>
            ))}
          </div>
        </div>

        <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)", alignSelf: "center" }} />

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
              onClick={fetchDateRange}
              disabled={!dateDebut || !dateFin || loadingDate || (dateFin < dateDebut)}
              style={{ background: !dateDebut || !dateFin || dateFin < dateDebut ? "rgba(59,130,246,0.2)" : "rgba(59,130,246,0.2)", color: theme.accent2, border: "1px solid rgba(59,130,246,0.4)", borderRadius: 8, padding: "7px 16px", fontSize: 12, cursor: !dateDebut || !dateFin || dateFin < dateDebut ? "not-allowed" : "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 6, opacity: dateFin && dateDebut && dateFin < dateDebut ? 0.5 : 1 }}
            >
              <Search size={13} />{loadingDate ? "Chargement..." : "Filtrer"}
            </button>
            {filtreDate && (
              <button onClick={resetDateFilter} style={{ background: "rgba(255,255,255,0.04)", color: theme.muted, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                <RefreshCw size={12} /> Réinitialiser
              </button>
            )}
          </div>
          {dateDebut && dateFin && dateFin < dateDebut && (
            <div style={{ color: "#ef4444", fontSize: 11, marginTop: 4 }}>La date de fin doit être après la date de début</div>
          )}
          {filtreDate && (
            <div style={{ color: accentColor, fontSize: 11, marginTop: 4 }}>
              {dateDebut} → {dateFin} · {dataDate.length} points
            </div>
          )}
        </div>

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, color: accentColor, fontSize: 12, marginLeft: "auto" }}>
            <RefreshCw size={12} /> Chargement...
          </div>
        )}
      </div>

      {/* CARTES RESUME */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 20 }}>
        {cartesResume.map((item, i) => (
          <div key={i} style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: `${item.color}20`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <item.Icon size={18} color={item.color} />
            </div>
            <div>
              <div style={{ color: theme.muted, fontSize: 11, marginBottom: 4 }}>{item.label}</div>
              <div style={{ color: item.color, fontSize: item.isText ? 18 : 22, fontWeight: 700 }}>{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* GRAPHIQUE PRINCIPAL */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Activity size={16} color={accentColor} />
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>
              {selectedField?.label} — {filtreDate ? `${dateDebut} → ${dateFin}` : periodeLabel}
            </h3>
          </div>
          <span style={{ background: `${accentColor}15`, color: accentColor, fontSize: 11, padding: "3px 10px", borderRadius: 20 }}>{displayData.length} points</span>
        </div>
        {displayData.length === 0 ? (
          <div style={{ textAlign: "center", color: theme.muted, padding: "40px 0", fontSize: 13 }}>Aucune donnée disponible</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={displayData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis
                dataKey="time"
                tickFormatter={isLong ? formatAxisXLong : formatAxisX}
                tick={{ fill: theme.muted, fontSize: 10 }}
                interval="preserveStartEnd"
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: theme.muted, fontSize: 10 }}
                axisLine={false} tickLine={false}
                tickFormatter={v => field.includes("energie") ? `${(v/1000).toFixed(1)}` : v}
              />
              <Tooltip
                content={({ active, payload, label }) => (
                  <TooltipPro active={active} payload={payload} label={label} fieldLabel={selectedField?.label} />
                )}
              />
              <Line type="monotone" dataKey="value" stroke={accentColor} strokeWidth={2.5} dot={false} isAnimationActive={false} name={selectedField?.label} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* GRAPHIQUE PUISSANCES */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          {isSolaire ? <Sun size={16} color="#f59e0b" /> : <Zap size={16} color="#f59e0b" />}
          <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>
            {isSolaire ? "Puissances Produites — Active / Réactive / Apparente" : "Puissances Active / Réactive / Apparente"}
          </h3>
        </div>
        {puissances.length === 0 ? (
          <div style={{ textAlign: "center", color: theme.muted, padding: "40px 0" }}>Aucune donnée disponible</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={puissances}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tickFormatter={isLong ? formatAxisXLong : formatAxisX} tick={{ fill: theme.muted, fontSize: 10 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => (
                  <TooltipPro active={active} payload={payload} label={label} />
                )}
              />
              <Legend wrapperStyle={{ color: theme.muted, fontSize: 12 }} />
              <Line type="monotone" dataKey="puissance_active"    stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} name={isSolaire ? "Active produite (kW)" : "Active (kW)"}    />
              <Line type="monotone" dataKey="puissance_reactive"  stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} name="Réactive (kVAR)" />
              <Line type="monotone" dataKey="puissance_apparente" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} name="Apparente (kVA)"  />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* GRAPHIQUE ENERGIES */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Battery size={16} color="#06b6d4" />
          <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>
            {isSolaire ? "Énergies Produites — Active / Réactive / Apparente" : "Énergies Active / Réactive / Apparente"}
          </h3>
        </div>
        {energies.length === 0 ? (
          <div style={{ textAlign: "center", color: theme.muted, padding: "40px 0" }}>Aucune donnée disponible</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={energies}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tickFormatter={isLong ? formatAxisXLong : formatAxisX} tick={{ fill: theme.muted, fontSize: 10 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(1)}`} />
              <Tooltip
                content={({ active, payload, label }) => (
                  <TooltipPro active={active} payload={payload} label={label} />
                )}
              />
              <Legend wrapperStyle={{ color: theme.muted, fontSize: 12 }} />
              <Line type="monotone" dataKey="energie_active"    stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} name={isSolaire ? "Produite (MWh)" : "Active (MWh)"} />
              <Line type="monotone" dataKey="energie_reactive"  stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} name="Réactive (MVARh)" />
              <Line type="monotone" dataKey="energie_apparente" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} name="Apparente (MVAh)"  />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* COMPARAISON JOUR / NUIT + ENERGIE TOTALE */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <Clock size={16} color={theme.muted} />
            <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>
              {isSolaire ? "Production Jour / Nuit" : "Comparaison Jour / Nuit"}
            </h3>
          </div>
          {isEnergieField && (
            <div style={{ color: theme.muted, fontSize: 11, marginBottom: 10 }}>
              Énergie {isSolaire ? "produite" : "consommée"} cumulée par tranche horaire (deltas du compteur {selectedField?.label})
            </div>
          )}
          <ResponsiveContainer width="100%" height={isEnergieField ? 180 : 200}>
            <BarChart data={comparaisonData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="name" tick={{ fill: theme.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fill: theme.muted, fontSize: 11 }} axisLine={false} tickLine={false}
                tickFormatter={v => isEnergieField ? (v >= 1000 ? `${(v/1000).toFixed(1)}M` : v.toFixed(0)) : v}
              />
              <Tooltip
                contentStyle={{ background: "#1f2937", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
                formatter={(v) => isEnergieField ? [formatEnergie(v), isSolaire ? "Produit" : "Consommé"] : [Number(v).toFixed(2), "Moyenne"]}
              />
              <Bar dataKey="value" fill={accentColor} radius={[6,6,0,0]} />
            </BarChart>
          </ResponsiveContainer>
          {isEnergieField && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12, color: theme.muted }}>
              <span>Jour : <strong style={{ color: accentColor }}>{formatEnergie(comparaison.jour)}</strong></span>
              <span>Nuit : <strong style={{ color: accentColor }}>{formatEnergie(comparaison.nuit)}</strong></span>
            </div>
          )}
        </div>
        <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", gap: 10 }}>
          {isSolaire ? <Sun size={28} color="#f59e0b" /> : <Battery size={28} color={theme.accent} />}
          <div style={{ color: theme.muted, fontSize: 13 }}>
            {isSolaire ? "Énergie totale produite" : "Énergie totale consommée"}
          </div>
          <div style={{ color: accentColor, fontSize: 48, fontWeight: 700, lineHeight: 1 }}>
            {energieTotal?.total_kwh != null ? energieTotal.total_kwh >= 1000 ? (energieTotal.total_kwh / 1000).toFixed(2) : energieTotal.total_kwh.toFixed(2) : "--"}
          </div>
          <div style={{ color: theme.muted, fontSize: 14 }}>
            {energieTotal?.total_kwh != null && energieTotal.total_kwh >= 1000 ? "MWh" : "kWh"}
          </div>
          <div style={{ color: theme.muted, fontSize: 12 }}>{periodeLabel}</div>
        </div>
      </div>

      {/* CO2 */}
      <div style={{ background: "linear-gradient(135deg, #111827, #1f2937)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: 14, padding: 20, marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(16,185,129,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Leaf size={16} color="#10b981" />
          </div>
          <h3 style={{ color: theme.text, margin: 0, fontSize: 14, fontWeight: 600 }}>
            {isSolaire ? "Évolution CO2 évité (kg)" : "Évolution CO2 émis (kg)"}
          </h3>
        </div>
        {histCo2.length === 0 ? (
          <div style={{ textAlign: "center", color: theme.muted, padding: "40px 0" }}>Aucune donnée disponible</div>
        ) : (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={histCo2}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="time" tickFormatter={isLong ? formatAxisXLong : formatAxisX} tick={{ fill: theme.muted, fontSize: 10 }} interval="preserveStartEnd" axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: theme.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload, label }) => (
                  <TooltipPro active={active} payload={payload} label={label} fieldLabel={isSolaire ? "CO2 évité (kg)" : "CO2 émis (kg)"} />
                )}
              />
              <Line type="monotone" dataKey="co2_kg" stroke="#10b981" strokeWidth={2.5} dot={false} isAnimationActive={false} name={isSolaire ? "CO2 évité" : "CO2 émis"} />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div style={{ display: "flex", gap: 20, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: theme.muted, display: "flex", alignItems: "center", gap: 6 }}>
            <Leaf size={12} color="#10b981" />
            {isSolaire ? "Total CO2 évité" : "Total CO2 réseau"} : <strong style={{ color: "#10b981" }}>
              {histCo2.length > 0 ? (histCo2[histCo2.length-1]?.co2_kg?.toFixed(2) ?? "--") : "--"} kg
            </strong>
          </div>
          <div style={{ fontSize: 12, color: theme.muted }}>
            Facteur ONEE Maroc : <strong style={{ color: theme.muted }}>0.233 kg CO2/kWh</strong>
          </div>
        </div>
      </div>

    </div>
  );
}
import { useState, useEffect } from "react";
import {
  Download, FileSpreadsheet,
  CheckCircle, AlertCircle, Calendar,
  Clock, Leaf, Search, RefreshCw,
  Database, Sun, BarChart2, Sprout, Zap,
  Filter
} from "lucide-react";
import * as XLSX from "xlsx";

const API = "http://localhost:8000";

const theme = {
  bg:      "#0a0f1e",
  card:    "#111827",
  border:  "#1f2937",
  accent:  "#10b981",
  accent2: "#3b82f6",
  danger:  "#ef4444",
  text:    "#f9fafb",
  muted:   "#6b7280",
  sub:     "#9ca3af",
};

const TARIF_HN = 1.010;
const TARIF_HC = 0.740;
const TARIF_HP = 1.416;

function formatEnergie(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "--";
  if (kwh === 0) return "0.00 kWh";
  if (kwh >= 1000) return `${(kwh / 1000).toFixed(2)} MWh`;
  return `${Number(kwh).toFixed(2)} kWh`;
}

function formatEnergieRaw(kwh) {
  if (kwh === null || kwh === undefined || isNaN(kwh)) return "N/A";
  return `${(kwh / 1000).toFixed(2)} MWh`;
}

function v(val, decimals = 2) {
  if (val === null || val === undefined) return "N/A";
  return typeof val === "number" ? val.toFixed(decimals) : String(val);
}

const PERIODES = [
  { value: "24h", label: "24 heures" },
  { value: "7d",  label: "7 jours"   },
  { value: "30d", label: "30 jours"  },
];

// Intervalle d'agregation (en minutes) utilise par le backend pour chaque
// periode — DOIT correspondre exactement a get_window() dans main.py :
//   {"1h":"1m","24h":"5m","7d":"30m","30d":"2h"}
// et a l'agregation fixe de /api/export/csv/daterange (toujours 30m).
const INTERVALLE_MIN = { "24h": 5, "7d": 30, "30d": 120 };
const INTERVALLE_DATERANGE_MIN = 30;

const GRANDEURS = [
  { key: "tension",             label: "Tension (V)"               },
  { key: "courant",             label: "Courant (A)"               },
  { key: "frequence",           label: "Fréquence (Hz)"            },
  { key: "facteur_puissance",   label: "Facteur Puissance"         },
  { key: "puissance_active",    label: "Puissance Active (kW)"     },
  { key: "puissance_reactive",  label: "Puissance Réactive (kVAR)" },
  { key: "puissance_apparente", label: "Puissance Apparente (kVA)" },
  { key: "energie_active",      label: "Énergie Active (MWh)"      },
  { key: "energie_reactive",    label: "Énergie Réactive (MVARh)"  },
  { key: "energie_apparente",   label: "Énergie Apparente (MVAh)"  },
];

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: "linear-gradient(135deg,#111827,#1a2234)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 16, padding: 20, ...style,
    }}>
      {children}
    </div>
  );
}

function SectionHeader({ icon: Icon, title, subtitle, color = theme.accent2 }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Icon size={17} color={color} />
      </div>
      <div>
        <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>{title}</div>
        {subtitle && <div style={{ color: theme.muted, fontSize: 11, marginTop: 1 }}>{subtitle}</div>}
      </div>
    </div>
  );
}

export default function Export({ source }) {
  const isSolaire = source === "solaire";
  const accentColor = isSolaire ? "#f59e0b" : "#10b981";

  const [periode,        setPeriode]        = useState("24h");
  const [dateDebut,      setDateDebut]      = useState("");
  const [dateFin,        setDateFin]        = useState("");
  const [loading,        setLoading]        = useState(false);
  const [loadingExcel,   setLoadingExcel]   = useState(false);
  const [loadingFull,    setLoadingFull]    = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [message,        setMessage]        = useState(null);
  const [filtreDate,     setFiltreDate]     = useState(false);

  const [histData,     setHistData]     = useState([]);
  const [nbPoints,     setNbPoints]     = useState(null);
  const [rtSite,       setRtSite]       = useState(null);
  const [rtSolaire,    setRtSolaire]    = useState(null);
  const [bilan,        setBilan]        = useState(null);
  const [coutSite,     setCoutSite]     = useState(null);
  const [coutSolaire,  setCoutSolaire]  = useState(null);
  const [co2Site,      setCo2Site]      = useState(null);
  const [co2Solaire,   setCo2Solaire]   = useState(null);

  const [grandeursSel, setGrandeursSel] = useState(
    GRANDEURS.reduce((acc, g) => ({ ...acc, [g.key]: true }), {})
  );

  const fetchPreview = async () => {
    setLoadingPreview(true);
    try {
      const [hist, rtS, rtSol, bilanData, cS, cSol, co2S, co2Sol] = await Promise.all([
        fetch(`${API}/api/historique?field=tension&periode=${periode}&source=${source}`).then(r => r.json()),
        fetch(`${API}/api/realtime?source=total`).then(r => r.json()),
        fetch(`${API}/api/realtime?source=solaire`).then(r => r.json()),
        fetch(`${API}/api/bilan?periode=${periode}`).then(r => r.json()),
        fetch(`${API}/api/cout/detail?periode=${periode}&source=total`).then(r => r.json()),
        fetch(`${API}/api/cout/detail?periode=${periode}&source=solaire`).then(r => r.json()),
        fetch(`${API}/api/co2?periode=${periode}&source=total`).then(r => r.json()),
        fetch(`${API}/api/co2?periode=${periode}&source=solaire`).then(r => r.json()),
      ]);
      const h = Array.isArray(hist) ? hist : [];
      setHistData(h); setNbPoints(h.length);
      if (!rtS.error)   setRtSite(rtS);
      if (!rtSol.error) setRtSolaire(rtSol);
      setBilan(bilanData.erreur ? null : bilanData);
      setCoutSite(cS.erreur ? null : cS);
      setCoutSolaire(cSol.erreur ? null : cSol);
      setCo2Site(co2S); setCo2Solaire(co2Sol);
    } catch(e) { console.error(e); }
    setLoadingPreview(false);
  };

  const fetchPreviewDate = async () => {
    if (!dateDebut || !dateFin || dateFin < dateDebut) return;
    setLoadingPreview(true);
    try {
      const hist = await fetch(
        `${API}/api/historique/daterange?field=tension&date_debut=${dateDebut}&date_fin=${dateFin}&source=${source}`
      ).then(r => r.json());
      const h = Array.isArray(hist) ? hist : [];
      setHistData(h); setNbPoints(h.length);
      setFiltreDate(true);
    } catch(e) { console.error(e); }
    setLoadingPreview(false);
  };

  const resetFiltre = () => {
    setFiltreDate(false); setDateDebut(""); setDateFin("");
    fetchPreview();
  };

  useEffect(() => { fetchPreview(); }, [periode, source]);

  const toggleGrandeur = key => setGrandeursSel(prev => ({ ...prev, [key]: !prev[key] }));
  const selectAll   = () => setGrandeursSel(GRANDEURS.reduce((acc, g) => ({ ...acc, [g.key]: true  }), {}));
  const deselectAll = () => setGrandeursSel(GRANDEURS.reduce((acc, g) => ({ ...acc, [g.key]: false }), {}));
  const grandSelesCount = Object.values(grandeursSel).filter(Boolean).length;

  const periodeLabel = filtreDate && dateDebut && dateFin
    ? `${dateDebut} → ${dateFin}`
    : PERIODES.find(p => p.value === periode)?.label ?? periode;

  const datesValides = !dateDebut || !dateFin || dateFin >= dateDebut;

  // ── Helpers CSV / Excel ──
  const parseCsvToRows = (csvText) => {
    const lines  = csvText.trim().split("\n");
    const header = lines[0].split(",").map(h => h.trim());
    return lines.slice(1).map(line => {
      const vals = line.split(",");
      return header.reduce((obj, h, i) => {
        obj[h] = isNaN(vals[i]?.trim()) ? vals[i]?.trim() : Number(vals[i]);
        return obj;
      }, {});
    });
  };

  // FIX : intervalleMin remplace le "/12" fixe (qui supposait toujours 5min).
  // kwh_i = puissance(kW) x duree(h) = puissance x (intervalleMin/60)
  //   24h -> 5min  -> intervalleMin/60 = 1/12  (identique a l'ancien calcul)
  //   7j  -> 30min -> intervalleMin/60 = 1/2   (avant : /12, x6 trop petit)
  //   30j -> 2h    -> intervalleMin/60 = 2     (avant : /12, x24 trop petit)
  //   date range   -> 30min (agregation fixe backend) -> 1/2
  const enrichRows = (rows, intervalleMin = 5) => rows.map(row => {
    const ts = new Date(row.timestamp);
    const hM = (ts.getUTCHours() + 1) % 24;
    const j  = ts.getUTCDay();
    let pt = "HN";
    if (j === 0 || hM < 7 || hM >= 23) pt = "HC";
    else if (hM >= 17 && hM < 21) pt = "HP";
    const tarif = pt === "HN" ? TARIF_HN : pt === "HC" ? TARIF_HC : TARIF_HP;
    const kwh_i = (row.puissance_active || 0) * (intervalleMin / 60);
    return {
      "Horodatage (UTC)":          row.timestamp,
      "Heure Maroc":               `${String(hM).padStart(2,"0")}:${String(ts.getUTCMinutes()).padStart(2,"0")}`,
      "Periode Tarifaire":         pt,
      "Tarif TTC (DH/kWh)":        tarif,
      "Tension (V)":               row.tension,
      "Courant (A)":               row.courant,
      "Frequence (Hz)":            row.frequence,
      "Facteur Puissance":         row.facteur_puissance,
      "Puissance Active (kW)":     row.puissance_active,
      "Puissance Reactive (kVAR)": row.puissance_reactive,
      "Puissance Apparente (kVA)": row.puissance_apparente,
      "Energie Active (MWh)":      row.energie_active   != null ? parseFloat((row.energie_active   / 1000).toFixed(4)) : null,
      "Energie Reactive (MVARh)":  row.energie_reactive != null ? parseFloat((row.energie_reactive / 1000).toFixed(4)) : null,
      "Energie Apparente (MVAh)":  row.energie_apparente != null ? parseFloat((row.energie_apparente/ 1000).toFixed(4)) : null,
      "Cout estime (DH)":          parseFloat((kwh_i * tarif).toFixed(5)),
    };
  });

  const createStyledSheet = (rows) => {
    const ws   = XLSX.utils.json_to_sheet(rows);
    const cols = Object.keys(rows[0] || {});
    cols.forEach((_, ci) => {
      const cellRef = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (!ws[cellRef]) return;
      let fgColor = "1F2937";
      if (ci <= 3) fgColor = "1E3A5F";
      else if (ci >= 4 && ci <= 7) fgColor = "14532D";
      else if (ci >= 8 && ci <= 10) fgColor = "7C2D12";
      else if (ci >= 11 && ci <= 13) fgColor = "1E1B4B";
      ws[cellRef].s = { fill: { fgColor: { rgb: fgColor }, patternType: "solid" }, font: { bold: true, color: { rgb: "FFFFFF" }, sz: 9 }, alignment: { horizontal: "center", vertical: "center", wrapText: true } };
    });
    rows.forEach((_, ri) => {
      cols.forEach((_, ci) => {
        const cellRef = XLSX.utils.encode_cell({ r: ri + 1, c: ci });
        if (!ws[cellRef]) return;
        ws[cellRef].s = { fill: { fgColor: { rgb: ri % 2 === 0 ? "F9FAFB" : "EFF6FF" }, patternType: "solid" }, font: { sz: 9 }, alignment: { horizontal: "center" } };
      });
    });
    ws["!cols"] = [{ wch: 22 },{ wch: 10 },{ wch: 12 },{ wch: 14 },{ wch: 10 },{ wch: 10 },{ wch: 10 },{ wch: 14 },{ wch: 16 },{ wch: 18 },{ wch: 18 },{ wch: 16 },{ wch: 16 },{ wch: 16 },{ wch: 14 }];
    ws["!rows"] = [{ hpt: 28 }];
    return ws;
  };

  const exportCSV = async () => {
    setLoading(true); setMessage(null);
    try {
      const url = filtreDate && dateDebut && dateFin
        ? `${API}/api/export/csv/daterange?date_debut=${dateDebut}&date_fin=${dateFin}&source=${source}`
        : `${API}/api/export/csv?periode=${periode}&source=${source}`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Erreur serveur");
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = window.URL.createObjectURL(blob);
      a.download = filtreDate ? `energie_${source}_${dateDebut}_${dateFin}.csv` : `energie_${source}_${periode}.csv`;
      a.click(); window.URL.revokeObjectURL(a.href);
      setMessage({ type: "ok", text: `CSV téléchargé — ${nbPoints ?? "?"} lignes` });
    } catch(e) { setMessage({ type: "error", text: "Erreur export CSV" }); }
    setLoading(false);
  };

  const exportExcel = async () => {
    setLoadingExcel(true); setMessage(null);
    try {
      const url = filtreDate && dateDebut && dateFin
        ? `${API}/api/export/csv/daterange?date_debut=${dateDebut}&date_fin=${dateFin}&source=${source}`
        : `${API}/api/export/csv?periode=${periode}&source=${source}`;
      const csvText = await fetch(url).then(r => r.text());
      // Intervalle correct selon le mode (date range = toujours 30min cote backend)
      const intervalleMin = filtreDate ? INTERVALLE_DATERANGE_MIN : INTERVALLE_MIN[periode];
      const rows    = enrichRows(parseCsvToRows(csvText), intervalleMin);
      const wb      = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, createStyledSheet(rows), isSolaire ? "Mesures Solaire" : "Mesures Site");
      const fileName = filtreDate ? `energie_${source}_${dateDebut}_${dateFin}.xlsx` : `energie_${source}_${periode}.xlsx`;
      XLSX.writeFile(wb, fileName);
      setMessage({ type: "ok", text: `Excel téléchargé — ${isSolaire ? "Solaire" : "Site"}` });
    } catch(e) { setMessage({ type: "error", text: "Erreur Excel : " + e.message }); }
    setLoadingExcel(false);
  };

  const exportExcelComplet = async () => {
    setLoadingFull(true); setMessage(null);
    try {
      const [csvSite, csvSolaire] = await Promise.all([
        fetch(`${API}/api/export/csv?periode=${periode}&source=total`).then(r => r.text()),
        fetch(`${API}/api/export/csv?periode=${periode}&source=solaire`).then(r => r.text()),
      ]);
      // Rapport complet utilise toujours "periode" (jamais daterange)
      const intervalleMin = INTERVALLE_MIN[periode];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, createStyledSheet(enrichRows(parseCsvToRows(csvSite), intervalleMin)),    "Mesures Site");
      XLSX.utils.book_append_sheet(wb, createStyledSheet(enrichRows(parseCsvToRows(csvSolaire), intervalleMin)), "Mesures Solaire");
      XLSX.writeFile(wb, `rapport_complet_azura_${periode}.xlsx`);
      setMessage({ type: "ok", text: "Rapport Excel complet — Site + Solaire" });
    } catch(e) { setMessage({ type: "error", text: "Erreur rapport complet : " + e.message }); }
    setLoadingFull(false);
  };

  return (
    <div style={{ color: theme.text }}>

      {/* HEADER */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(59,130,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Download size={20} color={theme.accent2} />
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Export des données</h2>
        </div>
        <p style={{ margin: 0, color: theme.muted, fontSize: 13, paddingLeft: 48 }}>
          Export CSV / Excel — Par source ou rapport complet Site + Solaire
        </p>
      </div>

      {/* ══ FILTRES — même style que Analyse et Bilan ══ */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>

          {/* Période */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Clock size={12} color={theme.muted} />
              <label style={{ color: theme.muted, fontSize: 12 }}>Période</label>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {PERIODES.map(p => (
                <button key={p.value} onClick={() => { setPeriode(p.value); setFiltreDate(false); }} style={{
                  background: periode === p.value && !filtreDate ? `${accentColor}25` : "rgba(255,255,255,0.04)",
                  color:      periode === p.value && !filtreDate ? accentColor : theme.muted,
                  border:     `1px solid ${periode === p.value && !filtreDate ? `${accentColor}50` : "rgba(255,255,255,0.08)"}`,
                  borderRadius: 8, padding: "7px 14px", fontSize: 12, cursor: "pointer",
                  fontWeight: periode === p.value && !filtreDate ? 600 : 400,
                }}>{p.label}</button>
              ))}
            </div>
          </div>

          {/* Séparateur */}
          <div style={{ width: 1, height: 40, background: "rgba(255,255,255,0.08)", alignSelf: "center" }} />

          {/* Plage dates */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Calendar size={12} color={theme.muted} />
              <label style={{ color: theme.muted, fontSize: 12 }}>Plage de dates</label>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)}
                style={{ background: "rgba(255,255,255,0.05)", color: theme.text, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none" }} />
              <span style={{ color: theme.muted, fontSize: 12 }}>→</span>
              <input type="date" value={dateFin} onChange={e => setDateFin(e.target.value)}
                style={{ background: "rgba(255,255,255,0.05)", color: theme.text, border: `1px solid ${!datesValides ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.1)"}`, borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none" }} />
              <button onClick={fetchPreviewDate} disabled={!dateDebut || !dateFin || !datesValides || loadingPreview}
                style={{ background: "rgba(59,130,246,0.2)", color: theme.accent2, border: "1px solid rgba(59,130,246,0.4)", borderRadius: 8, padding: "7px 16px", fontSize: 12, cursor: "pointer", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                <Search size={13} />{loadingPreview ? "..." : "Filtrer"}
              </button>
              {filtreDate && (
                <button onClick={resetFiltre}
                  style={{ background: "rgba(255,255,255,0.04)", color: theme.muted, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "7px 12px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
                  <RefreshCw size={12} /> Réinitialiser
                </button>
              )}
            </div>
            {!datesValides && <div style={{ color: "#ef4444", fontSize: 11, marginTop: 4 }}>La date de fin doit être après la date de début</div>}
            {filtreDate && <div style={{ color: accentColor, fontSize: 11, marginTop: 4 }}>{dateDebut} → {dateFin} · {nbPoints} points</div>}
          </div>

          {/* Points disponibles */}
          {nbPoints !== null && (
            <div style={{ marginLeft: "auto", background: `${accentColor}10`, border: `1px solid ${accentColor}20`, borderRadius: 10, padding: "8px 16px", display: "flex", alignItems: "center", gap: 10 }}>
              <Database size={16} color={accentColor} />
              <div>
                <div style={{ color: accentColor, fontWeight: 700, fontSize: 18, lineHeight: 1 }}>{nbPoints}</div>
                <div style={{ color: theme.muted, fontSize: 10 }}>points</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>

        {/* ══ GRANDEURS ══ */}
        <Card>
          <SectionHeader icon={Filter} title={`Grandeurs à exporter (${grandSelesCount}/${GRANDEURS.length})`} color={theme.purple} />
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            <button onClick={selectAll}   style={{ background: `${accentColor}15`, color: accentColor, border: `1px solid ${accentColor}30`, borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Tout</button>
            <button onClick={deselectAll} style={{ background: "rgba(255,255,255,0.04)", color: theme.muted, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>Aucun</button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {GRANDEURS.map(g => (
              <div key={g.key} onClick={() => toggleGrandeur(g.key)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: grandeursSel[g.key] ? `${accentColor}12` : "rgba(255,255,255,0.02)", border: `1px solid ${grandeursSel[g.key] ? `${accentColor}25` : "rgba(255,255,255,0.04)"}` }}>
                <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, background: grandeursSel[g.key] ? accentColor : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {grandeursSel[g.key] && <CheckCircle size={9} color="white" />}
                </div>
                <span style={{ color: grandeursSel[g.key] ? theme.text : theme.muted, fontSize: 11 }}>{g.label}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ══ EXPORTS PAR SOURCE ══ */}
        <Card>
          <SectionHeader icon={Download} title={`Export — ${isSolaire ? "Solaire" : "Site"} uniquement`} subtitle={periodeLabel} color={accentColor} />
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

            {/* CSV */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: `${accentColor}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FileSpreadsheet size={17} color={accentColor} />
                </div>
                <div>
                  <div style={{ color: theme.text, fontWeight: 600, fontSize: 13 }}>CSV</div>
                  <div style={{ color: theme.muted, fontSize: 10 }}>Données brutes · {nbPoints ?? "?"} lignes</div>
                </div>
              </div>
              <button onClick={exportCSV} disabled={loading} style={{ background: loading ? "rgba(255,255,255,0.05)" : `${accentColor}20`, color: accentColor, border: `1px solid ${accentColor}30`, borderRadius: 8, padding: "7px 18px", fontSize: 12, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <Download size={13} />{loading ? "..." : "Télécharger"}
              </button>
            </div>

            {/* Excel */}
            <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 9, background: "rgba(34,197,94,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <FileSpreadsheet size={17} color="#22c55e" />
                </div>
                <div>
                  <div style={{ color: theme.text, fontWeight: 600, fontSize: 13 }}>Excel (.xlsx)</div>
                  <div style={{ color: theme.muted, fontSize: 10 }}>Données formatées avec styles</div>
                </div>
              </div>
              <button onClick={exportExcel} disabled={loadingExcel} style={{ background: loadingExcel ? "rgba(34,197,94,0.08)" : "rgba(34,197,94,0.15)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 8, padding: "7px 18px", fontSize: 12, fontWeight: 600, cursor: loadingExcel ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                <FileSpreadsheet size={13} />{loadingExcel ? "..." : "Télécharger"}
              </button>
            </div>

          </div>
        </Card>
      </div>

      {/* ══ RAPPORT COMPLET — Site + Solaire ══ */}
      <Card style={{ marginBottom: 20, border: "1px solid rgba(16,185,129,0.25)" }}>
        <SectionHeader icon={BarChart2} title="Rapport Complet — Site + Solaire"  color={theme.accent} />

        {/* KPIs bilan — icone Sun uniquement */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { icon: Sprout, color: theme.accent,  title: "Site Total",  val1: `${v(bilan?.kwh_total,1)} kWh`,      val2: `Coût ${v(bilan?.cout_sans,0)} DH` },
            { icon: Sun,    color: "#f59e0b",     title: "Solaire",     val1: `${v(bilan?.kwh_solaire,1)} kWh`,    val2: `Économies ${v(bilan?.economies,0)} DH` },
            { icon: Zap,    color: theme.accent2, title: "Réseau ONEE", val1: `${v(bilan?.kwh_reseau,1)} kWh`,     val2: `Payé ${v(bilan?.cout_avec,0)} DH` },
          ].map((item, i) => (
            <div key={i} style={{ background: `${item.color}08`, border: `1px solid ${item.color}18`, borderRadius: 10, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12 }}>
              <item.icon size={20} color={item.color} />
              <div>
                <div style={{ color: theme.muted, fontSize: 10, marginBottom: 2 }}>{item.title}</div>
                <div style={{ color: item.color, fontWeight: 700, fontSize: 14 }}>{item.val1}</div>
                <div style={{ color: theme.muted, fontSize: 10 }}>{item.val2}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Bouton export */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
          <button onClick={exportExcelComplet} disabled={loadingFull} style={{ background: loadingFull ? "rgba(34,197,94,0.12)" : "linear-gradient(135deg,#22c55e,#16a34a)", color: "white", border: "none", borderRadius: 12, padding: "14px 0", fontSize: 14, fontWeight: 700, cursor: loadingFull ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <FileSpreadsheet size={18} />
            {loadingFull ? "Génération Excel..." : "Rapport Excel Complet"}
          </button>
        </div>
      </Card>

      {/* MESSAGE */}
      {message && (
        <div style={{ padding: "14px 18px", borderRadius: 12, background: message.type === "ok" ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${message.type === "ok" ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}`, color: message.type === "ok" ? theme.accent : theme.danger, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 10 }}>
          {message.type === "ok" ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {message.text}
        </div>
      )}

    </div>
  );
}
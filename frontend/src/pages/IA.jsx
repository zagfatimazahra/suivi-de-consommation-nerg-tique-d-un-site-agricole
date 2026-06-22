import { useState, useEffect, useCallback } from "react";
import {
  Brain, TrendingUp, CheckCircle,
  RefreshCw, Zap, DollarSign, Target,
  Clock, Calendar, Shield, BarChart2, AlertCircle
} from "lucide-react";
import {
  ComposedChart, Area, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, AreaChart, BarChart
} from "recharts";

const API = "http://localhost:8000";

const theme = {
  green:  "#10b981", blue:   "#3b82f6", red:    "#ef4444",
  yellow: "#f59e0b", purple: "#8b5cf6", gray:   "#6b7280",
  text:   "#f9fafb", muted:  "#6b7280", sub:    "#9ca3af",
};

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: "linear-gradient(135deg,#111827,#1a2234)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 16, padding: 20, ...style,
    }}>{children}</div>
  );
}

function SectionHeader({ icon: Icon, title, color = theme.blue, right, subtitle }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Icon size={17} color={color} />
          </div>
          <div>
            <div style={{ color: theme.text, fontWeight: 700, fontSize: 15 }}>{title}</div>
            {subtitle && <div style={{ color: theme.muted, fontSize: 11, marginTop: 1 }}>{subtitle}</div>}
          </div>
        </div>
        {right && <div>{right}</div>}
      </div>
    </div>
  );
}

function KpiMini({ label, value, unit, color, sub }) {
  return (
    <div style={{ background: `${color}08`, border: `1px solid ${color}18`, borderRadius: 10, padding: "8px 14px", textAlign: "center", flex: 1 }}>
      <div style={{ color, fontWeight: 700, fontSize: 18 }}>
        {typeof value === "number" ? value.toLocaleString("fr") : value}
        <span style={{ fontSize: 11, fontWeight: 400, color: theme.sub, marginLeft: 3 }}>{unit}</span>
      </div>
      <div style={{ color: theme.muted, fontSize: 10, marginTop: 2 }}>{label}</div>
      {sub && <div style={{ color: `${color}80`, fontSize: 9, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function Jauge({ score, couleur, niveau }) {
  const dash = 220; const offset = dash * (1 - score / 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <svg width={140} height={100} viewBox="0 0 140 100">
        <path d="M 15 85 A 55 55 0 0 1 125 85" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={10} strokeLinecap="round" />
        <path d="M 15 85 A 55 55 0 0 1 125 85" fill="none" stroke={couleur} strokeWidth={10} strokeLinecap="round"
          strokeDasharray={dash} strokeDashoffset={offset} style={{ transition: "stroke-dashoffset 1s ease" }} />
        <text x={70} y={62} textAnchor="middle" fill={couleur} fontSize={28} fontWeight={700}>{score}</text>
        <text x={70} y={78} textAnchor="middle" fill="rgba(107,114,128,0.8)" fontSize={11}>/ 100</text>
      </svg>
      <span style={{ background: `${couleur}20`, color: couleur, fontSize: 12, fontWeight: 700, padding: "4px 14px", borderRadius: 20 }}>{niveau}</span>
    </div>
  );
}

function TabBtn({ active, label, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: active ? "rgba(139,92,246,0.2)" : "transparent",
      color: active ? theme.purple : theme.muted,
      border: active ? "1px solid rgba(139,92,246,0.35)" : "1px solid transparent",
      borderRadius: 8, padding: "6px 16px", fontSize: 12,
      cursor: "pointer", fontWeight: active ? 600 : 400,
    }}>{label}</button>
  );
}

function TooltipCustom({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#1f2937", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: "10px 14px", fontSize: 11 }}>
      <div style={{ color: theme.muted, marginBottom: 6, fontWeight: 600 }}>{label}</div>
      {payload.filter(p => p.value != null && p.value !== 0).map((p, i) => (
        <div key={i} style={{ color: p.color || theme.sub, marginBottom: 2 }}>
          {p.name}: <strong>{typeof p.value === "number" ? p.value.toFixed(1) : p.value}</strong>
          {p.unit ? ` ${p.unit}` : " kWh"}
        </div>
      ))}
    </div>
  );
}

function StatutBadge({ statut, precision, infoCompletude }) {
  if (statut === "reel" && precision != null) {
    const color = precision >= 80 ? theme.green : precision >= 65 ? theme.yellow : theme.red;
    return (
      <div style={{ background: `${color}15`, color, fontSize: 16, fontWeight: 700, padding: "4px 0", borderRadius: 8, textAlign: "center", marginTop: 6 }}>
        {precision}%
      </div>
    );
  }
  // ⭐ FIX : le backend renvoie statut="incomplet" (pas "partiel") pour les
  // journees ou la couverture de donnees est insuffisante (ex: Raspberry
  // deconnecte). On affiche alors la couverture reelle (nb_points / %).
  if (statut === "incomplet") {
    return (
      <div style={{ background: `${theme.gray}15`, color: theme.gray, fontSize: 11, fontWeight: 700, padding: "4px 0", borderRadius: 8, textAlign: "center", marginTop: 6, lineHeight: 1.2 }}>
        Incomplet
        <div style={{ fontSize: 8, fontWeight: 500, opacity: 0.85, marginTop: 1 }}>
          ⚠ Donnees partielles
        </div>
        {infoCompletude && (
          <div style={{ fontSize: 8, opacity: 0.6, marginTop: 1 }}>
            {infoCompletude.nb_points} pts · {infoCompletude.couverture_pct}% de 24h
          </div>
        )}
      </div>
    );
  }
  const map = {
    futur:        { bg: "rgba(139,92,246,0.12)",  color: theme.purple, text: "Prédit" },
    aujourd_hui:  { bg: "rgba(59,130,246,0.12)",  color: theme.blue,   text: "Aujourd'hui" },
    attente:      { bg: "rgba(245,158,11,0.12)",  color: theme.yellow, text: "En attente" },
    reel:         { bg: "rgba(16,185,129,0.12)",  color: theme.green,  text: "Réel" },
    vide:         { bg: "rgba(107,114,128,0.15)", color: theme.gray,   text: "Aucune donnée" },
  };
  const s = map[statut] || map.futur;
  return (
    <div style={{ background: s.bg, color: s.color, fontSize: 10, fontWeight: 600, padding: "4px 6px", borderRadius: 8, textAlign: "center", marginTop: 6, lineHeight: 1.3 }}>
      {s.text}
    </div>
  );
}

export default function IA({ source = "total" }) {
  const [score,       setScore]       = useState(null);
  const [pred24h,     setPred24h]     = useState(null);
  const [pred7j,      setPred7j]      = useState(null);
  const [predMois,    setPredMois]    = useState(null);
  const [predAnnee,   setPredAnnee]   = useState(null);
  const [comparaison, setComparaison] = useState(null);
  const [modele,      setModele]      = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [vuePred,     setVuePred]     = useState("mois");
  const [vueComp,     setVueComp]     = useState("jours");
  const [refresh,     setRefresh]     = useState(0);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p24, p7, pm, pa, comp, ml] = await Promise.all([
        fetch(`${API}/api/ia/score?source=${source}`).then(r => r.json()),
        fetch(`${API}/api/ia/prediction/24h`).then(r => r.json()),
        fetch(`${API}/api/ia/prediction/7j`).then(r => r.json()),
        fetch(`${API}/api/ia/prediction/mois?nb_mois=12`).then(r => r.json()),
        fetch(`${API}/api/ia/prediction/annee`).then(r => r.json()),
        fetch(`${API}/api/ia/comparaison`).then(r => r.json()),
        fetch(`${API}/api/ia/modele`).then(r => r.json()),
      ]);
      setScore(s); setPred24h(p24); setPred7j(p7); setPredMois(pm);
      setPredAnnee(pa); setComparaison(comp); setModele(ml);
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [source]);

  useEffect(() => { fetchAll(); }, [fetchAll, refresh]);

  const data24h = (pred24h?.predictions || []).map(p => ({
    h: p.heure, total: p.kwh_total, solaire: p.kwh_solaire, reseau: p.kwh_reseau,
  }));
  const data7j = (pred7j?.predictions || []).map(p => ({
    jour: p.jour, total: p.kwh_total, solaire: p.kwh_solaire, reseau: p.kwh_reseau,
  }));
  const dataMoisFuturs = (predMois?.predictions || [])
    .filter(p => p.est_futur)
    .map(p => ({
      mois: p.mois, total: p.kwh_predit, sol: p.kwh_sol_predit,
      reseau: p.kwh_reseau, cout: p.cout_predit,
      bas: p.intervalle_bas, haut: p.intervalle_haut,
    }));
  const dataAnnee = predAnnee?.predictions || [];
  const dataComp  = vueComp === "jours" ? (comparaison?.jours || []) : (comparaison?.mois || []);
  // ⭐ Affichage jours : a partir du premier jour "reel" (16 juin dans votre cas)
  // jusqu'a 7 jours max, pour ne pas remonter sur les jours "incomplet" anciens.
  const dataCompAffichee = vueComp === "jours"
    ? (() => {
        const idxReel = dataComp.findIndex(d => d.statut === "reel");
        const base = idxReel >= 0 ? dataComp.slice(idxReel) : dataComp;
        return base.slice(0, 7);
      })()
    : dataComp;
  const hasReel   = dataComp.some(d => d.kwh_reel != null);
  // ⭐ FIX : "incomplet" (pas "partiel") — journées exclues de la précision
  // car couverture de données insuffisante (ex: Raspberry déconnecté)
  const nbPartiels = vueComp === "jours"
    ? dataCompAffichee.filter(d => d.statut === "incomplet").length
    : dataComp.filter(d => d.statut === "incomplet").length;

  const precisionReelle    = comparaison?.precision_moy;
  const nbComparaisonsReel = comparaison?.nb_comparaisons || 0;

  const proch3   = predMois?.predictions?.filter(p => p.est_futur).slice(0, 3) || [];
  const totalP3  = proch3.reduce((s, p) => s + p.kwh_predit, 0);
  const coutP3   = proch3.reduce((s, p) => s + p.cout_predit, 0);
  const solP3    = proch3.reduce((s, p) => s + (p.kwh_sol_predit||0), 0);
  const reseauP3 = proch3.reduce((s, p) => s + p.kwh_reseau, 0);

  if (loading) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 300 }}>
      <div style={{ color: theme.muted, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <RefreshCw size={14} /> Chargement...
      </div>
    </div>
  );

  return (
    <div style={{ color: theme.text }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(139,92,246,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Brain size={20} color={theme.purple} />
            </div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Intelligence Artificielle</h2>
          </div>
          <p style={{ margin: 0, color: theme.muted, fontSize: 13, paddingLeft: 48 }}>
            Random Forest · {modele?.n || 17} mois d'entraînement · R²={modele?.r2 || "--"}
            {nbComparaisonsReel > 0 && (
              <span style={{ color: theme.green }}> · Précision réelle {precisionReelle}% sur {nbComparaisonsReel} jours</span>
            )}
          </p>
        </div>
        <button onClick={() => setRefresh(r => r+1)} style={{ background: "rgba(255,255,255,0.05)", color: theme.sub, border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "8px 16px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "210px 1fr 1fr 1fr 1fr", gap: 14, marginBottom: 20 }}>
        <Card style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div style={{ color: theme.muted, fontSize: 11, fontWeight: 600, alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6 }}>
            <Shield size={13} color={theme.purple} /> État électrique
          </div>
          {score && <Jauge score={score.score} couleur={score.couleur} niveau={score.niveau} />}
          {score?.alertes?.length === 0
            ? <div style={{ display: "flex", alignItems: "center", gap: 5, color: theme.green, fontSize: 11 }}><CheckCircle size={12} /> Paramètres normaux</div>
            : score?.alertes?.slice(0,2).map((a,i) => <div key={i} style={{ color: theme.red, fontSize: 10, textAlign: "center" }}>{a}</div>)
          }
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Zap size={13} color={theme.blue} opacity={0.7} />
            <span style={{ color: theme.muted, fontSize: 11, fontWeight: 500 }}>Prévision ce mois</span>
          </div>
          <div style={{ color: theme.muted, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Consommation totale site</div>
          <div style={{ color: theme.blue, fontWeight: 700, fontSize: 28, lineHeight: 1, marginBottom: 10 }}>
            {score?.prevision_mois ? Number(score.prevision_mois).toLocaleString("fr") : "--"}
            <span style={{ fontSize: 12, fontWeight: 400, color: theme.sub, marginLeft: 4 }}>kWh</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 6, padding: "4px 8px", flex: 1 }}>
              <div style={{ color: theme.muted, fontSize: 9 }}>Production solaire</div>
              <div style={{ color: theme.yellow, fontWeight: 700, fontSize: 12 }}>
                {score?.prevision_mois_solaire ? Number(score.prevision_mois_solaire).toLocaleString("fr") : "--"} kWh
              </div>
            </div>
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 6, padding: "4px 8px", flex: 1 }}>
              <div style={{ color: theme.muted, fontSize: 9 }}>Achat réseau ONEE</div>
              <div style={{ color: theme.red, fontWeight: 700, fontSize: 12 }}>
                {score?.prevision_mois_reseau ? Number(score.prevision_mois_reseau).toLocaleString("fr") : "--"} kWh
              </div>
            </div>
          </div>
          <div style={{ color: theme.muted, fontSize: 9, marginTop: 6 }}>Modèle Random Forest</div>
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <TrendingUp size={13} color={theme.purple} opacity={0.7} />
            <span style={{ color: theme.muted, fontSize: 11, fontWeight: 500 }}>Prévision 3 mois</span>
          </div>
          <div style={{ color: theme.muted, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Consommation totale</div>
          <div style={{ color: theme.purple, fontWeight: 700, fontSize: 28, lineHeight: 1, marginBottom: 10 }}>
            {totalP3 > 0 ? Math.round(totalP3).toLocaleString("fr") : "--"}
            <span style={{ fontSize: 12, fontWeight: 400, color: theme.sub, marginLeft: 4 }}>kWh</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.15)", borderRadius: 6, padding: "4px 8px", flex: 1 }}>
              <div style={{ color: theme.muted, fontSize: 9 }}>Solaire prévu</div>
              <div style={{ color: theme.yellow, fontWeight: 700, fontSize: 12 }}>{solP3 > 0 ? Math.round(solP3).toLocaleString("fr") : "--"} kWh</div>
            </div>
            <div style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.15)", borderRadius: 6, padding: "4px 8px", flex: 1 }}>
              <div style={{ color: theme.muted, fontSize: 9 }}>Réseau prévu</div>
              <div style={{ color: theme.red, fontWeight: 700, fontSize: 12 }}>{reseauP3 > 0 ? Math.round(reseauP3).toLocaleString("fr") : "--"} kWh</div>
            </div>
          </div>
          <div style={{ color: theme.muted, fontSize: 9, marginTop: 6 }}>{proch3.map(p => p.mois).join(" · ")}</div>
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <DollarSign size={13} color={theme.yellow} opacity={0.7} />
            <span style={{ color: theme.muted, fontSize: 11, fontWeight: 500 }}>Coût estimé 3 mois</span>
          </div>
          <div style={{ color: theme.muted, fontSize: 9, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>Énergie achetée ONEE</div>
          <div style={{ color: theme.yellow, fontWeight: 700, fontSize: 28, lineHeight: 1, marginBottom: 10 }}>
            {coutP3 > 0 ? Math.round(coutP3).toLocaleString("fr") : "--"}
            <span style={{ fontSize: 12, fontWeight: 400, color: theme.sub, marginLeft: 4 }}>DH</span>
          </div>
          <div style={{ background: "rgba(245,158,11,0.08)", borderRadius: 8, padding: "6px 10px" }}>
            <div style={{ color: theme.sub, fontSize: 10, lineHeight: 1.5 }}>
              Réseau × Tarif moyen MT<br />
              <span style={{ color: theme.yellow }}>HN(60%) + HC(25%) + HP(15%)</span>
            </div>
            <div style={{ color: theme.muted, fontSize: 9, marginTop: 3 }}>Hors frais fixes PS/entretien</div>
          </div>
        </Card>

        <Card>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <Target size={13} color={precisionReelle >= 80 ? theme.green : theme.muted} opacity={0.7} />
            <span style={{ color: theme.muted, fontSize: 11, fontWeight: 500 }}>Précision réelle</span>
          </div>
          {nbComparaisonsReel > 0 ? (
            <>
              <div style={{ color: precisionReelle >= 80 ? theme.green : theme.yellow, fontWeight: 700, fontSize: 28, lineHeight: 1, marginBottom: 8 }}>
                {precisionReelle}%
              </div>
              <div style={{ width: "100%", height: 5, background: "rgba(255,255,255,0.06)", borderRadius: 3, marginBottom: 6 }}>
                <div style={{ width: `${Math.min(precisionReelle,100)}%`, height: "100%", background: precisionReelle >= 80 ? theme.green : theme.yellow, borderRadius: 3 }} />
              </div>
              <div style={{ color: theme.muted, fontSize: 10 }}>
                {nbComparaisonsReel} {nbComparaisonsReel === 1 ? "jour complet" : "jours complets"}
              </div>
              {nbPartiels > 0 && (
                <div style={{ color: theme.gray, fontSize: 9, marginTop: 2 }}>
                  + {nbPartiels} {nbPartiels === 1 ? "jour incomplet" : "jours incomplets"}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ color: theme.muted, fontWeight: 700, fontSize: 22, lineHeight: 1, marginBottom: 8 }}>En attente</div>
              <div style={{ background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", borderRadius: 8, padding: "8px 10px" }}>
                <div style={{ color: theme.sub, fontSize: 10, lineHeight: 1.5 }}>
                  Disponible dès qu'une journée complète arrive dans InfluxDB
                </div>
              </div>
            </>
          )}
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <SectionHeader
          icon={TrendingUp}
          title="Prédictions futures"
          subtitle="Basées sur le modèle Random Forest entraîné sur 17 mois d'historique"
          color={theme.blue}
          right={
            <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: 3 }}>
              {[{ id:"24h",label:"24h" },{ id:"7j",label:"7 jours" },{ id:"mois",label:"12 mois" },{ id:"annee",label:"Annuel" }].map(t => (
                <TabBtn key={t.id} active={vuePred===t.id} label={t.label} onClick={() => setVuePred(t.id)} />
              ))}
            </div>
          }
        />

        {vuePred === "24h" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <KpiMini label="Conso. totale site"  value={pred24h?.total_kwh   || "--"} unit="kWh" color={theme.blue}   sub="Solaire + Réseau" />
              <KpiMini label="Production solaire"  value={pred24h?.solaire_kwh || "--"} unit="kWh" color={theme.yellow} sub="Autoconsommée" />
              <KpiMini label="Achat réseau ONEE"   value={pred24h?.reseau_kwh  || "--"} unit="kWh" color={theme.red}    sub="Facturé ONEE" />
              <KpiMini label="Coût réseau estimé"  value={pred24h?.cout_total  || "--"} unit="DH"  color={theme.green}  sub="Réseau × tarif MT" />
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={data24h} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <defs>
                  {[[theme.blue,"gT"],[theme.yellow,"gS"],[theme.red,"gR"]].map(([c,id]) => (
                    <linearGradient key={id} id={id} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={c} stopOpacity={0.2} />
                      <stop offset="95%" stopColor={c} stopOpacity={0}   />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="h" stroke={theme.muted} tick={{ fontSize: 10 }} />
                <YAxis stroke={theme.muted} tick={{ fontSize: 10 }} />
                <Tooltip content={<TooltipCustom />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="total"   name="Conso. totale"  stroke={theme.blue}   fill="url(#gT)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="solaire" name="Prod. solaire"  stroke={theme.yellow} fill="url(#gS)" strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="reseau"  name="Achat réseau"   stroke={theme.red}    fill="url(#gR)" strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </>
        )}

        {vuePred === "7j" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
              <KpiMini label="Conso. totale 7j"   value={pred7j?.total_kwh   || "--"} unit="kWh" color={theme.blue}   sub="Solaire + Réseau" />
              <KpiMini label="Production solaire" value={pred7j?.solaire_kwh || "--"} unit="kWh" color={theme.yellow} sub="Autoconsommée" />
              <KpiMini label="Achat réseau ONEE"  value={pred7j?.reseau_kwh  || "--"} unit="kWh" color={theme.red}    sub="Facturé ONEE" />
              <KpiMini label="Coût réseau estimé" value={pred7j?.cout_total  || "--"} unit="DH"  color={theme.green}  sub="Réseau × tarif" />
              <div style={{ color: theme.muted, fontSize: 11, textAlign: "right", flexShrink: 0 }}>
                Weekend −35%<br /><span style={{ fontSize: 10 }}>Vendredi −15%</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data7j} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="jour" stroke={theme.muted} tick={{ fontSize: 9 }} />
                <YAxis stroke={theme.muted} tick={{ fontSize: 10 }} />
                <Tooltip content={<TooltipCustom />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total"   name="Conso. totale" fill={theme.blue}   radius={[4,4,0,0]} opacity={0.8} />
                <Bar dataKey="solaire" name="Prod. solaire" fill={theme.yellow} radius={[4,4,0,0]} opacity={0.8} />
                <Bar dataKey="reseau"  name="Achat réseau"  fill={theme.red}    radius={[4,4,0,0]} opacity={0.7} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}

        {vuePred === "mois" && (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <KpiMini label="Conso. totale 12 mois"
                value={Math.round(dataMoisFuturs.reduce((s,d) => s+d.total, 0)).toLocaleString("fr")}
                unit="kWh" color={theme.blue} sub="Consommation totale site" />
              <KpiMini label="Production solaire 12 mois"
                value={Math.round(dataMoisFuturs.reduce((s,d) => s+(d.sol||0), 0)).toLocaleString("fr")}
                unit="kWh" color={theme.yellow} sub="Autoconsommée" />
              <KpiMini label="Achat réseau 12 mois"
                value={Math.round(dataMoisFuturs.reduce((s,d) => s+d.reseau, 0)).toLocaleString("fr")}
                unit="kWh" color={theme.red} sub="Facturé ONEE" />
              <KpiMini label="Coût réseau 12 mois"
                value={Math.round(dataMoisFuturs.reduce((s,d) => s+d.cout, 0)).toLocaleString("fr")}
                unit="DH" color={theme.green} sub="Réseau × tarif MT" />
            </div>
            <div style={{ display: "flex", gap: 16, marginBottom: 12, fontSize: 11, color: theme.muted, alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: theme.blue, display: "inline-block" }} />
                Consommation totale prédite
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: theme.yellow, display: "inline-block" }} />
                Production solaire prédite
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: theme.red, display: "inline-block" }} />
                Achat réseau prédit
              </span>
              <span style={{ marginLeft: "auto" }}>Intervalle ±12% · R²={modele?.r2}</span>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={dataMoisFuturs} margin={{ top: 5, right: 10, bottom: 22, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="mois" stroke={theme.muted} tick={{ fontSize: 9 }} angle={-30} textAnchor="end" />
                <YAxis stroke={theme.muted} tick={{ fontSize: 10 }} />
                <Tooltip content={<TooltipCustom />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="total"  name="Conso. totale" fill={theme.blue}   radius={[4,4,0,0]} opacity={0.8} />
                <Bar dataKey="sol"    name="Prod. solaire" fill={theme.yellow} radius={[4,4,0,0]} opacity={0.8} />
                <Bar dataKey="reseau" name="Achat réseau"  fill={theme.red}    radius={[4,4,0,0]} opacity={0.7} />
                <Line type="monotone" dataKey="haut" stroke={theme.blue} strokeDasharray="4 3" dot={false} strokeWidth={1} opacity={0.25} legendType="none" />
                <Line type="monotone" dataKey="bas"  stroke={theme.blue} strokeDasharray="4 3" dot={false} strokeWidth={1} opacity={0.25} legendType="none" />
              </ComposedChart>
            </ResponsiveContainer>
          </>
        )}

        {vuePred === "annee" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            {dataAnnee.map((a, i) => (
              <div key={i} style={{ background: a.est_futur ? "rgba(139,92,246,0.06)" : "rgba(16,185,129,0.06)", border: `1px solid ${a.est_futur ? "rgba(139,92,246,0.18)" : "rgba(16,185,129,0.18)"}`, borderRadius: 14, padding: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                  <span style={{ color: theme.text, fontWeight: 700, fontSize: 24 }}>{a.annee}</span>
                  <span style={{ background: a.est_futur ? "rgba(139,92,246,0.15)" : "rgba(16,185,129,0.15)", color: a.est_futur ? theme.purple : theme.green, fontSize: 11, padding: "3px 12px", borderRadius: 20, fontWeight: 700 }}>
                    {a.est_futur ? "Prédiction" : "Partiel + prédit"}
                  </span>
                </div>
                {[
                  { l: "Consommation totale site", v: `${(a.kwh_predit/1000).toFixed(1)} MWh`,  c: theme.blue,   info: "Solaire + Réseau" },
                  { l: "Production solaire",       v: `${(a.kwh_solaire/1000).toFixed(1)} MWh`, c: theme.yellow, info: "Autoconsommée" },
                  { l: "Achat réseau ONEE",        v: `${(a.kwh_reseau/1000).toFixed(1)} MWh`,  c: theme.red,    info: "Total − Solaire" },
                  { l: "Coût énergie réseau",      v: `${Math.round(a.cout_predit/1000)} kDH`,  c: theme.green,  info: "Réseau × tarif MT" },
                ].map((item, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div>
                      <div style={{ color: theme.muted, fontSize: 12 }}>{item.l}</div>
                      <div style={{ color: `${item.c}55`, fontSize: 10 }}>{item.info}</div>
                    </div>
                    <span style={{ color: item.c, fontWeight: 700, fontSize: 14 }}>{item.v}</span>
                  </div>
                ))}
                {a.kwh_reel && (
                  <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(16,185,129,0.08)", borderRadius: 8 }}>
                    <div style={{ color: theme.muted, fontSize: 10, marginBottom: 2 }}>Réel disponible</div>
                    <span style={{ color: theme.green, fontWeight: 700, fontSize: 14 }}>{(a.kwh_reel/1000).toFixed(1)} MWh</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <SectionHeader
          icon={BarChart2}
          title="Prédiction vs Réel"
          subtitle="Comparaison automatique — prédictions sauvegardées vs données réelles InfluxDB"
          color={theme.green}
          right={
            <div style={{ display: "flex", gap: 4, background: "rgba(255,255,255,0.04)", borderRadius: 9, padding: 3 }}>
              <TabBtn active={vueComp === "jours"} label="Jours" onClick={() => setVueComp("jours")} />
              <TabBtn active={vueComp === "mois"}  label="Mois"  onClick={() => setVueComp("mois")}  />
            </div>
          }
        />

        {nbPartiels > 0 && (
          <div style={{ background: "rgba(107,114,128,0.08)", border: "1px solid rgba(107,114,128,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
            <AlertCircle size={16} color={theme.gray} />
            <div style={{ fontSize: 12 }}>
              <span style={{ color: theme.text, fontWeight: 600 }}>{nbPartiels} {nbPartiels === 1 ? "journée incomplète" : "journées incomplètes"}</span>
              <span style={{ color: theme.muted }}> — Couverture de données insuffisante (ex: capteur déconnecté) : exclues de la précision moyenne.</span>
            </div>
          </div>
        )}

        {dataCompAffichee.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(dataCompAffichee.length, 8)}, 1fr)`, gap: 8, marginBottom: 16 }}>
            {dataCompAffichee.map((item, i) => {
              const isIncomplet = item.statut === "incomplet";
              const isVide    = item.statut === "vide";
              const isReel    = item.statut === "reel";
              const prec  = item.precision;
              
              let color;
              if (isReel && prec != null) {
                color = prec >= 80 ? theme.green : prec >= 65 ? theme.yellow : theme.red;
              } else if (isIncomplet || isVide) {
                color = theme.gray;
              } else if (item.statut === "futur") {
                color = theme.purple;
              } else {
                color = theme.yellow;
              }
              
              return (
                <div key={i} style={{ background: `${color}06`, border: `1px solid ${color}18`, borderRadius: 10, padding: "10px 12px", opacity: (isIncomplet || isVide) ? 0.9 : 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ color: theme.muted, fontSize: 10, fontWeight: 600 }}>{item.label}</span>
                  </div>
                  <div style={{ marginBottom: 5 }}>
                    <div style={{ color: theme.muted, fontSize: 9, marginBottom: 1 }}>Total prédit</div>
                    <div style={{ color: theme.text, fontWeight: 700, fontSize: 13 }}>
                      {item.kwh_predit?.toLocaleString("fr")} kWh
                    </div>
                    {item.details?.kwh_solaire != null && (
                      <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                        <span style={{ color: theme.yellow, fontSize: 9 }}>Sol. {item.details.kwh_solaire}</span>
                        <span style={{ color: theme.red,    fontSize: 9 }}>Rés. {item.details.kwh_reseau}</span>
                      </div>
                    )}
                  </div>
                  {item.kwh_reel != null && (
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 5, marginBottom: 4 }}>
                      <div style={{ color: theme.muted, fontSize: 9, marginBottom: 1 }}>Total réel mesuré</div>
                      <div style={{ color: isIncomplet ? theme.gray : theme.green, fontWeight: 700, fontSize: 13 }}>
                        {item.kwh_reel?.toLocaleString("fr")} kWh
                      </div>
                    </div>
                  )}
                  <StatutBadge statut={item.statut} precision={prec} infoCompletude={item.info_completude} />
                </div>
              );
            })}
          </div>
        )}

        {hasReel && dataCompAffichee.some(d => d.statut === "reel") ? (
          <>
            <div style={{ color: theme.muted, fontSize: 11, marginBottom: 10 }}>
              Consommation totale du site — prédit vs réel (journées complètes uniquement)
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={dataCompAffichee.filter(d => d.statut === "reel")} margin={{ top: 5, right: 50, bottom: 10, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                <XAxis dataKey="label" stroke={theme.muted} tick={{ fontSize: 9 }} />
                <YAxis yAxisId="kwh" stroke={theme.muted} tick={{ fontSize: 9 }} />
                <YAxis yAxisId="pct" orientation="right" stroke={theme.yellow} tick={{ fontSize: 9, fill: theme.yellow }} unit="%" domain={[0, 110]} />
                <Tooltip content={<TooltipCustom />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="kwh" dataKey="kwh_reel"   name="Réel (total)" fill={theme.green}  opacity={0.85} radius={[4,4,0,0]} />
                <Bar yAxisId="kwh" dataKey="kwh_predit" name="Prédit ML"     fill={theme.purple} opacity={0.65} radius={[4,4,0,0]} />
                <Line yAxisId="pct" type="monotone" dataKey="precision" name="Précision %" stroke={theme.yellow} strokeWidth={2} dot={{ r: 4, fill: theme.yellow }} unit="%" />
                <ReferenceLine yAxisId="pct" y={80} stroke={theme.green} strokeDasharray="4 4" strokeWidth={1} opacity={0.4} />
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: theme.muted }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: theme.green, display: "inline-block" }} /> Réel total
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: theme.purple, opacity: 0.7, display: "inline-block" }} /> Prédit ML
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 16, height: 0, borderTop: `2px solid ${theme.yellow}`, display: "inline-block" }} /> Précision %
              </span>
              {precisionReelle && (
                <span style={{ marginLeft: "auto", color: precisionReelle >= 80 ? theme.green : theme.yellow, fontWeight: 600 }}>
                  Précision moyenne : {precisionReelle}% · {nbComparaisonsReel} jours complets
                </span>
              )}
            </div>
          </>
        ) : (
          !hasReel && (
            <div style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.12)", borderRadius: 10, padding: "14px 18px", display: "flex", gap: 12 }}>
              <Clock size={16} color={theme.purple} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ color: theme.text, fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                  Prédictions sauvegardées — En attente de données réelles
                </div>
                <div style={{ color: theme.muted, fontSize: 12, lineHeight: 1.5 }}>
                  Dès qu'une journée complète arrive dans InfluxDB, le graphique s'affiche.
                </div>
              </div>
            </div>
          )
        )}
      </Card>

    </div>
  );
}
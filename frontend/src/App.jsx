import { useState } from "react";
import {
  LayoutDashboard, TrendingUp, Bell, Download,
  LogOut, Sun, Sprout, BarChart2, Brain
} from "lucide-react";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Analyse from "./pages/Analyse";
import Alertes from "./pages/Alertes";
import Export from "./pages/Export";
import Bilan from "./pages/Bilan";
import IA from "./pages/IA";

const theme = {
  bg:      "#0a0f1e",
  card:    "#111827",
  border:  "#1f2937",
  accent:  "#10b981",
  accent2: "#3b82f6",
  text:    "#f9fafb",
  muted:   "#6b7280",
};

const navItems = [
  { id: "home",    label: "Accueil",  icon: LayoutDashboard },
  { id: "analyse", label: "Analyse",  icon: TrendingUp      },
  { id: "bilan",   label: "Bilan",    icon: BarChart2       },
  { id: "alertes", label: "Alertes",  icon: Bell            },
  { id: "ia",      label: "IA",       icon: Brain           },
  { id: "export",  label: "Export",   icon: Download        },
];

const SOURCES = [
  { id: "total",   label: "Site",    icon: Sprout, color: "#10b981" },
  { id: "solaire", label: "Solaire", icon: Sun,    color: "#f59e0b" },
];

export default function App() {
  const [page,   setPage]   = useState("home");
  const [source, setSource] = useState("total");

  const isLoggedIn = localStorage.getItem("token");
  if (!isLoggedIn) return <Login />;

  const logout = () => {
    localStorage.removeItem("token");
    window.location.reload();
  };

  const currentSource = SOURCES.find(s => s.id === source);

  return (
    <div style={{
      minHeight: "100vh",
      background: theme.bg,
      color: theme.text,
      fontFamily: "'Segoe UI', sans-serif",
      display: "flex",
      flexDirection: "column",
    }}>

      {/* NAVBAR */}
      <div style={{
        background: "rgba(17,24,39,0.95)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        padding: "0 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: 60,
        position: "sticky",
        top: 0,
        zIndex: 100,
        boxShadow: "0 2px 20px rgba(0,0,0,0.3)",
      }}>

        {/* LEFT — LOGO + NAV */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>

          {/* LOGO */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 16 }}>
            <img
              src="/src/assets/logo.png"
              alt="Logo"
              style={{ height: 36, width: "auto", objectFit: "contain", borderRadius: 8, background: "white", padding: "2px 6px" }}
            />
            <span style={{ color: "#f9fafb", fontWeight: 700, fontSize: 16 }}>AzuraEnergie</span>
          </div>

          {/* NAV ITEMS */}
          {navItems.map(item => {
            const Icon   = item.icon;
            const active = page === item.id;
            const isIA   = item.id === "ia";
            return (
              <button
                key={item.id}
                onClick={() => setPage(item.id)}
                style={{
                  background: active
                    ? isIA ? "rgba(139,92,246,0.15)" : "rgba(16,185,129,0.15)"
                    : "transparent",
                  color: active
                    ? isIA ? "#8b5cf6" : "#10b981"
                    : "#6b7280",
                  border: active
                    ? `1px solid ${isIA ? "rgba(139,92,246,0.3)" : "rgba(16,185,129,0.3)"}`
                    : "1px solid transparent",
                  borderRadius: 10, padding: "7px 14px",
                  cursor: "pointer", fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  display: "flex", alignItems: "center", gap: 6,
                  transition: "all 0.2s",
                }}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

          {/* SELECTEUR SOURCE */}
          <div style={{
            display: "flex", gap: 4,
            background: "rgba(255,255,255,0.04)",
            borderRadius: 10, padding: 4,
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {SOURCES.map(s => {
              const Icon   = s.icon;
              const active = source === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setSource(s.id)}
                  style={{
                    background: active ? `${s.color}20` : "transparent",
                    color:      active ? s.color : "#6b7280",
                    border:     active ? `1px solid ${s.color}40` : "1px solid transparent",
                    borderRadius: 8, padding: "5px 14px",
                    cursor: "pointer", fontSize: 12,
                    fontWeight: active ? 600 : 400,
                    display: "flex", alignItems: "center", gap: 5,
                    transition: "all 0.2s",
                  }}
                >
                  <Icon size={13} />
                  <span>{s.label}</span>
                </button>
              );
            })}
          </div>

          {/* USER */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10, padding: "6px 12px",
          }}>
            <div style={{ width: 26, height: 26, background: "linear-gradient(135deg, #3b82f6, #1d4ed8)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "white" }}>A</div>
            <span style={{ color: "#d1d5db", fontSize: 12, fontWeight: 500 }}>Admin</span>
          </div>

          {/* LOGOUT */}
          <button onClick={logout} style={{
            background: "rgba(239,68,68,0.1)", color: "#fca5a5",
            border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, padding: "7px 14px",
            cursor: "pointer", fontSize: 12, fontWeight: 600,
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <LogOut size={13} />
            <span>Deconnexion</span>
          </button>
        </div>
      </div>

      {/* CONTENU */}
      <div style={{ padding: "24px", flex: 1 }}>
        {page === "home"    && <Home    source={source} />}
        {page === "analyse" && <Analyse source={source} />}
        {page === "bilan"   && <Bilan   source={source} />}
        {page === "alertes" && <Alertes source={source} />}
        {page === "ia"      && <IA      source={source} />}
        {page === "export"  && <Export  source={source} />}
      </div>

      {/* FOOTER */}
      <div style={{
        borderTop: "1px solid rgba(255,255,255,0.05)",
        padding: "10px 24px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "rgba(17,24,39,0.5)",
      }}>
        <span style={{ color: "#374151", fontSize: 12 }}>AzuraEnergie — Supervision énergétique IoT</span>
        <span style={{ color: "#374151", fontSize: 12 }}>PFE Master 2026</span>
      </div>
    </div>
  );
}
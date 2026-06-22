import { useState } from "react";
import { User, Lock, LogIn } from "lucide-react";

// ✅ FIX : credentials déplacés en constante (plus facile à modifier)
const VALID_USER = "admin";
const VALID_PASS = "admin123";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleLogin = () => {
    // ✅ FIX : effacer l'erreur précédente avant chaque tentative
    setError("");
    setLoading(true);
    setTimeout(() => {
      if (username === VALID_USER && password === VALID_PASS) {
        // ✅ FIX : stocker aussi le timestamp de connexion pour pouvoir expirer la session
        localStorage.setItem("token", "connected");
        localStorage.setItem("token_time", Date.now().toString());
        window.location.reload();
      } else {
        setError("Nom utilisateur ou mot de passe incorrect");
        setLoading(false);
      }
    }, 800);
  };

  // ✅ FIX : gestion de la touche Entrée centralisée proprement
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && username && password && !loading) {
      handleLogin();
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      fontFamily: "'Segoe UI', sans-serif",
      position: "relative",
      overflow: "hidden",
    }}>

      {/* Cercles decoratifs */}
      <div style={{
        position: "absolute", width: 400, height: 400,
        borderRadius: "50%", top: -100, left: -100,
        background: "radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />
      <div style={{
        position: "absolute", width: 300, height: 300,
        borderRadius: "50%", bottom: -50, right: -50,
        background: "radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%)",
        pointerEvents: "none",
      }} />

      <div style={{
        width: 420,
        background: "rgba(17,24,39,0.9)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 24,
        padding: "48px 40px",
        boxShadow: "0 25px 50px rgba(0,0,0,0.5)",
        position: "relative",
        zIndex: 1,
      }}>

        {/* LOGO */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <img
            src="/src/assets/logo.png"
            alt="Logo Entreprise"
            style={{
              height: 80,
              width: "auto",
              objectFit: "contain",
              borderRadius: 12,
              background: "white",
              padding: "6px 12px",
              margin: "0 auto 16px",
              display: "block",

            }}
          />
          <h1 style={{ color: "#f9fafb", margin: 0, fontSize: 24, fontWeight: 700 }}>
            AzuraEnergie 
          </h1>
        </div>

        {/* ERREUR */}
        {error && (
          <div style={{
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#fca5a5",
            padding: "10px 14px",
            borderRadius: 10,
            marginBottom: 20,
            fontSize: 13,
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <Lock size={14} /> {error}
          </div>
        )}

        {/* USERNAME */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ color: "#9ca3af", fontSize: 13, display: "block", marginBottom: 8, fontWeight: 500 }}>
            Nom utilisateur
          </label>
          <div style={{ position: "relative" }}>
            <div style={{
              position: "absolute", left: 14, top: "50%",
              transform: "translateY(-50%)",
              color: "#6b7280",
            }}>
              <User size={16} />
            </div>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="username"
              style={{
                width: "100%", padding: "13px 14px 13px 42px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12, color: "#f9fafb", fontSize: 14,
                outline: "none", boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "#10b981"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
            />
          </div>
        </div>

        {/* PASSWORD */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ color: "#9ca3af", fontSize: 13, display: "block", marginBottom: 8, fontWeight: 500 }}>
            Mot de passe
          </label>
          <div style={{ position: "relative" }}>
            <div style={{
              position: "absolute", left: 14, top: "50%",
              transform: "translateY(-50%)",
              color: "#6b7280",
            }}>
              <Lock size={16} />
            </div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="••••••••"
              style={{
                width: "100%", padding: "13px 14px 13px 42px",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12, color: "#f9fafb", fontSize: 14,
                outline: "none", boxSizing: "border-box",
              }}
              onFocus={e => e.target.style.borderColor = "#10b981"}
              onBlur={e => e.target.style.borderColor = "rgba(255,255,255,0.1)"}
            />
          </div>
        </div>

        {/* BUTTON */}
        <button
          onClick={handleLogin}
          disabled={loading || !username || !password}
          style={{
            width: "100%",
            background: loading || !username || !password
              ? "rgba(16,185,129,0.4)"
              : "linear-gradient(135deg, #10b981, #059669)",
            color: "white", border: "none", padding: "14px",
            borderRadius: 12, fontSize: 15, fontWeight: 600,
            cursor: loading || !username || !password ? "not-allowed" : "pointer",
            boxShadow: "0 4px 15px rgba(16,185,129,0.3)",
            display: "flex", alignItems: "center",
            justifyContent: "center", gap: 8,
          }}
        >
          <LogIn size={18} />
          <span>{loading ? "Connexion..." : "Se connecter"}</span>
        </button>

        {/* FOOTER */}
        <div style={{ textAlign: "center", marginTop: 24, color: "#4b5563", fontSize: 12 }}>
          Supervision énergetique temps réel
        </div>
      </div>
    </div>
  );
}

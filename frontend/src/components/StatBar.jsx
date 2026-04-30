import { useState, useEffect } from "react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:       "#040f20",
  border:   "rgba(0,170,210,0.15)",
  accent:   "#00aacc",
  normal:   "#00e676",
  warning:  "#ffab40",
  distress: "#ff3b55",
  textH:    "#d4eeff",
  textP:    "#2d5a78",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }
function nowStr() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ── Wave / swimmer SVG icon ───────────────────────────────────────────────────

function WaveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="#a8dff5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12 C5 8,9 8,12 12 C15 16,19 16,22 12" />
      <circle cx="19" cy="6.5" r="2" fill="#a8dff5" stroke="none" />
      <path d="M17 8.5 L13 12.5" />
    </svg>
  );
}

// ── Individual stat block ─────────────────────────────────────────────────────

function StatBlock({ label, value, color, pulse = false, divider = true }) {
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      padding: "0 24px",
      borderLeft: divider ? `1px solid rgba(0,170,210,0.1)` : "none",
      gap: 3,
    }}>
      <span style={{
        fontSize: 26,
        fontWeight: 700,
        color,
        fontFamily: "'JetBrains Mono', 'Consolas', monospace",
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
        textShadow: pulse ? `0 0 14px ${color}` : "none",
        transition: "color 0.4s, text-shadow 0.4s",
        animation: pulse ? "numPulse 1.8s ease-in-out infinite" : "none",
      }}>
        {value}
      </span>
      <span style={{
        fontSize: 9,
        color: "#1e4060",
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        fontWeight: 500,
      }}>
        {label}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function StatBar({
  swimmers = [],
  activeAlerts = [],
  isConnected = false,
  fps = 0,
  sourceName,
  onOpenSources,
  videoEnded = false,
  onReplay,
}) {
  const [time, setTime] = useState(nowStr);
  useEffect(() => {
    const id = setInterval(() => setTime(nowStr()), 1000);
    return () => clearInterval(id);
  }, []);

  const distressCount = activeAlerts.filter((a) => a.status === "distress").length;
  const warnCount     = activeAlerts.filter((a) => a.status === "warning").length;

  const alertColor    = activeAlerts.length > 0 ? C.distress : "#1e4060";
  const distressColor = distressCount    > 0 ? C.distress : "#1e4060";
  const warnColor     = warnCount        > 0 ? C.warning  : "#1e4060";
  const fpsColor      = fps >= 20 ? C.normal : fps >= 10 ? C.warning : C.distress;

  return (
    <div style={{
      height: 68,
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      background: C.bg,
      borderBottom: `1px solid ${C.border}`,
      padding: "0 20px",
      position: "relative",
      overflow: "hidden",
    }}>

      {/* ── Subtle animated gradient top line ─────────────────────────────── */}
      <div style={{
        position: "absolute",
        top: 0, left: 0, right: 0,
        height: 2,
        background: "linear-gradient(90deg, transparent 0%, #00aacc 30%, #0060aa 70%, transparent 100%)",
        animation: "scanH 4s linear infinite",
        opacity: 0.6,
      }} />

      {/* ── Left: logo ────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 210, flexShrink: 0 }}>
        <div style={{
          width: 38, height: 38,
          borderRadius: 9,
          background: "linear-gradient(145deg, #003d88, #006cb5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 0 16px rgba(0,140,200,0.35)",
          flexShrink: 0,
        }}>
          <WaveIcon />
        </div>
        <div>
          <div style={{
            fontSize: 15, fontWeight: 800,
            color: C.textH,
            letterSpacing: "0.12em",
            lineHeight: 1.1,
          }}>
            AQUAGUARD
          </div>
          <div style={{
            fontSize: 9, color: "#1a3d58",
            letterSpacing: "0.14em",
            marginTop: 2,
          }}>
            AI SWIMMER MONITORING
          </div>
        </div>
      </div>

      {/* ── Center: stat blocks ────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}>
        <StatBlock label="Active Alerts"   value={activeAlerts.length}  color={alertColor}    pulse={activeAlerts.length > 0} divider={false} />
        <StatBlock label="Distress"        value={distressCount}        color={distressColor} pulse={distressCount > 0} />
        <StatBlock label="Warning"         value={warnCount}            color={warnColor}     pulse={warnCount > 0} />
        <StatBlock label="FPS"             value={(fps || 0).toFixed(1)} color={fpsColor} />
      </div>

      {/* ── Right: connection + time + source ─────────────────────────────── */}
      <div style={{
        minWidth: 210,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 5,
        flexShrink: 0,
      }}>
        {/* Connection row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 7, height: 7, borderRadius: "50%",
            background: isConnected ? C.normal : C.distress,
            boxShadow: isConnected ? `0 0 8px ${C.normal}` : `0 0 8px ${C.distress}`,
          }} />
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
            color: isConnected ? C.normal : C.distress,
          }}>
            {isConnected ? "LIVE" : "OFFLINE"}
          </span>
          <span style={{
            fontSize: 13,
            color: "#2d5a78",
            fontFamily: "monospace",
            fontVariantNumeric: "tabular-nums",
          }}>
            {time}
          </span>
        </div>

        {/* Bottom row: source picker + optional replay button */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={onOpenSources}
            style={{
              background: "rgba(0,150,190,0.08)",
              border: "1px solid rgba(0,150,190,0.22)",
              borderRadius: 5,
              color: "#2d6a8a",
              cursor: "pointer",
              fontSize: 10,
              padding: "3px 10px",
              letterSpacing: "0.07em",
              display: "flex", alignItems: "center", gap: 5,
              fontFamily: "monospace",
              transition: "border-color 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,170,210,0.5)";
              e.currentTarget.style.color = C.accent;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,150,190,0.22)";
              e.currentTarget.style.color = "#2d6a8a";
            }}
          >
            <span>▶</span>
            <span>{sourceName ?? "SELECT SOURCE"}</span>
          </button>

          {videoEnded && (
            <button
              onClick={onReplay}
              title="Replay from start"
              style={{
                background: "rgba(255,171,64,0.12)",
                border: "1px solid rgba(255,171,64,0.35)",
                borderRadius: 5,
                color: "#ffab40",
                cursor: "pointer",
                fontSize: 10,
                padding: "3px 9px",
                letterSpacing: "0.07em",
                display: "flex", alignItems: "center", gap: 4,
                fontFamily: "monospace",
                transition: "border-color 0.2s, color 0.2s, background 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,171,64,0.22)";
                e.currentTarget.style.borderColor = "rgba(255,171,64,0.7)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,171,64,0.12)";
                e.currentTarget.style.borderColor = "rgba(255,171,64,0.35)";
              }}
            >
              <span>↺</span>
              <span>REPLAY</span>
            </button>
          )}
        </div>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes scanH {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes numPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

import { useEffect, useState } from "react";

const URGENCY = {
  immediate:   { color: "#ff3b55", label: "IMMEDIATE RESPONSE REQUIRED" },
  monitor:     { color: "#ffab40", label: "MONITOR CLOSELY" },
  false_alarm: { color: "#00e676", label: "FALSE ALARM" },
};

const AUTO_DISMISS_S = 12;

export default function DistressOverlay({ analysis, onDismiss }) {
  const [timeLeft, setTimeLeft] = useState(AUTO_DISMISS_S);

  // Reset countdown whenever a new analysis arrives
  useEffect(() => {
    setTimeLeft(AUTO_DISMISS_S);
  }, [analysis]);

  // Countdown tick
  useEffect(() => {
    if (!analysis) return;
    if (timeLeft <= 0) { onDismiss(); return; }
    const id = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [timeLeft, analysis, onDismiss]);

  if (!analysis) return null;

  const { swimmer_id, gemini = {} } = analysis;
  const { urgency = "immediate", observation, action } = gemini;
  const u = URGENCY[urgency] ?? URGENCY.immediate;

  return (
    <div
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(6,0,0,0.94)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        animation: "dOverlayIn 0.3s ease",
      }}
    >
      {/* Pulsing red vignette */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        animation: "dVignette 1.1s ease-in-out infinite",
        background: "radial-gradient(ellipse at center, transparent 30%, rgba(255,30,50,0.35) 100%)",
      }} />

      {/* Scanlines */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,0,0,0.025) 3px, rgba(255,0,0,0.025) 6px)",
      }} />

      {/* Content card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          maxWidth: 560,
          width: "90%",
          textAlign: "center",
          padding: "40px 36px 32px",
          background: "rgba(20,0,0,0.7)",
          border: "1px solid rgba(255,59,85,0.35)",
          borderRadius: 12,
          boxShadow: "0 0 60px rgba(255,59,85,0.25)",
        }}
      >
        {/* Warning symbol */}
        <div style={{
          fontSize: 52, lineHeight: 1, marginBottom: 18,
          animation: "dIconPulse 0.9s ease-in-out infinite",
          filter: "drop-shadow(0 0 20px rgba(255,59,85,0.9))",
        }}>
          ⚠
        </div>

        {/* Heading */}
        <div style={{
          fontSize: 30, fontWeight: 900, letterSpacing: "0.16em",
          color: "#ff3b55",
          textShadow: "0 0 24px rgba(255,59,85,0.7)",
          fontFamily: "'JetBrains Mono', 'Consolas', monospace",
          marginBottom: 6,
        }}>
          DISTRESS DETECTED
        </div>

        {/* Swimmer ID */}
        <div style={{
          fontSize: 18, fontWeight: 700, fontFamily: "monospace",
          color: "#ff8a9a", marginBottom: 22, letterSpacing: "0.12em",
        }}>
          SWIMMER {String(swimmer_id).padStart(2, "0")}
        </div>

        {/* Urgency badge */}
        <div style={{
          display: "inline-block",
          padding: "5px 18px", borderRadius: 5, marginBottom: 26,
          background: `${u.color}1a`,
          border: `1.5px solid ${u.color}`,
          color: u.color,
          fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
          fontFamily: "monospace",
        }}>
          {u.label}
        </div>

        {/* Gemini observation */}
        {observation && (
          <div style={{
            marginBottom: 14, padding: "14px 18px",
            background: "rgba(255,59,85,0.07)",
            border: "1px solid rgba(255,59,85,0.18)",
            borderRadius: 8,
          }}>
            <div style={{
              fontSize: 9, color: "#663344", letterSpacing: "0.14em",
              marginBottom: 8, fontFamily: "monospace",
            }}>
              GEMINI VISION ANALYSIS
            </div>
            <div style={{ fontSize: 13, color: "#c88090", lineHeight: 1.55 }}>
              {observation}
            </div>
          </div>
        )}

        {/* Recommended action */}
        {action && (
          <div style={{
            marginBottom: 24, padding: "12px 18px",
            background: "rgba(255,171,0,0.06)",
            border: "1px solid rgba(255,171,0,0.2)",
            borderRadius: 8,
          }}>
            <div style={{
              fontSize: 9, color: "#664422", letterSpacing: "0.14em",
              marginBottom: 8, fontFamily: "monospace",
            }}>
              RECOMMENDED ACTION
            </div>
            <div style={{
              fontSize: 13, color: "#ffd080",
              lineHeight: 1.5, fontWeight: 600,
            }}>
              {action}
            </div>
          </div>
        )}

        {/* Dismiss hint */}
        <div style={{
          fontSize: 10, color: "#441520", fontFamily: "monospace",
          letterSpacing: "0.08em",
        }}>
          CLICK TO DISMISS · AUTO-CLOSE IN {timeLeft}s
        </div>
      </div>

      <style>{`
        @keyframes dOverlayIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes dVignette {
          0%,100% { opacity: 0.7; }
          50%     { opacity: 1;   }
        }
        @keyframes dIconPulse {
          0%,100% { transform: scale(1);    opacity: 1;   }
          50%     { transform: scale(1.08); opacity: 0.75; }
        }
      `}</style>
    </div>
  );
}

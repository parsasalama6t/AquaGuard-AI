import { useEffect, useState } from "react";

const URGENCY = {
  immediate:   { color: "#ff3b55", label: "IMMEDIATE RESPONSE REQUIRED" },
  monitor:     { color: "#ffab40", label: "MONITOR CLOSELY" },
  false_alarm: { color: "#00e676", label: "FALSE ALARM" },
};

const AUTO_DISMISS_S = 12;

// ── Circular countdown ring ───────────────────────────────────────────────────

function CountdownRing({ timeLeft, total = AUTO_DISMISS_S }) {
  const r = 22;
  const circumference = 2 * Math.PI * r;
  const progress   = timeLeft / total;
  const dashOffset = circumference * (1 - progress);

  return (
    <div style={{ position: "relative", width: 54, height: 54, flexShrink: 0 }}>
      <svg width={54} height={54} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={27} cy={27} r={r}
          fill="none" stroke="rgba(255,59,85,0.15)" strokeWidth={3} />
        <circle cx={27} cy={27} r={r}
          fill="none" stroke="#ff3b55" strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: "stroke-dashoffset 0.95s linear",
            filter: "drop-shadow(0 0 5px #ff3b55)",
          }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 800, color: "#ff3b55",
        fontFamily: "'JetBrains Mono', 'Consolas', monospace",
      }}>
        {timeLeft}
      </div>
    </div>
  );
}

// ── Sound wave bars ───────────────────────────────────────────────────────────

function SoundWave() {
  const heights = [6, 12, 18, 12, 6];
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 20 }}>
      {heights.map((maxH, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2,
          background: "#ff6a7d",
          animation: `do_soundBar${i} ${0.35 + i * 0.08}s ease-in-out infinite alternate`,
          height: `${maxH}px`,
        }} />
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DistressOverlay({ analysis, onDismiss, resolveAlert }) {
  const [timeLeft, setTimeLeft] = useState(AUTO_DISMISS_S);

  useEffect(() => {
    setTimeLeft(AUTO_DISMISS_S);
  }, [analysis]);

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

  function handleConfirm(e) {
    e.stopPropagation();
    if (resolveAlert) resolveAlert(swimmer_id);
    onDismiss();
  }

  return (
    <div
      onClick={onDismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(6,0,0,0.94)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        cursor: "pointer",
      }}
    >
      {/* Pulsing red vignette */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        animation: "do_vignette 1.1s ease-in-out infinite",
        background: "radial-gradient(ellipse at center, transparent 30%, rgba(255,30,50,0.35) 100%)",
      }} />

      {/* Scanlines */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,0,0,0.025) 3px, rgba(255,0,0,0.025) 6px)",
      }} />

      {/* Content card — shake animation on mount */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative", maxWidth: 560, width: "90%",
          textAlign: "center", padding: "40px 36px 32px",
          background: "rgba(20,0,0,0.7)",
          border: "1px solid rgba(255,59,85,0.35)",
          borderRadius: 12,
          boxShadow: "0 0 60px rgba(255,59,85,0.25)",
          animation: "do_cardIn 0.5s ease",
        }}
      >
        {/* Warning symbol */}
        <div style={{
          fontSize: 52, lineHeight: 1, marginBottom: 18,
          animation: "do_iconPulse 0.9s ease-in-out infinite",
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
          fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", fontFamily: "monospace",
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
            <div style={{ fontSize: 13, color: "#ffd080", lineHeight: 1.5, fontWeight: 600 }}>
              {action}
            </div>
          </div>
        )}

        {/* Countdown ring + sound wave */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          gap: 16, marginBottom: 20,
        }}>
          <CountdownRing timeLeft={timeLeft} total={AUTO_DISMISS_S} />
          <div style={{ textAlign: "left" }}>
            <SoundWave />
            <div style={{ fontSize: 9, color: "#441520", fontFamily: "monospace", marginTop: 6 }}>
              AUTO-CLOSE IN {timeLeft}s
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={handleConfirm}
            style={{
              padding: "10px 28px", borderRadius: 6,
              background: "rgba(0,230,118,0.12)",
              border: "1.5px solid #00e676",
              color: "#00e676",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
              cursor: "pointer", fontFamily: "monospace",
              transition: "background 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(0,230,118,0.22)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0,230,118,0.12)"; }}
          >
            ✓ CONFIRM RESPONSE
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            style={{
              padding: "10px 20px", borderRadius: 6,
              background: "transparent",
              border: "1px solid rgba(255,59,85,0.3)",
              color: "#663344",
              fontSize: 11, fontWeight: 600, letterSpacing: "0.1em",
              cursor: "pointer", fontFamily: "monospace",
              transition: "border-color 0.2s, color 0.2s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(255,59,85,0.6)"; e.currentTarget.style.color = "#ff3b55"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,59,85,0.3)"; e.currentTarget.style.color = "#663344"; }}
          >
            DISMISS
          </button>
        </div>
      </div>

      <style>{`
        @keyframes do_cardIn {
          0%   { opacity: 0; transform: scale(1.04); }
          15%  { opacity: 1; transform: scale(1) translateX(-5px); }
          30%  { transform: translateX(5px); }
          45%  { transform: translateX(-3px); }
          60%  { transform: translateX(2px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes do_vignette {
          0%,100% { opacity: 0.7; }
          50%     { opacity: 1; }
        }
        @keyframes do_iconPulse {
          0%,100% { transform: scale(1);    opacity: 1; }
          50%     { transform: scale(1.08); opacity: 0.75; }
        }
        @keyframes do_soundBar0 { from { height: 4px; } to { height: 8px;  } }
        @keyframes do_soundBar1 { from { height: 5px; } to { height: 14px; } }
        @keyframes do_soundBar2 { from { height: 6px; } to { height: 18px; } }
        @keyframes do_soundBar3 { from { height: 5px; } to { height: 14px; } }
        @keyframes do_soundBar4 { from { height: 4px; } to { height: 8px;  } }
      `}</style>
    </div>
  );
}

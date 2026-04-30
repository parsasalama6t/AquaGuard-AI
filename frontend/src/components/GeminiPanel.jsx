import { useEffect, useRef, useState } from "react";

const RISK = {
  low:    { color: "#00e676", label: "LOW",    bg: "rgba(0,230,118,0.07)",  border: "rgba(0,230,118,0.22)"  },
  medium: { color: "#ffab40", label: "MEDIUM", bg: "rgba(255,171,64,0.07)", border: "rgba(255,171,64,0.22)" },
  high:   { color: "#ff3b55", label: "HIGH",   bg: "rgba(255,59,85,0.07)",  border: "rgba(255,59,85,0.25)"  },
};

const RISK_VAL = { low: 1, medium: 2, high: 3 };

// ── Gemini star icon ──────────────────────────────────────────────────────────

function GeminiIcon({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 2L9 9H2L7.5 13.5L5.5 21L12 16.5L18.5 21L16.5 13.5L22 9H15L12 2Z"
        fill="#a78bfa" opacity="0.9" />
    </svg>
  );
}

// ── Session risk timeline ─────────────────────────────────────────────────────

function RiskTimeline({ history }) {
  if (history.length < 2) {
    return (
      <div style={{
        height: 36, display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: 9, color: "#0e2030", fontFamily: "monospace" }}>
          Collecting data…
        </span>
      </div>
    );
  }

  const W = 296;
  const H = 36;
  const pad = 4;

  const vals = history.map((h) => RISK_VAL[h.overall_risk] ?? 1);
  const points = vals.map((v, i) => [
    pad + (i / (vals.length - 1)) * (W - pad * 2),
    H - pad - ((v - 1) / 2) * (H - pad * 2),
  ]);
  const pathD = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

  const lastVal = vals[vals.length - 1];
  const lineColor = lastVal === 3 ? "#ff3b55" : lastVal === 2 ? "#ffab40" : "#00e676";

  const refLines = [
    { level: 1, color: "rgba(0,230,118,0.1)",   label: "LOW" },
    { level: 2, color: "rgba(255,171,64,0.1)",  label: "MED" },
    { level: 3, color: "rgba(255,59,85,0.12)",  label: "HI"  },
  ];

  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      {refLines.map(({ level, color, label }) => {
        const ry = H - pad - ((level - 1) / 2) * (H - pad * 2);
        return (
          <g key={level}>
            <line x1={pad} y1={ry} x2={W - pad} y2={ry}
              stroke={color} strokeWidth={1} strokeDasharray="3,3" />
            <text x={W - pad + 2} y={ry + 3} fontSize={7}
              fill={color.replace("0.1", "0.5").replace("0.12", "0.5")}
              fontFamily="monospace">
              {label}
            </text>
          </g>
        );
      })}
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r={3} fill={lineColor}
        style={{ filter: `drop-shadow(0 0 4px ${lineColor})` }}
      />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function GeminiPanel({ gemini = {}, geminiHistory = [] }) {
  const hasData = gemini && (gemini.overall_risk || gemini.recommended_action);
  const risk    = RISK[gemini?.overall_risk];

  // Call count and time-since tracking
  const callCountRef = useRef(0);
  const lastCallTime = useRef(null);
  const prevRiskRef  = useRef(null);
  const [sinceUpdate, setSinceUpdate] = useState(0);

  useEffect(() => {
    if (gemini?.overall_risk && gemini.overall_risk !== prevRiskRef.current) {
      callCountRef.current += 1;
      lastCallTime.current  = Date.now();
      prevRiskRef.current   = gemini.overall_risk;
    }
  }, [gemini]);

  useEffect(() => {
    const id = setInterval(() => {
      if (lastCallTime.current) {
        setSinceUpdate(Math.floor((Date.now() - lastCallTime.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      flexShrink: 0,
      borderBottom: "1px solid rgba(0,170,210,0.12)",
      background: "#030e1c",
      padding: "10px 14px 12px",
      overflowY: "auto",
    }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: hasData ? "#a78bfa" : "#1a2e44",
            boxShadow: hasData ? "0 0 7px #a78bfa" : "none",
            transition: "background 0.4s, box-shadow 0.4s",
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.14em",
            color: "#1e4a66", textTransform: "uppercase",
          }}>
            AI Analysis
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <GeminiIcon />
          <span style={{ fontSize: 9, color: "#0e2840", fontFamily: "monospace", letterSpacing: "0.06em" }}>
            GEMINI 1.5 FLASH
          </span>
        </div>
      </div>

      {!hasData ? (
        <div style={{
          fontSize: 11, color: "#0e2030", fontFamily: "monospace",
          textAlign: "center", padding: "6px 0 2px", letterSpacing: "0.08em",
        }}>
          Awaiting analysis…
        </div>
      ) : (
        <>
          {/* Risk badge + metadata */}
          {risk && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{
                padding: "5px 14px", borderRadius: 5,
                background: risk.bg,
                border: `1px solid ${risk.border}`,
                color: risk.color,
                fontSize: 11, fontWeight: 800, letterSpacing: "0.12em", fontFamily: "monospace",
                boxShadow: gemini.overall_risk === "high" ? `0 0 0 0 ${risk.color}` : `0 0 8px ${risk.border}`,
                animation: gemini.overall_risk === "high" ? "gp_riskRing 1.2s ease-in-out infinite" : "none",
              }}>
                {risk.label} RISK
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 8, color: "#0e2840", fontFamily: "monospace" }}>
                  ANALYSIS #{callCountRef.current}
                </div>
                {lastCallTime.current && (
                  <div style={{ fontSize: 8, color: "#1a3a50", fontFamily: "monospace", marginTop: 2 }}>
                    {sinceUpdate}s AGO
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Recommended action */}
          {gemini.recommended_action && (
            <div style={{
              fontSize: 11, color: "#3a6880", lineHeight: 1.5,
              fontStyle: "italic",
              borderLeft: "2px solid rgba(100,160,200,0.2)",
              paddingLeft: 9, marginBottom: 10,
            }}>
              {gemini.recommended_action}
            </div>
          )}

          {/* Per-swimmer observations */}
          {Array.isArray(gemini.swimmers) && gemini.swimmers.length > 0 && (
            <div style={{ marginBottom: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              {gemini.swimmers.slice(0, 3).map((s, i) => {
                const sRisk = RISK[s.risk_level];
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 7,
                    padding: "4px 8px",
                    background: "rgba(0,100,150,0.04)",
                    borderRadius: 5,
                    border: "1px solid rgba(0,100,150,0.1)",
                  }}>
                    {sRisk && (
                      <div style={{
                        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                        background: sRisk.color, marginTop: 4,
                      }} />
                    )}
                    <div style={{ fontSize: 10, color: "#2a5570", lineHeight: 1.4, overflow: "hidden" }}>
                      {s.behavior || s.position || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Session risk timeline */}
          <div style={{ marginBottom: 10 }}>
            <div style={{
              fontSize: 8, color: "#0e2840", letterSpacing: "0.12em",
              fontFamily: "monospace", textTransform: "uppercase", marginBottom: 4,
            }}>
              Session Risk Timeline
            </div>
            <RiskTimeline history={geminiHistory} />
          </div>

          {/* Analysis history */}
          {geminiHistory.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{
                fontSize: 8, color: "#0e2840", letterSpacing: "0.12em",
                fontFamily: "monospace", textTransform: "uppercase", marginBottom: 5,
              }}>
                Recent Analyses
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {[...geminiHistory].reverse().slice(0, 3).map((h, i) => {
                  const hr  = RISK[h.overall_risk];
                  const age = Math.floor((Date.now() - h._ts) / 1000);
                  return (
                    <div key={i} style={{
                      display: "flex", gap: 7, alignItems: "flex-start",
                      padding: "4px 8px",
                      background: i === 0 ? "rgba(167,139,250,0.04)" : "transparent",
                      borderRadius: 4,
                      borderLeft: `2px solid ${hr?.color ?? "#1a3a50"}`,
                      opacity: i === 0 ? 1 : i === 1 ? 0.6 : 0.35,
                    }}>
                      <div style={{
                        fontSize: 8, color: hr?.color ?? "#1a3a50",
                        fontFamily: "monospace", flexShrink: 0, marginTop: 1,
                      }}>
                        {hr?.label ?? "?"}
                      </div>
                      <div style={{ fontSize: 9, color: "#2a5570", flex: 1, lineHeight: 1.35 }}>
                        {(h.recommended_action ?? "").slice(0, 55)}{h.recommended_action?.length > 55 ? "…" : ""}
                      </div>
                      <div style={{ fontSize: 8, color: "#0e2030", fontFamily: "monospace", flexShrink: 0 }}>
                        -{age}s
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* Powered by branding */}
      <div style={{
        paddingTop: 9, marginTop: 2,
        borderTop: "1px solid rgba(167,139,250,0.1)",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      }}>
        <GeminiIcon size={9} />
        <span style={{
          fontSize: 8, color: "#3a2070",
          letterSpacing: "0.16em", fontFamily: "monospace",
        }}>
          POWERED BY GEMINI 1.5 FLASH
        </span>
      </div>

      <style>{`
        @keyframes gp_riskRing {
          0%,100% { box-shadow: 0 0 0 0 rgba(255,59,85,0.4), 0 0 16px rgba(255,59,85,0.25); }
          50%     { box-shadow: 0 0 0 5px rgba(255,59,85,0), 0 0 24px rgba(255,59,85,0.4); }
        }
      `}</style>
    </div>
  );
}

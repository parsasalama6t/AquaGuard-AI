const RISK = {
  low:     { color: "#00e676", label: "LOW",    bg: "rgba(0,230,118,0.07)",  border: "rgba(0,230,118,0.22)"  },
  medium:  { color: "#ffab40", label: "MEDIUM", bg: "rgba(255,171,64,0.07)", border: "rgba(255,171,64,0.22)" },
  high:    { color: "#ff3b55", label: "HIGH",   bg: "rgba(255,59,85,0.07)",  border: "rgba(255,59,85,0.25)"  },
};

function GeminiIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L9 9H2L7.5 13.5L5.5 21L12 16.5L18.5 21L16.5 13.5L22 9H15L12 2Z"
        fill="#a78bfa" opacity="0.9" />
    </svg>
  );
}

export default function GeminiPanel({ gemini = {} }) {
  const hasData = gemini && (gemini.overall_risk || gemini.recommended_action);
  const risk = RISK[gemini?.overall_risk];

  return (
    <div style={{
      flexShrink: 0,
      borderBottom: "1px solid rgba(0,170,210,0.12)",
      background: "#030e1c",
      padding: "10px 14px 13px",
    }}>

      {/* Header row */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 10,
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
          <span style={{
            fontSize: 9, color: "#0e2840", fontFamily: "monospace",
            letterSpacing: "0.06em",
          }}>
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
          {/* Risk level row */}
          {risk && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
              <div style={{
                padding: "3px 11px", borderRadius: 4,
                background: risk.bg,
                border: `1px solid ${risk.border}`,
                color: risk.color,
                fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
                fontFamily: "monospace",
                boxShadow: gemini.overall_risk === "high" ? `0 0 10px ${risk.border}` : "none",
                animation: gemini.overall_risk === "high" ? "gRiskPulse 1.4s ease-in-out infinite" : "none",
              }}>
                {risk.label}
              </div>
              <span style={{ fontSize: 9, color: "#1a3a50", letterSpacing: "0.08em" }}>
                OVERALL RISK
              </span>
            </div>
          )}

          {/* Recommended action */}
          {gemini.recommended_action && (
            <div style={{
              fontSize: 11, color: "#3a6880", lineHeight: 1.5,
              fontStyle: "italic",
              borderLeft: "2px solid rgba(100,160,200,0.2)",
              paddingLeft: 9,
            }}>
              {gemini.recommended_action}
            </div>
          )}

          {/* Per-swimmer observations (if available) */}
          {Array.isArray(gemini.swimmers) && gemini.swimmers.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
              {gemini.swimmers.slice(0, 3).map((s, i) => {
                const sRisk = RISK[s.risk_level];
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 7,
                    padding: "5px 8px",
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
                    <div style={{
                      fontSize: 10, color: "#2a5570", lineHeight: 1.4,
                      overflow: "hidden",
                    }}>
                      {s.behavior || s.position || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes gRiskPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.55; }
        }
      `}</style>
    </div>
  );
}

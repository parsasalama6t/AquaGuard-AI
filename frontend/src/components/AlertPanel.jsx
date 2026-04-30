import { useState, useEffect, useRef, useMemo } from "react";

// ── Helpers ───────────────────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function timeAgo(ts) {
  const delta = Math.floor(Date.now() / 1000 - ts);
  if (delta < 10)   return "just now";
  if (delta < 60)   return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  return `${Math.floor(delta / 3600)}h ago`;
}

function todayStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000;
}

// ── Status config ─────────────────────────────────────────────────────────────

const ST = {
  distress: { color: "#ff3b55", label: "DISTRESS", glow: "rgba(255,59,85,0.3)"  },
  warning:  { color: "#ffab40", label: "WARNING",  glow: "rgba(255,171,64,0.2)" },
  normal:   { color: "#00e676", label: "NORMAL",   glow: "rgba(0,230,118,0.15)" },
};

// ── Active alert row ──────────────────────────────────────────────────────────

function ActiveAlertRow({ alert, resolveAlert, tick }) {
  const [hovered, setHovered] = useState(false);
  const st = ST[alert.status] ?? ST.normal;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid rgba(0,170,210,0.07)",
        background: hovered ? "rgba(255,255,255,0.025)" : "transparent",
        transition: "background 0.15s",
        animation: "slideIn 0.25s ease",
      }}
    >
      {/* Left severity strip */}
      <div style={{
        width: 3, flexShrink: 0,
        background: st.color,
        boxShadow: `0 0 8px ${st.color}`,
        animation: alert.status === "distress" ? "stripPulse 1.4s ease-in-out infinite" : "none",
      }} />

      <div style={{ flex: 1, padding: "11px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
              color: st.color,
            }}>
              {st.label}
            </span>
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: "#8ab8d0",
              fontFamily: "monospace",
            }}>
              S-{String(alert.swimmer_id).padStart(2, "0")}
            </span>
          </div>
          {alert.reason && (
            <div style={{
              fontSize: 11, color: "#2a5570",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              marginBottom: 3,
            }}>
              {alert.reason}
            </div>
          )}
          <div style={{ fontSize: 10, color: "#1a3a50", fontFamily: "monospace" }}>
            {timeAgo(alert.timestamp)}
          </div>
        </div>

        {/* Resolve button */}
        <button
          title="Resolve"
          onClick={() => resolveAlert(alert.swimmer_id)}
          style={{
            width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
            border: "1px solid rgba(0,230,118,0.3)",
            background: "transparent",
            color: "#00c060",
            fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "border-color 0.2s, background 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(0,230,118,0.12)";
            e.currentTarget.style.borderColor = "#00e676";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.borderColor = "rgba(0,230,118,0.3)";
          }}
        >
          ✓
        </button>
      </div>
    </div>
  );
}

// ── History item ──────────────────────────────────────────────────────────────

function HistoryRow({ alert }) {
  const st = ST[alert.status] ?? ST.normal;
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "9px 16px 9px 13px",
      borderBottom: "1px solid rgba(0,170,210,0.05)",
    }}>
      <div style={{
        width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
        background: st.color, opacity: 0.7,
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 12, color: "#4a7a96",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          fontFamily: "monospace",
        }}>
          S-{String(alert.swimmer_id).padStart(2, "0")}
          <span style={{ color: st.color, marginLeft: 6 }}>{st.label}</span>
        </div>
        {alert.reason && (
          <div style={{
            fontSize: 10, color: "#1a3a50",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            marginTop: 2,
          }}>
            {alert.reason}
          </div>
        )}
      </div>
      <span style={{ fontSize: 10, color: "#1a3a50", fontFamily: "monospace", flexShrink: 0 }}>
        {formatTime(alert.timestamp)}
      </span>
    </div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHead({ title, badge, badgeColor }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 16px 8px",
      borderBottom: "1px solid rgba(0,170,210,0.08)",
      flexShrink: 0,
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.14em",
        color: "#1e4a66", textTransform: "uppercase",
      }}>
        {title}
      </span>
      {badge != null && (
        <span style={{
          fontSize: 11, fontWeight: 700, minWidth: 20, textAlign: "center",
          padding: "1px 7px", borderRadius: 10,
          background: badge > 0 ? "rgba(255,59,85,0.15)" : "rgba(0,170,210,0.08)",
          color: badge > 0 ? badgeColor ?? "#ff3b55" : "#1e4060",
          border: `1px solid ${badge > 0 ? "rgba(255,59,85,0.3)" : "rgba(0,170,210,0.1)"}`,
        }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AlertPanel({ alerts = [], activeAlerts = [], resolveAlert }) {
  const [tick, setTick] = useState(0);
  const scrollRef = useRef(null);
  const prevCount = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (activeAlerts.length > prevCount.current && scrollRef.current)
      scrollRef.current.scrollTop = 0;
    prevCount.current = activeAlerts.length;
  }, [activeAlerts.length]);

  const { todayTotal, todayDistress, todayWarn } = useMemo(() => {
    const since = todayStart();
    const today = alerts.filter((a) => a.timestamp >= since);
    return {
      todayTotal:    today.length,
      todayDistress: today.filter((a) => a.status === "distress").length,
      todayWarn:     today.filter((a) => a.status === "warning").length,
    };
  }, [alerts]);

  return (
    <div style={{
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      background: "#040f1e",
      borderLeft: "1px solid rgba(0,170,210,0.12)",
      overflow: "hidden",
    }}>

      {/* ── Active alerts section ─────────────────────────────────────────── */}
      <SectionHead title="Active Alerts" badge={activeAlerts.length} />

      <div
        ref={scrollRef}
        style={{ maxHeight: "44%", overflowY: "auto", flexShrink: 0, scrollbarWidth: "none" }}
      >
        {activeAlerts.length === 0 ? (
          <div style={{
            margin: "12px 14px",
            padding: "12px 14px",
            borderRadius: 8,
            background: "rgba(0,230,118,0.05)",
            border: "1px solid rgba(0,230,118,0.12)",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 14, color: "#00a050" }}>✓</span>
            <span style={{ fontSize: 12, color: "#1a4a30", letterSpacing: "0.06em" }}>
              All clear
            </span>
          </div>
        ) : (
          activeAlerts.map((a) => (
            <ActiveAlertRow
              key={`${a.swimmer_id}-${a.timestamp}`}
              alert={a}
              resolveAlert={resolveAlert}
              tick={tick}
            />
          ))
        )}
      </div>

      {/* ── History section ───────────────────────────────────────────────── */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderTop: "1px solid rgba(0,170,210,0.1)",
      }}>
        <SectionHead title="Event Log" />
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(0,170,210,0.15) transparent" }}>
          {alerts.length === 0 ? (
            <div style={{ padding: 16, fontSize: 11, color: "#0e2a3d", textAlign: "center", letterSpacing: "0.08em" }}>
              No events recorded yet
            </div>
          ) : (
            alerts.map((a, i) => (
              <HistoryRow key={`${a.swimmer_id}-${a.timestamp}-${i}`} alert={a} />
            ))
          )}
        </div>
      </div>

      {/* ── Footer stats ──────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        padding: "8px 14px",
        borderTop: "1px solid rgba(0,170,210,0.1)",
        display: "flex",
        justifyContent: "space-between",
        background: "#030c18",
      }}>
        <span style={{ fontSize: 10, color: "#1a3a50", letterSpacing: "0.08em", fontFamily: "monospace" }}>
          TODAY  {String(todayTotal).padStart(3, "0")}
        </span>
        <span style={{ fontSize: 10, fontFamily: "monospace", letterSpacing: "0.06em" }}>
          <span style={{ color: todayDistress > 0 ? "#ff3b55" : "#1a3a50" }}>{todayDistress} DIST</span>
          <span style={{ color: "#0e2a3d", margin: "0 6px" }}>·</span>
          <span style={{ color: todayWarn > 0 ? "#ffab40" : "#1a3a50" }}>{todayWarn} WARN</span>
        </span>
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes stripPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

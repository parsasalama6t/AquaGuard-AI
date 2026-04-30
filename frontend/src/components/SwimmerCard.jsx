import { useEffect, useMemo, useRef } from "react";
import Sparkline from "./Sparkline";

// ── Design tokens ─────────────────────────────────────────────────────────────
const STATUS = {
  normal:   { bar: "#00e676", glow: "rgba(0,230,118,0.25)",   label: "NORMAL",   strip: "#00e676", text: "#00c060" },
  warning:  { bar: "#ffab40", glow: "rgba(255,171,64,0.25)",  label: "WARNING",  strip: "#ffab40", text: "#e89030" },
  distress: { bar: "#ff3b55", glow: "rgba(255,59,85,0.3)",    label: "DISTRESS", strip: "#ff3b55", text: "#ff3b55" },
};

function barColor(score) {
  if (score < 40) return "#00e676";
  if (score < 70) return "#ffab40";
  return "#ff3b55";
}

// ── Swimmer SVG silhouette ────────────────────────────────────────────────────

function SwimmerIcon({ color }) {
  return (
    <svg width="26" height="22" viewBox="0 0 26 22" fill="none">
      <circle cx="21" cy="3" r="2.5" fill={color} opacity="0.9" />
      <path d="M19 5.5 C16 8, 13 9, 10 9 C7 9, 4 8, 2 10" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M17 7 L15 13" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <path d="M2 14 C5 12, 9 12, 13 14 C17 16, 21 16, 24 14" stroke={color} strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SwimmerCard({ swimmer }) {
  if (!swimmer) return null;

  const { swimmer_id, status = "normal", score = 0, lane } = swimmer;
  const s      = useMemo(() => STATUS[status] ?? STATUS.normal, [status]);
  const fill   = useMemo(() => barColor(score), [score]);
  const isDistress = status === "distress";
  const isWarn     = status === "warning";

  // Score history for sparkline — ref to avoid re-render storms
  const historyRef = useRef([]);
  const prevIdRef  = useRef(null);
  useEffect(() => {
    if (prevIdRef.current !== swimmer_id) {
      historyRef.current = [];
      prevIdRef.current  = swimmer_id;
    }
    historyRef.current.push(score);
    if (historyRef.current.length > 30) historyRef.current.shift();
  }, [score, swimmer_id]);

  return (
    <div
      style={{
        width: 160,
        flexShrink: 0,
        background: "#060f1e",
        border: `1px solid ${isDistress ? "rgba(255,59,85,0.4)" : isWarn ? "rgba(255,171,64,0.3)" : "rgba(0,170,210,0.12)"}`,
        borderLeft: `3px solid ${s.strip}`,
        borderRadius: 10,
        padding: "14px 14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        cursor: "default",
        position: "relative",
        boxShadow: isDistress ? "0 0 20px rgba(255,59,85,0.15)" : "none",
        animation: isDistress ? "cardFlash 2s ease-in-out infinite" : "none",
        transition: "border-color 0.3s, box-shadow 0.3s",
      }}
    >
      {/* ── Header row: icon + ID + status ──────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <SwimmerIcon color={s.text} />
          <span style={{
            fontSize: 17,
            fontWeight: 800,
            color: "#c8e4f8",
            fontFamily: "monospace",
            letterSpacing: "0.04em",
          }}>
            S-{String(swimmer_id).padStart(2, "0")}
          </span>
        </div>

        {/* Pulsing dot */}
        <div style={{
          width: 7, height: 7, borderRadius: "50%",
          background: s.strip,
          boxShadow: `0 0 6px ${s.strip}`,
          animation: "dotBlink 2s ease-in-out infinite",
          flexShrink: 0,
        }} />
      </div>

      {/* ── Status label ────────────────────────────────────────────────── */}
      <div style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.14em",
        color: s.text,
        textShadow: `0 0 8px ${s.glow}`,
        animation: isDistress ? "textFlash 1.4s ease-in-out infinite" : "none",
      }}>
        {s.label}
      </div>

      {/* ── Distress score ───────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 9, color: "#1e4060", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Risk Score
          </span>
          <span style={{
            fontSize: 16,
            fontWeight: 700,
            color: fill,
            fontFamily: "monospace",
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}>
            {score.toFixed(0)}
            <span style={{ fontSize: 9, color: "#1e4060", fontWeight: 400 }}>/100</span>
          </span>
        </div>

        {/* Track */}
        <div style={{
          width: "100%", height: 5, borderRadius: 3,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}>
          <div style={{
            width: `${Math.min(100, Math.max(0, score))}%`,
            height: "100%",
            borderRadius: 3,
            background: fill,
            boxShadow: `0 0 6px ${fill}`,
            transition: "width 0.35s ease",
          }} />
        </div>
      </div>

      {/* ── Sparkline trend ──────────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 8, color: "#1a3050", letterSpacing: "0.12em", fontFamily: "monospace", marginBottom: 3 }}>
          SCORE TREND
        </div>
        <Sparkline data={historyRef.current} width={132} height={22} color={fill} strokeWidth={1.5} />
      </div>

      {/* ── Lane info ────────────────────────────────────────────────────── */}
      <div style={{
        fontSize: 10,
        color: "#1e4060",
        letterSpacing: "0.1em",
        fontFamily: "monospace",
        borderTop: "1px solid rgba(0,170,210,0.08)",
        paddingTop: 5,
      }}>
        {lane != null ? `LANE  ${lane}` : "LANE  —"}
      </div>

      {/* Keyframes */}
      <style>{`
        @keyframes dotBlink {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.25; }
        }
        @keyframes cardFlash {
          0%,100% { box-shadow: 0 0 20px rgba(255,59,85,0.15); }
          50%     { box-shadow: 0 0 32px rgba(255,59,85,0.35); }
        }
        @keyframes textFlash {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

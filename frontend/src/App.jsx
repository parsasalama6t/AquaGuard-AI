import { useEffect, useRef, useState } from "react";
import useWebSocket from "./hooks/useWebSocket";
import VideoFeed from "./components/VideoFeed";
import AlertPanel from "./components/AlertPanel";
import StatBar from "./components/StatBar";
import SwimmerCard from "./components/SwimmerCard";
import VideoSelector from "./components/VideoSelector";
import GeminiPanel from "./components/GeminiPanel";
import DistressOverlay from "./components/DistressOverlay";
import SchoolDashboard from "./components/SchoolDashboard";

function beep(ctx) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.frequency.value = 880;
  osc.type = "sine";
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + 0.2);
}

// ── Session info bar ──────────────────────────────────────────────────────────

function SessionInfoBar({ sessionStats }) {
  const [duration, setDuration] = useState("00:00");

  useEffect(() => {
    if (!sessionStats.sessionStart) return;
    const id = setInterval(() => {
      const elapsed = Math.floor((Date.now() - sessionStats.sessionStart) / 1000);
      const m = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const s = String(elapsed % 60).padStart(2, "0");
      setDuration(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStats.sessionStart]);

  const peak = sessionStats.peakRisk;
  const peakColor = peak > 70 ? "#ff3b55" : peak > 40 ? "#ffab40" : "#00e676";

  const items = [
    { label: "SESSION",         value: duration,                             color: "#00aacc" },
    { label: "PEAK RISK",       value: `${peak.toFixed(0)}/100`,             color: peakColor },
    { label: "TOTAL ALERTS",    value: sessionStats.totalAlerts,             color: sessionStats.totalAlerts > 0 ? "#ffab40" : "#1e4060" },
    { label: "DISTRESS EVENTS", value: sessionStats.totalDistress,           color: sessionStats.totalDistress > 0 ? "#ff3b55" : "#1e4060" },
    { label: "WATERLINE DEPTH", value: sessionStats.waterline !== null ? `${(sessionStats.waterline * 100).toFixed(0)}%` : "—", color: "#00d4ff" },
  ];

  return (
    <div style={{
      height: 36,
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      background: "#020a14",
      borderBottom: "1px solid rgba(0,170,210,0.07)",
      padding: "0 20px",
      overflow: "hidden",
    }}>
      {items.map((item, i) => (
        <div key={i} style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 20px",
          borderLeft: i > 0 ? "1px solid rgba(0,170,210,0.08)" : "none",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 8, color: "#1a3050", letterSpacing: "0.14em", fontFamily: "monospace", textTransform: "uppercase" }}>
            {item.label}
          </span>
          <span style={{
            fontSize: 12, fontWeight: 700, color: item.color,
            fontFamily: "'JetBrains Mono', 'Consolas', monospace",
            fontVariantNumeric: "tabular-nums",
            transition: "color 0.4s",
          }}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main app ──────────────────────────────────────────────────────────────────

export default function App() {
  const {
    swimmers,
    alerts,
    activeAlerts,
    isConnected,
    fps,
    frameCount,
    stats,
    videoEnded,
    distressAnalysis,
    dismissDistressAnalysis,
    resolveAlert,
    geminiHistory,
  } = useWebSocket("ws://localhost:8000/ws");

  const [selectorOpen, setSelectorOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("detection");

  async function handleReplay() {
    try {
      await fetch("http://localhost:8000/videos/replay", { method: "POST" });
    } catch {
      // silently ignore
    }
  }

  // ── Audio ─────────────────────────────────────────────────────────────────
  const audioCtx = useRef(null);
  const prevDistressCount = useRef(0);

  // ── Session stats (ref-based to avoid extra renders) ─────────────────────
  const sessionStartRef  = useRef(null);
  const peakRiskRef      = useRef(0);
  const totalDistressRef = useRef(0);
  const prevDistressAnalysisRef = useRef(null);

  useEffect(() => {
    if (swimmers.length > 0 && !sessionStartRef.current) {
      sessionStartRef.current = Date.now();
    }
  }, [swimmers.length]);

  useEffect(() => {
    swimmers.forEach((s) => {
      if (s.score > peakRiskRef.current) peakRiskRef.current = s.score;
    });
  }, [swimmers]);

  useEffect(() => {
    if (distressAnalysis && distressAnalysis !== prevDistressAnalysisRef.current) {
      totalDistressRef.current += 1;
      prevDistressAnalysisRef.current = distressAnalysis;
    }
  }, [distressAnalysis]);

  const sessionStats = {
    sessionStart:  sessionStartRef.current,
    peakRisk:      peakRiskRef.current,
    totalAlerts:   alerts.length,
    totalDistress: totalDistressRef.current,
    waterline:     stats.waterline ?? null,
  };

  // ── Document title ────────────────────────────────────────────────────────
  useEffect(() => {
    const n = activeAlerts.length;
    document.title =
      n === 0 ? "AquaGuard — All Clear" : `🚨 AquaGuard — ${n} Active Alert(s)`;
  }, [activeAlerts.length]);

  // ── Distress beep ─────────────────────────────────────────────────────────
  useEffect(() => {
    const distressCount = activeAlerts.filter((a) => a.status === "distress").length;
    if (distressCount > prevDistressCount.current) {
      try {
        if (!audioCtx.current) audioCtx.current = new AudioContext();
        if (audioCtx.current.state === "suspended") {
          audioCtx.current.resume().then(() => beep(audioCtx.current));
        } else {
          beep(audioCtx.current);
        }
      } catch {
        // Audio not available
      }
    }
    prevDistressCount.current = distressCount;
  }, [activeAlerts]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      width: "100vw",
      height: "100vh",
      background: "#020c17",
      color: "#c8e4f8",
      fontFamily: "'Inter', system-ui, sans-serif",
      overflow: "hidden",
    }}>
      <StatBar
        swimmers={swimmers}
        activeAlerts={activeAlerts}
        isConnected={isConnected}
        fps={fps}
        sourceName={stats.source_name}
        onOpenSources={() => setSelectorOpen(true)}
        videoEnded={videoEnded}
        onReplay={handleReplay}
      />

      <SessionInfoBar sessionStats={sessionStats} />

      {/* Tab bar */}
      <div style={{
        display: "flex", alignItems: "center",
        background: "#020a14",
        borderBottom: "1px solid rgba(0,170,210,0.1)",
        padding: "0 20px",
        gap: 2, flexShrink: 0, height: 36,
      }}>
        {[
          { key: "detection", label: "LIVE DETECTION" },
          { key: "school",    label: "SCHOOL OVERVIEW" },
        ].map((tab) => {
          const active = activeTab === tab.key;
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              background: active ? "rgba(0,170,210,0.1)" : "transparent",
              border: "none",
              borderBottom: active ? "2px solid #00aacc" : "2px solid transparent",
              color: active ? "#00aacc" : "#1e4060",
              fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
              fontFamily: "monospace", padding: "0 16px", height: "100%",
              cursor: "pointer", transition: "color 0.2s, border-color 0.2s, background 0.2s",
            }}>
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "school" ? <SchoolDashboard /> : (
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Left: video + swimmer cards */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            <VideoFeed
              swimmers={swimmers}
              isConnected={isConnected}
              fps={fps}
              frameCount={frameCount}
              sourceName={stats.source_name}
              waterline={stats.waterline ?? null}
            />
          </div>

          {/* Swimmer cards row */}
          <div
            className="hide-scrollbar"
            style={{
              height: 172,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
              overflowX: "auto",
              padding: "14px 18px",
              background: "#030c18",
              borderTop: "1px solid rgba(0,170,210,0.12)",
              scrollbarWidth: "none",
            }}
          >
            {swimmers.length === 0 ? (
              <div style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                color: "#0e2a3d", fontSize: 12, letterSpacing: "0.14em",
                fontFamily: "monospace", textTransform: "uppercase",
              }}>
                No swimmers detected
              </div>
            ) : (
              swimmers.map((swimmer) => (
                <SwimmerCard key={swimmer.swimmer_id} swimmer={swimmer} />
              ))
            )}
          </div>
        </div>

        {/* Right: Gemini panel + alert panel */}
        <div style={{ width: 340, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <GeminiPanel gemini={stats.gemini} geminiHistory={geminiHistory} />
          <AlertPanel
            alerts={alerts}
            activeAlerts={activeAlerts}
            resolveAlert={resolveAlert}
          />
        </div>
      </div>
      )}

      {selectorOpen && <VideoSelector onClose={() => setSelectorOpen(false)} />}

      <DistressOverlay
        analysis={distressAnalysis}
        onDismiss={dismissDistressAnalysis}
        resolveAlert={resolveAlert}
      />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

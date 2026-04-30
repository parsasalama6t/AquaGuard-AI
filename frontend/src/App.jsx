import { useEffect, useRef, useState } from "react";
import useWebSocket from "./hooks/useWebSocket";
import VideoFeed from "./components/VideoFeed";
import AlertPanel from "./components/AlertPanel";
import StatBar from "./components/StatBar";
import SwimmerCard from "./components/SwimmerCard";
import VideoSelector from "./components/VideoSelector";
import GeminiPanel from "./components/GeminiPanel";
import DistressOverlay from "./components/DistressOverlay";

// Plays a short 200 ms oscillator beep using the Web Audio API.
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
  } = useWebSocket("ws://localhost:8000/ws");

  const [selectorOpen, setSelectorOpen] = useState(false);

  async function handleReplay() {
    try {
      await fetch("http://localhost:8000/videos/replay", { method: "POST" });
    } catch {
      // silently ignore — backend will handle it
    }
  }

  // Keep a stable AudioContext across renders
  const audioCtx = useRef(null);

  // Track the previous distress count so we only beep on increases
  const prevDistressCount = useRef(0);

  // ── Document title ────────────────────────────────────────────────────────
  useEffect(() => {
    const n = activeAlerts.length;
    document.title =
      n === 0 ? "AquaGuard — All Clear" : `🚨 AquaGuard — ${n} Active Alert(s)`;
  }, [activeAlerts.length]);

  // ── Distress beep ─────────────────────────────────────────────────────────
  useEffect(() => {
    const distressCount = activeAlerts.filter(
      (a) => a.status === "distress"
    ).length;

    if (distressCount > prevDistressCount.current) {
      // Lazily create AudioContext on first user-gesture-free beep.
      // Modern browsers may require a gesture; we attempt anyway and
      // catch any autoplay-policy rejection silently.
      try {
        if (!audioCtx.current) {
          audioCtx.current = new AudioContext();
        }
        if (audioCtx.current.state === "suspended") {
          audioCtx.current.resume().then(() => beep(audioCtx.current));
        } else {
          beep(audioCtx.current);
        }
      } catch {
        // Audio not available — fail silently
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

      {/* ── Stat bar ──────────────────────────────────────────────────────── */}
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

      {/* ── Main body ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* ── Left: video + swimmer cards ───────────────────────────────── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Video feed */}
          <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
            <VideoFeed
              swimmers={swimmers}
              isConnected={isConnected}
              fps={fps}
              frameCount={frameCount}
              sourceName={stats.source_name}
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
                color: "#0e2a3d",
                fontSize: 12,
                letterSpacing: "0.14em",
                fontFamily: "monospace",
                textTransform: "uppercase",
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

        {/* ── Right: Gemini panel + alert panel ─────────────────────────── */}
        <div style={{ width: 300, flexShrink: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <GeminiPanel gemini={stats.gemini} />
          <AlertPanel
            alerts={alerts}
            activeAlerts={activeAlerts}
            resolveAlert={resolveAlert}
          />
        </div>
      </div>

      {/* Video selector modal */}
      {selectorOpen && <VideoSelector onClose={() => setSelectorOpen(false)} />}

      {/* Distress overlay — fires when Gemini confirms a new DISTRESS event */}
      <DistressOverlay analysis={distressAnalysis} onDismiss={dismissDistressAnalysis} />

      <style>{`
        .hide-scrollbar::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}

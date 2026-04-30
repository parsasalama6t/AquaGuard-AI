import { useEffect, useRef, useState } from "react";

// ── Static mock camera data ───────────────────────────────────────────────────

const CAMERAS = [
  { id: "CAM-01", zone: "Lane 1 – 2",    status: "normal",  swimmers: 3, lastEvent: "All clear",              fps: 28.4, coverage: [0,    0,    0.33, 0.5 ] },
  { id: "CAM-02", zone: "Lane 3 – 4",    status: "normal",  swimmers: 2, lastEvent: "All clear",              fps: 27.1, coverage: [0.33, 0,    0.66, 0.5 ] },
  { id: "CAM-03", zone: "Lane 5 – 6",    status: "warning", swimmers: 1, lastEvent: "Abnormal arm movement",  fps: 29.0, coverage: [0.66, 0,    1,    0.5 ] },
  { id: "CAM-04", zone: "Deep End",      status: "distress",swimmers: 1, lastEvent: "DISTRESS — S-02",        fps: 26.8, coverage: [0,    0.5,  0.33, 1   ] },
  { id: "CAM-05", zone: "Shallow End",   status: "normal",  swimmers: 4, lastEvent: "All clear",              fps: 28.9, coverage: [0.33, 0.5,  0.66, 1   ] },
  { id: "CAM-06", zone: "Diving Area",   status: "normal",  swimmers: 0, lastEvent: "No swimmers detected",   fps: 27.5, coverage: [0.66, 0.5,  1,    1   ] },
];

const STATUS = {
  normal:  { color: "#00e676", bg: "rgba(0,230,118,0.08)",  border: "rgba(0,230,118,0.25)",  label: "NORMAL",  glow: "rgba(0,230,118,0.3)"  },
  warning: { color: "#ffab40", bg: "rgba(255,171,64,0.08)", border: "rgba(255,171,64,0.28)", label: "WARNING", glow: "rgba(255,171,64,0.3)" },
  distress:{ color: "#ff3b55", bg: "rgba(255,59,85,0.1)",   border: "rgba(255,59,85,0.4)",   label: "DISTRESS",glow: "rgba(255,59,85,0.5)"  },
};

// ── Pool map (top-down SVG) ───────────────────────────────────────────────────

function PoolMap() {
  const W = 300, H = 160;
  const lanes = 6;
  const laneW = W / lanes;

  return (
    <svg width={W} height={H} style={{ display: "block", borderRadius: 8, overflow: "hidden" }}>
      {/* Pool body */}
      <rect x={0} y={0} width={W} height={H} fill="rgba(0,60,100,0.35)" rx={4} />

      {/* Lane dividers */}
      {Array.from({ length: lanes - 1 }).map((_, i) => (
        <line key={i}
          x1={(i + 1) * laneW} y1={8} x2={(i + 1) * laneW} y2={H - 8}
          stroke="rgba(0,180,220,0.2)" strokeWidth={1} strokeDasharray="4,4" />
      ))}

      {/* Lane labels */}
      {Array.from({ length: lanes }).map((_, i) => (
        <text key={i}
          x={i * laneW + laneW / 2} y={H / 2 + 4}
          textAnchor="middle" fontSize={9}
          fill="rgba(0,200,255,0.35)" fontFamily="monospace">
          L{i + 1}
        </text>
      ))}

      {/* Deep / shallow end markers */}
      <text x={8} y={H - 6} fontSize={7} fill="rgba(0,180,220,0.4)" fontFamily="monospace">DEEP</text>
      <text x={W - 8} y={H - 6} fontSize={7} fill="rgba(0,180,220,0.4)" fontFamily="monospace" textAnchor="end">SHALLOW</text>

      {/* Camera coverage zones */}
      {CAMERAS.map((cam) => {
        const [x1r, y1r, x2r, y2r] = cam.coverage;
        const s = STATUS[cam.status];
        return (
          <rect key={cam.id}
            x={x1r * W + 1} y={y1r * H + 1}
            width={(x2r - x1r) * W - 2} height={(y2r - y1r) * H - 2}
            fill={`${s.color}10`}
            stroke={s.color}
            strokeWidth={cam.status === "distress" ? 1.5 : 0.8}
            strokeOpacity={cam.status === "distress" ? 0.9 : 0.4}
            rx={2}
          />
        );
      })}

      {/* Camera ID labels */}
      {CAMERAS.map((cam) => {
        const [x1r, y1r, x2r, y2r] = cam.coverage;
        const cx = (x1r + x2r) / 2 * W;
        const cy = (y1r + y2r) / 2 * H - 8;
        const s = STATUS[cam.status];
        return (
          <text key={cam.id}
            x={cx} y={cy}
            textAnchor="middle" fontSize={7}
            fill={s.color} fontFamily="monospace" opacity={0.85}>
            {cam.id}
          </text>
        );
      })}
    </svg>
  );
}

// ── Mock video feed tile ──────────────────────────────────────────────────────

function CameraTile({ cam, isLarge = false }) {
  const s = STATUS[cam.status];
  const isDistress = cam.status === "distress";
  const isWarning  = cam.status === "warning";
  const canvasRef  = useRef(null);
  const frameRef   = useRef(0);

  // Animate mock video content
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;

    function draw() {
      frameRef.current++;
      const t = frameRef.current;
      const W = canvas.width, H = canvas.height;

      // Pool-blue background
      ctx.fillStyle = "#061824";
      ctx.fillRect(0, 0, W, H);

      // Water shimmer
      for (let i = 0; i < 6; i++) {
        const y = ((t * 0.3 + i * 28) % (H + 20)) - 10;
        const alpha = 0.03 + Math.sin(t * 0.04 + i) * 0.02;
        ctx.strokeStyle = `rgba(0,180,220,${alpha})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y + 6);
        ctx.stroke();
      }

      // Lane line
      ctx.strokeStyle = "rgba(0,140,200,0.12)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);

      // Mock swimmer bounding box
      if (cam.swimmers > 0) {
        const bx = W * 0.28, by = H * 0.22, bw = W * 0.42, bh = H * 0.55;
        const pulse = 0.6 + Math.sin(t * 0.08) * 0.4;
        ctx.strokeStyle = isDistress
          ? `rgba(255,59,85,${pulse})`
          : isWarning
          ? `rgba(255,171,64,0.7)`
          : `rgba(0,230,118,0.6)`;
        ctx.lineWidth = isDistress ? 2 : 1.5;
        ctx.strokeRect(bx, by, bw, bh);

        // Swimmer silhouette (simple oval + head)
        ctx.fillStyle = isDistress ? "rgba(255,59,85,0.12)" : "rgba(0,150,200,0.1)";
        ctx.fillRect(bx, by, bw, bh);

        // Head dot
        ctx.beginPath();
        ctx.arc(bx + bw / 2, by + bh * 0.18, 7, 0, Math.PI * 2);
        ctx.fillStyle = isDistress ? "rgba(255,59,85,0.5)" : "rgba(0,200,150,0.4)";
        ctx.fill();

        // Skeleton lines (shoulders, arms)
        ctx.strokeStyle = isDistress ? "rgba(255,59,85,0.4)" : "rgba(0,230,118,0.35)";
        ctx.lineWidth = 1;
        const cx2 = bx + bw / 2, midY = by + bh * 0.38;
        ctx.beginPath();
        ctx.moveTo(cx2 - bw * 0.28, midY);
        ctx.lineTo(cx2 + bw * 0.28, midY);
        ctx.stroke();

        // Score badge
        const scoreColor = isDistress ? "#ff3b55" : isWarning ? "#ffab40" : "#00e676";
        ctx.fillStyle = "rgba(2,10,20,0.75)";
        ctx.fillRect(bx, by - 14, 48, 14);
        ctx.fillStyle = scoreColor;
        ctx.font = "bold 8px monospace";
        ctx.fillText(
          `S-0${cam.swimmers} ${isDistress ? "DIST" : isWarning ? "WARN" : "OK"} ${isDistress ? 78 : isWarning ? 47 : 12}`,
          bx + 3, by - 4
        );
      }

      // Second swimmer (if multiple)
      if (cam.swimmers > 1) {
        const bx2 = W * 0.06, by2 = H * 0.3, bw2 = W * 0.2, bh2 = H * 0.4;
        ctx.strokeStyle = "rgba(0,230,118,0.5)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx2, by2, bw2, bh2);
        ctx.beginPath();
        ctx.arc(bx2 + bw2 / 2, by2 + bh2 * 0.2, 5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0,200,150,0.35)";
        ctx.fill();
      }

      // Scan line sweep
      const scanY = (t * 1.2) % (H + 10);
      const grad = ctx.createLinearGradient(0, scanY - 8, 0, scanY + 8);
      grad.addColorStop(0, "rgba(0,200,255,0)");
      grad.addColorStop(0.5, "rgba(0,200,255,0.04)");
      grad.addColorStop(1, "rgba(0,200,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - 8, W, 16);

      // Grid overlay (faint)
      ctx.strokeStyle = "rgba(0,170,210,0.04)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x < W; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, [cam]);

  return (
    <div style={{
      background: "#060f1e",
      border: `1px solid ${isDistress ? "rgba(255,59,85,0.45)" : isWarning ? "rgba(255,171,64,0.3)" : "rgba(0,170,210,0.12)"}`,
      borderRadius: 10,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      boxShadow: isDistress ? `0 0 24px rgba(255,59,85,0.18)` : "none",
      animation: isDistress ? "sd_cardPulse 2s ease-in-out infinite" : "none",
      transition: "box-shadow 0.3s",
    }}>
      {/* Camera header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "7px 10px",
        borderBottom: `1px solid rgba(0,170,210,0.08)`,
        background: "rgba(0,0,0,0.2)",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          {/* REC dot */}
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#ff3b55",
            boxShadow: "0 0 5px rgba(255,59,85,0.7)",
            animation: "sd_recBlink 1.2s ease-in-out infinite",
          }} />
          <span style={{ fontSize: 10, fontWeight: 700, color: "#c8e4f8", fontFamily: "monospace", letterSpacing: "0.06em" }}>
            {cam.id}
          </span>
          <span style={{ fontSize: 9, color: "#1e4060", fontFamily: "monospace" }}>
            {cam.zone}
          </span>
        </div>
        <div style={{
          padding: "2px 8px", borderRadius: 4,
          background: s.bg, border: `1px solid ${s.border}`,
          fontSize: 8, fontWeight: 800, letterSpacing: "0.1em",
          color: s.color, fontFamily: "monospace",
          animation: isDistress ? "sd_statusFlash 1.4s ease-in-out infinite" : "none",
        }}>
          {s.label}
        </div>
      </div>

      {/* Video canvas */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          width={320} height={180}
          style={{ width: "100%", height: "100%", display: "block", objectFit: "cover" }}
        />
        {/* FPS overlay */}
        <div style={{
          position: "absolute", top: 5, left: 6,
          fontSize: 8, color: "rgba(0,200,255,0.5)", fontFamily: "monospace",
        }}>
          {cam.fps} FPS
        </div>
        {/* Swimmer count pill */}
        <div style={{
          position: "absolute", bottom: 6, right: 6,
          background: "rgba(2,10,20,0.75)",
          border: "1px solid rgba(0,170,210,0.2)",
          borderRadius: 4, padding: "2px 7px",
          fontSize: 9, color: "#3a8090", fontFamily: "monospace",
        }}>
          {cam.swimmers} swimmer{cam.swimmers !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Footer — last event */}
      <div style={{
        padding: "5px 10px",
        borderTop: "1px solid rgba(0,170,210,0.06)",
        background: "rgba(0,0,0,0.15)",
        flexShrink: 0,
      }}>
        <span style={{
          fontSize: 9, color: isDistress ? "#ff3b55" : isWarning ? "#ffab40" : "#1e4060",
          fontFamily: "monospace", letterSpacing: "0.04em",
        }}>
          {cam.lastEvent}
        </span>
      </div>
    </div>
  );
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar() {
  const total     = CAMERAS.reduce((s, c) => s + c.swimmers, 0);
  const distress  = CAMERAS.filter((c) => c.status === "distress").length;
  const warning   = CAMERAS.filter((c) => c.status === "warning").length;
  const normal    = CAMERAS.filter((c) => c.status === "normal").length;

  const items = [
    { label: "CAMERAS ONLINE", value: `${CAMERAS.length} / ${CAMERAS.length}`, color: "#00e676" },
    { label: "TOTAL SWIMMERS", value: total,    color: "#00aacc" },
    { label: "ALL CLEAR",      value: normal,   color: "#00e676" },
    { label: "WARNING",        value: warning,  color: warning  > 0 ? "#ffab40" : "#1e4060" },
    { label: "DISTRESS",       value: distress, color: distress > 0 ? "#ff3b55" : "#1e4060" },
  ];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 0,
      padding: "0 20px",
      background: "#020a14",
      borderBottom: "1px solid rgba(0,170,210,0.08)",
      height: 44, flexShrink: 0,
    }}>
      {items.map((item, i) => (
        <div key={i} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "0 20px",
          borderLeft: i > 0 ? "1px solid rgba(0,170,210,0.08)" : "none",
        }}>
          <span style={{ fontSize: 8, color: "#1a3050", letterSpacing: "0.14em", fontFamily: "monospace" }}>
            {item.label}
          </span>
          <span style={{
            fontSize: 14, fontWeight: 800,
            color: item.color, fontFamily: "monospace",
            fontVariantNumeric: "tabular-nums",
            transition: "color 0.4s",
          }}>
            {item.value}
          </span>
        </div>
      ))}

      <div style={{ flex: 1 }} />

      {/* Live indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#00e676", boxShadow: "0 0 6px rgba(0,230,118,0.6)",
          animation: "sd_recBlink 2s ease-in-out infinite",
        }} />
        <span style={{ fontSize: 9, color: "#1a4030", fontFamily: "monospace", letterSpacing: "0.1em" }}>
          LIVE MONITORING
        </span>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SchoolDashboard() {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      overflow: "hidden", background: "#020c17",
    }}>
      <SummaryBar />

      <div style={{ flex: 1, overflow: "hidden", display: "flex", gap: 0 }}>

        {/* Camera grid */}
        <div style={{
          flex: 1, overflow: "auto",
          padding: 14,
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gridTemplateRows: "repeat(2, 1fr)",
          gap: 12,
          alignContent: "start",
        }}>
          {CAMERAS.map((cam) => (
            <CameraTile key={cam.id} cam={cam} />
          ))}
        </div>

        {/* Right sidebar — pool map + alert log */}
        <div style={{
          width: 320, flexShrink: 0,
          borderLeft: "1px solid rgba(0,170,210,0.08)",
          display: "flex", flexDirection: "column",
          background: "#030e1c",
          overflow: "hidden",
        }}>

          {/* Pool map */}
          <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid rgba(0,170,210,0.08)" }}>
            <div style={{
              fontSize: 8, color: "#0e2840", letterSpacing: "0.14em",
              fontFamily: "monospace", marginBottom: 8, textTransform: "uppercase",
            }}>
              Pool Layout — Camera Coverage
            </div>
            <PoolMap />
            {/* Legend */}
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              {Object.entries(STATUS).map(([key, s]) => (
                <div key={key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, opacity: 0.8 }} />
                  <span style={{ fontSize: 7, color: "#1a3050", fontFamily: "monospace" }}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Camera status list */}
          <div style={{ flex: 1, overflow: "auto", padding: "10px 14px" }}>
            <div style={{
              fontSize: 8, color: "#0e2840", letterSpacing: "0.14em",
              fontFamily: "monospace", marginBottom: 8, textTransform: "uppercase",
            }}>
              Camera Status
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {CAMERAS.map((cam) => {
                const s = STATUS[cam.status];
                return (
                  <div key={cam.id} style={{
                    display: "flex", alignItems: "center", gap: 9,
                    padding: "7px 10px",
                    background: "rgba(0,20,40,0.4)",
                    border: `1px solid ${cam.status === "distress" ? "rgba(255,59,85,0.25)" : "rgba(0,170,210,0.07)"}`,
                    borderLeft: `3px solid ${s.color}`,
                    borderRadius: 6,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#c8e4f8", fontFamily: "monospace" }}>
                          {cam.id}
                        </span>
                        <span style={{ fontSize: 8, color: "#1e4060", fontFamily: "monospace" }}>
                          {cam.zone}
                        </span>
                      </div>
                      <div style={{ fontSize: 9, color: cam.status !== "normal" ? s.color : "#1e4060" }}>
                        {cam.lastEvent}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: s.color, fontFamily: "monospace" }}>
                        {s.label}
                      </div>
                      <div style={{ fontSize: 8, color: "#1e3a50", fontFamily: "monospace" }}>
                        {cam.swimmers} sw
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Footer branding */}
          <div style={{
            padding: "10px 14px",
            borderTop: "1px solid rgba(0,170,210,0.06)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <span style={{
              fontSize: 8, color: "#0e2030", letterSpacing: "0.14em",
              fontFamily: "monospace", textTransform: "uppercase",
            }}>
              AquaGuard · Multi-Camera School Monitoring
            </span>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes sd_recBlink {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.2; }
        }
        @keyframes sd_cardPulse {
          0%,100% { box-shadow: 0 0 24px rgba(255,59,85,0.18); }
          50%      { box-shadow: 0 0 40px rgba(255,59,85,0.38); }
        }
        @keyframes sd_statusFlash {
          0%,100% { opacity: 1; }
          50%      { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

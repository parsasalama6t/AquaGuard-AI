import { useRef, useEffect, useState, useCallback } from "react";

const STREAM_URL = "http://localhost:8000/stream/jpeg";

const STATUS_COLOR = {
  normal:   "#00e676",
  warning:  "#ffab40",
  distress: "#ff3b55",
};

// ── Canvas overlay drawing ────────────────────────────────────────────────────

function drawOverlay(canvas, img, swimmers) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const cw = canvas.offsetWidth;
  const ch = canvas.offsetHeight;

  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }

  ctx.clearRect(0, 0, cw, ch);
  if (!swimmers?.length || !img) return;

  // Letterbox math for object-fit: contain
  const natW = img.naturalWidth  || cw;
  const natH = img.naturalHeight || ch;
  const scale   = Math.min(cw / natW, ch / natH);
  const offsetX = (cw - natW * scale) / 2;
  const offsetY = (ch - natH * scale) / 2;

  swimmers.forEach((swimmer) => {
    const { swimmer_id, status = "normal", score = 0, bbox } = swimmer;
    if (!bbox || bbox.length < 4) return;

    const color    = STATUS_COLOR[status] ?? STATUS_COLOR.normal;
    const isAlarm  = status === "distress";
    const isWarn   = status === "warning";

    const x = bbox[0] * scale + offsetX;
    const y = bbox[1] * scale + offsetY;
    const w = (bbox[2] - bbox[0]) * scale;
    const h = (bbox[3] - bbox[1]) * scale;
    const cLen = Math.max(12, Math.min(w, h) * 0.2);

    // ── Glow shadow for alarm states ──────────────────────────────────── //
    if (isAlarm || isWarn) {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur  = isAlarm ? 18 : 10;
    }

    // ── Corner brackets (L-shape, thicker) ───────────────────────────── //
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth   = isAlarm ? 3 : 2;
    ctx.lineCap     = "square";

    const corners = [
      [[x, y + cLen],         [x, y],         [x + cLen, y]],
      [[x + w - cLen, y],     [x + w, y],     [x + w, y + cLen]],
      [[x, y + h - cLen],     [x, y + h],     [x + cLen, y + h]],
      [[x + w - cLen, y + h], [x + w, y + h], [x + w, y + h - cLen]],
    ];
    corners.forEach(([a, b, c]) => {
      ctx.beginPath();
      ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c);
      ctx.stroke();
    });
    ctx.restore();

    if (isAlarm || isWarn) ctx.restore();

    // ── Semi-transparent fill (dim) ───────────────────────────────────── //
    ctx.save();
    ctx.fillStyle = isAlarm
      ? "rgba(255,59,85,0.05)"
      : isWarn
      ? "rgba(255,171,64,0.04)"
      : "transparent";
    ctx.fillRect(x, y, w, h);
    ctx.restore();

    // ── Center crosshair (small) ──────────────────────────────────────── //
    const cx = x + w / 2;
    const cy = y + h / 2;
    const cr = 5;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cx - cr, cy); ctx.lineTo(cx + cr, cy);
    ctx.moveTo(cx, cy - cr); ctx.lineTo(cx, cy + cr);
    ctx.stroke();
    ctx.restore();

    // ── Label chip above bbox ─────────────────────────────────────────── //
    const idStr    = `S-${String(swimmer_id).padStart(2, "0")}`;
    const statStr  = status.toUpperCase();
    const label    = `${idStr}  ${statStr}`;
    const chipFont = "bold 11px monospace";
    ctx.font = chipFont;
    const tw   = ctx.measureText(label).width;
    const chipH = 19;
    const chipY = Math.max(0, y - chipH - 4);

    // Chip background
    ctx.save();
    ctx.fillStyle   = color;
    ctx.globalAlpha = 0.88;
    ctx.beginPath();
    ctx.roundRect(x, chipY, tw + 12, chipH, 3);
    ctx.fill();
    ctx.restore();

    // Chip text
    ctx.save();
    ctx.fillStyle = "#000000";
    ctx.font      = chipFont;
    ctx.globalAlpha = 0.95;
    ctx.fillText(label, x + 6, chipY + 13);
    ctx.restore();

    // ── Score bar below bbox ──────────────────────────────────────────── //
    const barY    = y + h + 5;
    const barH    = 4;
    const fillW   = w * Math.min(1, Math.max(0, score / 100));
    const barFill = score < 40 ? "#00e676" : score < 70 ? "#ffab40" : "#ff3b55";

    // Track
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath(); ctx.roundRect(x, barY, w, barH, 2); ctx.fill();
    ctx.restore();

    // Fill + glow
    if (fillW > 0) {
      ctx.save();
      ctx.fillStyle   = barFill;
      ctx.shadowColor = barFill;
      ctx.shadowBlur  = 4;
      ctx.beginPath(); ctx.roundRect(x, barY, fillW, barH, 2); ctx.fill();
      ctx.restore();
    }

    // Score label
    ctx.save();
    ctx.fillStyle = "rgba(180,210,230,0.55)";
    ctx.font      = "9px monospace";
    const scoreStr = `${score.toFixed(0)}/100`;
    const sw       = ctx.measureText(scoreStr).width;
    ctx.fillText(scoreStr, x + w - sw, barY + barH + 10);
    ctx.restore();
  });
}

// roundRect polyfill (Safari < 15.4)
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    this.beginPath();
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.arcTo(x + w, y, x + w, y + r, r);
    this.lineTo(x + w, y + h - r);
    this.arcTo(x + w, y + h, x + w - r, y + h, r);
    this.lineTo(x + r, y + h);
    this.arcTo(x, y + h, x, y + h - r, r);
    this.lineTo(x, y + r);
    this.arcTo(x, y, x + r, y, r);
    this.closePath();
  };
}

// ── HUD pill ─────────────────────────────────────────────────────────────────

function HUDPill({ label, value, color = "#2d6a8a", pulse = false, size = "sm" }) {
  return (
    <div style={{
      background: "rgba(2,10,20,0.72)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      border: "1px solid rgba(0,150,190,0.18)",
      borderRadius: 5,
      padding: size === "lg" ? "4px 12px" : "3px 9px",
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
    }}>
      <span style={{
        fontSize: 8,
        color: "#1a3a52",
        textTransform: "uppercase",
        letterSpacing: "0.12em",
        fontFamily: "monospace",
      }}>
        {label}
      </span>
      <span style={{
        fontSize: size === "lg" ? 13 : 11,
        fontWeight: 700,
        color,
        fontFamily: "monospace",
        fontVariantNumeric: "tabular-nums",
        animation: pulse ? "hudPulse 1.6s ease-in-out infinite" : "none",
        textShadow: pulse ? `0 0 8px ${color}` : "none",
      }}>
        {value}
      </span>
    </div>
  );
}

// ── Disconnected overlay ──────────────────────────────────────────────────────

function DisconnectedOverlay() {
  return (
    <div style={{
      position: "absolute", inset: 0,
      background: "rgba(2,8,18,0.9)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 18, zIndex: 10,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: "50%",
        border: "2px solid rgba(255,59,85,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        animation: "ringPulse 2s ease-in-out infinite",
      }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
          stroke="#ff3b55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, color: "#2d6a8a", fontWeight: 600, letterSpacing: "0.1em" }}>
          CONNECTING TO BACKEND
        </div>
        <div style={{ fontSize: 11, color: "#1a3a50", marginTop: 4, fontFamily: "monospace" }}>
          ws://localhost:8000/ws
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function VideoFeed({ swimmers = [], isConnected, fps, frameCount, sourceName }) {
  const canvasRef    = useRef(null);
  const imgRef       = useRef(null);
  const containerRef = useRef(null);
  const [streamOk, setStreamOk] = useState(false);

  const redraw = useCallback(() => {
    drawOverlay(canvasRef.current, imgRef.current, swimmers);
  }, [swimmers]);

  useEffect(() => { redraw(); }, [redraw]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(redraw);
    obs.observe(el);
    return () => obs.disconnect();
  }, [redraw]);

  const distressCount = swimmers.filter((s) => s.status === "distress").length;

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative", width: "100%", height: "100%",
        background: "#010810", overflow: "hidden",
      }}
    >
      {/* ── Scanline effect overlay ──────────────────────────────────────── */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 2,
        pointerEvents: "none",
        background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.04) 2px, rgba(0,0,0,0.04) 4px)",
      }} />

      {/* ── Sweep line (subtle animation across video) ───────────────────── */}
      {isConnected && streamOk && (
        <div style={{
          position: "absolute", left: 0, right: 0, height: 1, zIndex: 3,
          background: "linear-gradient(90deg, transparent, rgba(0,200,230,0.2), transparent)",
          pointerEvents: "none",
          animation: "sweepY 5s linear infinite",
        }} />
      )}

      {/* ── MJPEG stream ────────────────────────────────────────────────── */}
      <img
        ref={imgRef}
        src={STREAM_URL}
        alt="Pool feed"
        onLoad={() => { setStreamOk(true); redraw(); }}
        onError={() => setStreamOk(false)}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "contain", display: "block",
        }}
      />

      {/* ── Canvas overlay ──────────────────────────────────────────────── */}
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          pointerEvents: "none", zIndex: 4,
        }}
      />

      {/* ── Disconnected overlay ─────────────────────────────────────────── */}
      {!isConnected && <DisconnectedOverlay />}

      {/* ── Top-left HUD ─────────────────────────────────────────────────── */}
      {isConnected && (
        <div style={{
          position: "absolute", top: 12, left: 12, zIndex: 5,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <HUDPill label="FPS"   value={(fps || 0).toFixed(1)} color={fps >= 20 ? "#00e676" : fps >= 10 ? "#ffab40" : "#ff3b55"} />
          <HUDPill label="FRAME" value={String(frameCount ?? 0).padStart(6, "0")} />
        </div>
      )}

      {/* ── Top-right HUD: LIVE ──────────────────────────────────────────── */}
      {isConnected && (
        <div style={{ position: "absolute", top: 12, right: 12, zIndex: 5 }}>
          <HUDPill label="LIVE" value="●" color="#00e676" pulse size="lg" />
        </div>
      )}

      {/* ── Bottom-left HUD: swimmer stats ───────────────────────────────── */}
      {isConnected && (
        <div style={{
          position: "absolute", bottom: 12, left: 12, zIndex: 5,
          display: "flex", flexDirection: "column", gap: 4,
        }}>
          <HUDPill
            label="TRACKING"
            value={`${swimmers.length} SWIMMER${swimmers.length !== 1 ? "S" : ""}`}
          />
          {distressCount > 0 && (
            <HUDPill
              label="DISTRESS"
              value={`${distressCount} DETECTED`}
              color="#ff3b55"
              pulse
            />
          )}
        </div>
      )}

      {/* ── Bottom-right HUD: source label ───────────────────────────────── */}
      {isConnected && streamOk && (
        <div style={{ position: "absolute", bottom: 12, right: 12, zIndex: 5 }}>
          <HUDPill label="SOURCE" value={sourceName ? sourceName.replace(/\.[^.]+$/, "").toUpperCase() : "POOL A"} color="#1e5a78" />
        </div>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes hudPulse {
          0%,100% { opacity: 1; }
          50%     { opacity: 0.3; }
        }
        @keyframes sweepY {
          0%   { top: 0%;   }
          100% { top: 100%; }
        }
        @keyframes ringPulse {
          0%,100% { transform: scale(1);    opacity: 0.8; }
          50%     { transform: scale(1.1);  opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

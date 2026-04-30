import { useState, useEffect } from "react";

const API = "http://localhost:8000";

function FileIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="23 7 16 1 1 1 1 23 23 23 23 7" />
      <polyline points="16 1 16 7 23 7" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <polygon points="9.5 9 7 12 9.5 15" fill="currentColor" stroke="none" />
      <polygon points="14.5 9 17 12 14.5 15" fill="currentColor" stroke="none" />
    </svg>
  );
}

function VideoCard({ video, onClick, switching }) {
  const [hovered, setHovered] = useState(false);

  const isActive = video.active;
  const borderColor = isActive ? "#185FA5" : hovered ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.07)";
  const bgColor = isActive ? "rgba(24,95,165,0.12)" : hovered ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)";

  // Strip extension for display
  const displayName = video.name.replace(/\.[^.]+$/, "");

  return (
    <button
      onClick={() => !isActive && !switching && onClick(video)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={isActive || switching}
      style={{
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 10,
        padding: "16px 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        cursor: isActive ? "default" : switching ? "wait" : "pointer",
        transition: "background 0.15s, border-color 0.15s",
        width: "100%",
        position: "relative",
        outline: "none",
      }}
    >
      {/* Active badge */}
      {isActive && (
        <div style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "#185FA5",
          color: "#fff",
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: "0.08em",
          padding: "2px 6px",
          borderRadius: 4,
          textTransform: "uppercase",
        }}>
          Active
        </div>
      )}

      {/* Icon */}
      <div style={{
        color: isActive ? "#4fa3e8" : "#475569",
        transition: "color 0.15s",
      }}>
        <FileIcon />
      </div>

      {/* Filename */}
      <div style={{
        fontSize: 13,
        fontWeight: 500,
        color: isActive ? "#e2e8f0" : "#94a3b8",
        textAlign: "center",
        wordBreak: "break-all",
        lineHeight: 1.3,
      }}>
        {displayName}
      </div>

      {/* Size */}
      <div style={{
        fontSize: 11,
        color: "#475569",
        fontVariantNumeric: "tabular-nums",
      }}>
        {video.size_mb} MB
      </div>
    </button>
  );
}

export default function VideoSelector({ onClose }) {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API}/videos`)
      .then((r) => r.json())
      .then((data) => { setVideos(data); setLoading(false); })
      .catch(() => { setError("Could not load video list."); setLoading(false); });
  }, []);

  async function handleSelect(video) {
    setSwitching(true);
    try {
      const res = await fetch(`${API}/videos/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: video.path }),
      });
      if (!res.ok) throw new Error("Select failed");
      // Mark the new video as active locally so it reflects instantly
      setVideos((prev) => prev.map((v) => ({ ...v, active: v.path === video.path })));
    } catch {
      setError("Failed to switch video.");
    } finally {
      setSwitching(false);
    }
  }

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Modal card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#0d1421",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 14,
          width: 480,
          maxWidth: "90vw",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9" }}>
              Video Sources
            </div>
            <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>
              Click a file to start analyzing it
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              color: "#94a3b8",
              cursor: "pointer",
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {loading && (
            <div style={{ color: "#475569", fontSize: 13, textAlign: "center", padding: 32 }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ color: "#ef4444", fontSize: 13, textAlign: "center", padding: 32 }}>
              {error}
            </div>
          )}
          {!loading && !error && (
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}>
              {videos.map((v) => (
                <VideoCard
                  key={v.path}
                  video={v}
                  onClick={handleSelect}
                  switching={switching}
                />
              ))}
            </div>
          )}

          {switching && (
            <div style={{
              marginTop: 14,
              fontSize: 12,
              color: "#4fa3e8",
              textAlign: "center",
            }}>
              Switching video source…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

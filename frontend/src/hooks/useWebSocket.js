import { useState, useEffect, useRef, useCallback } from "react";

const MAX_ALERTS = 50;
const RECONNECT_DELAY_MS = 3000;
const API_BASE = "http://localhost:8000";

/**
 * Custom hook that manages a persistent WebSocket connection to the
 * AquaGuard FastAPI backend and exposes live detection data to components.
 *
 * Reconnects automatically after disconnection until the component unmounts.
 *
 * @param {string} url - WebSocket endpoint URL
 * @returns live detection state + control functions
 */
export default function useWebSocket(url = "ws://localhost:8000/ws") {
  const [isConnected, setIsConnected] = useState(false);
  const [swimmers, setSwimmers] = useState([]);
  const [alerts, setAlerts] = useState([]);             // full history, newest first
  const [activeAlerts, setActiveAlerts] = useState([]); // unresolved only
  const [fps, setFps] = useState(0);
  const [frameCount, setFrameCount] = useState(0);
  const [stats, setStats] = useState({});
  const [lastMessage, setLastMessage] = useState(null);
  const [reconnectCount, setReconnectCount] = useState(0);
  const [videoEnded, setVideoEnded] = useState(false);
  const [distressAnalysis, setDistressAnalysis] = useState(null);

  const ws = useRef(null);
  const reconnectTimer = useRef(null);
  const shouldReconnect = useRef(true);
  // Stable ref so the onclose closure always reads the latest count
  const reconnectCountRef = useRef(0);

  const connect = useCallback(() => {
    // Don't open a second socket if one is already alive
    if (
      ws.current &&
      (ws.current.readyState === WebSocket.OPEN ||
        ws.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(url);
    ws.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      console.log("[AquaGuard] WebSocket connected");

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      socket.send(JSON.stringify({ type: "ping" }));
    };

    socket.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return; // ignore malformed frames
      }

      setLastMessage(msg);

      if (msg.type === "source_changed") {
        // Video switched — wipe all per-session state immediately
        setSwimmers([]);
        setAlerts([]);
        setActiveAlerts([]);
        setFps(0);
        setFrameCount(0);
        setVideoEnded(false);
        setDistressAnalysis(null);
        return;
      }

      if (msg.type === "video_ended") {
        setVideoEnded(true);
        return;
      }

      if (msg.type === "distress_confirmed") {
        setDistressAnalysis(msg.data);
        return;
      }

      if (msg.type === "frame_update") {
        const data = msg.data ?? {};

        if (Array.isArray(data.swimmers)) setSwimmers(data.swimmers);
        if (typeof data.fps === "number") setFps(data.fps);
        if (typeof data.frame_count === "number") setFrameCount(data.frame_count);

        setStats({
          sourceType: data.source_type,
          source_name: data.source_name,
          isRunning: data.is_running,
          fps: data.fps,
          frameCount: data.frame_count,
          gemini: data.gemini,
        });

        if (Array.isArray(data.active_alerts)) {
          setActiveAlerts(data.active_alerts);
        }
      } else if (msg.type === "alert") {
        const incoming = msg.data;
        setAlerts((prev) => [incoming, ...prev].slice(0, MAX_ALERTS));
        setActiveAlerts((prev) => {
          // Replace any existing alert for this swimmer
          const filtered = prev.filter(
            (a) => a.swimmer_id !== incoming.swimmer_id
          );
          return [incoming, ...filtered];
        });
      } else if (msg.type === "connection") {
        console.log("[AquaGuard] Connection confirmed:", msg.data);
      }
      // "pong" responses are silently consumed
    };

    socket.onerror = (err) => {
      console.error("[AquaGuard] WebSocket error:", err);
      setIsConnected(false);
    };

    socket.onclose = () => {
      setIsConnected(false);
      console.log("[AquaGuard] WebSocket disconnected");

      if (!shouldReconnect.current) return;

      const attempt = reconnectCountRef.current + 1;
      reconnectCountRef.current = attempt;
      setReconnectCount(attempt);
      console.log(`[AquaGuard] Reconnecting in 3s… attempt ${attempt}`);

      reconnectTimer.current = setTimeout(() => {
        if (shouldReconnect.current) connect();
      }, RECONNECT_DELAY_MS);
    };
  }, [url]);

  // ── Control functions ──────────────────────────────────────────────────────

  const sendMessage = useCallback((message) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    }
  }, []);

  const resolveAlert = useCallback(async (swimmerId) => {
    try {
      const res = await fetch(
        `${API_BASE}/alerts/${swimmerId}/resolve`,
        { method: "POST" }
      );
      if (res.ok) {
        setActiveAlerts((prev) =>
          prev.filter((a) => a.swimmer_id !== swimmerId)
        );
      }
    } catch (err) {
      console.error("[AquaGuard] resolveAlert failed:", err);
    }
  }, []);

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  useEffect(() => {
    shouldReconnect.current = true;
    connect();

    return () => {
      shouldReconnect.current = false;

      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      if (ws.current) {
        // Null out onclose before closing so the reconnect branch never fires
        ws.current.onclose = null;
        ws.current.close();
        ws.current = null;
      }
    };
  }, [connect]);

  // ── Public interface ───────────────────────────────────────────────────────

  return {
    isConnected,
    swimmers,
    alerts,
    activeAlerts,
    fps,
    frameCount,
    stats,
    lastMessage,
    reconnectCount,
    videoEnded,
    distressAnalysis,
    dismissDistressAnalysis: () => setDistressAnalysis(null),
    sendMessage,
    resolveAlert,
  };
}

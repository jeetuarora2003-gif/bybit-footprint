import { useEffect, useRef, useState, useCallback } from "react";

const HOST     = window.location.host;
const PROTOCOL = window.location.protocol === "https:" ? "wss:" : "ws:";
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BASE_WS  = IS_LOCAL ? "ws://localhost:8080"          : `${PROTOCOL}//${HOST}`;
const BASE_HTTP = IS_LOCAL ? "http://localhost:8080"        : "";

// Timeframe value -> candle duration in ms
const TF_MS = {
  "15s": 15000, "30s": 30000,
  "1m":  60000, "2m":  120000, "3m":  180000, "5m":  300000,
  "10m": 600000, "15m": 900000, "30m": 1800000,
  "1h":  3600000, "2h":  7200000, "4h":  14400000,
  "6h":  21600000, "8h": 28800000, "12h": 43200000,
  "D":   86400000, "W":  604800000, "M":  2592000000,
};

export default function useWebSocket(timeframe = "1m") {
  const [candles,    setCandles]    = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const [status,     setStatus]     = useState("disconnected");

  const wsRef          = useRef(null);
  const reconnectRef   = useRef(null);
  const lastOpenRef    = useRef(null);
  const lastCandleRef  = useRef(null);
  const historySetRef  = useRef(new Set());
  const timeframeRef   = useRef(timeframe);
  timeframeRef.current = timeframe;

  const connect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();

    const fetchHistory = async () => {
      try {
        const res  = await fetch(`${BASE_HTTP}/history`);
        const hist = await res.json();
        if (Array.isArray(hist) && hist.length > 0) {
          setCandles(hist);
          const times = new Set(hist.map(c => c.candle_open_time));
          historySetRef.current = times;
          lastOpenRef.current   = hist[hist.length - 1].candle_open_time;
        }
      } catch (e) {
        console.warn("[history] not available, starting from live:", e.message);
      }
    };

    fetchHistory().then(() => {
      setStatus("connecting");
      const ws = new WebSocket(BASE_WS);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connected");

      ws.onmessage = (evt) => {
        try {
          const msg      = JSON.parse(evt.data);
          const tfMs     = TF_MS[timeframeRef.current] ?? 60000;
          // Re-bucket the server's 1-min candle_open_time into the selected timeframe
          const rawOpen  = msg.candle_open_time;
          const openTime = rawOpen - (rawOpen % tfMs);
          const rebucketedMsg = { ...msg, candle_open_time: openTime };

          if (
            lastOpenRef.current !== null &&
            openTime !== lastOpenRef.current &&
            lastCandleRef.current
          ) {
            const archived = { ...lastCandleRef.current };
            if (!historySetRef.current.has(archived.candle_open_time)) {
              historySetRef.current.add(archived.candle_open_time);
              setCandles(prev => [...prev, archived]);
            }
          }

          lastOpenRef.current   = openTime;
          lastCandleRef.current = rebucketedMsg;
          setLiveCandle(rebucketedMsg);
        } catch { /* ignore parse errors */ }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        setStatus("disconnected");
        reconnectRef.current = setTimeout(connect, 2000);
      };
    });
  }, []); // intentionally no deps — timeframe reads from ref

  // Reconnect when timeframe changes: clear all state, reconnect
  useEffect(() => {
    setCandles([]);
    setLiveCandle(null);
    lastOpenRef.current   = null;
    lastCandleRef.current = null;
    historySetRef.current = new Set();
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [timeframe, connect]);

  return { candles, liveCandle, status };
}

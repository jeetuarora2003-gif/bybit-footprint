import { useEffect, useRef, useState, useCallback } from "react";

const HOST = window.location.host;
const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const DEFAULT_URL = IS_LOCAL ? "ws://localhost:8080" : `${PROTOCOL}//${HOST}`;
const HISTORY_URL = IS_LOCAL ? "http://localhost:8080/history" : "/history";

export default function useWebSocket(url = DEFAULT_URL) {
  const [candles, setCandles] = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const [status, setStatus] = useState("disconnected");

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const lastOpenTimeRef = useRef(null);
  const lastCandleRef = useRef(null);
  // FIX #2: track open times from history to prevent duplicate bar on first rotation
  const historyTimesRef = useRef(new Set());

  const connect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();

    // FIX #1: Fetch history from our own backend /history (has real footprint clusters)
    const fetchHistory = async () => {
      try {
        const res = await fetch(HISTORY_URL);
        const hist = await res.json();
        if (Array.isArray(hist) && hist.length > 0) {
          // hist is already sorted oldest→newest from backend (completedBars order)
          setCandles(hist);
          // FIX #2: record all open times so we never archive a bar that already exists
          const times = new Set(hist.map(c => c.candle_open_time));
          historyTimesRef.current = times;
          // seed lastOpenTime so the first live message doesn't try to archive a ghost bar
          lastOpenTimeRef.current = hist[hist.length - 1].candle_open_time;
        }
      } catch (e) {
        console.warn("[history] backend /history unavailable, chart starts from live", e);
      }
    };

    fetchHistory().then(() => {
      setStatus("connecting");
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setStatus("connected");

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          const openTime = msg.candle_open_time;

          // FIX #2: only archive if bar has rotated AND it's not already in our history set
          if (
            lastOpenTimeRef.current !== null &&
            openTime !== lastOpenTimeRef.current &&
            lastCandleRef.current
          ) {
            const archived = { ...lastCandleRef.current };
            if (!historyTimesRef.current.has(archived.candle_open_time)) {
              historyTimesRef.current.add(archived.candle_open_time);
              setCandles((prev) => [...prev, archived]);
            }
          }

          lastOpenTimeRef.current = openTime;
          lastCandleRef.current = msg;
          setLiveCandle(msg);
        } catch {
          // ignore parse errors
        }
      };

      ws.onerror = () => {};

      ws.onclose = () => {
        setStatus("disconnected");
        reconnectRef.current = setTimeout(connect, 2000);
      };
    });
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { candles, liveCandle, status };
}

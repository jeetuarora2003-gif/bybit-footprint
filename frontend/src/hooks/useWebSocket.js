import { useEffect, useRef, useState, useCallback } from "react";

// Dynamically determine WebSocket URL back to the server
// If viewing online, it connects securely to the host domain. If local, defaults to 8080.
const HOST = window.location.host;
const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const IS_LOCAL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const DEFAULT_URL = IS_LOCAL ? "ws://localhost:8080" : `${PROTOCOL}//${HOST}`;

/**
 * Connects to the backend websocket, accumulates completed candles,
 * tracks live orderbook and OI state.
 *
 * Returns { candles, liveCandle, status, orderbook }
 */
export default function useWebSocket(url = DEFAULT_URL) {
  const [candles, setCandles] = useState([]);
  const [liveCandle, setLiveCandle] = useState(null);
  const [status, setStatus] = useState("disconnected");

  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const lastOpenTimeRef = useRef(null);
  const lastCandleRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current) wsRef.current.close();

    const fetchHistory = async () => {
      try {
        const res = await fetch("https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=1&limit=100");
        const json = await res.json();
        if (json.retCode === 0) {
          const hist = json.result.list.map(k => ({
            candle_open_time: parseInt(k[0]),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            total_volume: parseFloat(k[5]),
            clusters: [] // missing in REST klines
          })).reverse();
          setCandles(hist);
        }
      } catch (e) {
        console.error("Failed to load historical klines", e);
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

          if (
            lastOpenTimeRef.current !== null &&
            openTime !== lastOpenTimeRef.current &&
            lastCandleRef.current
          ) {
            const archived = { ...lastCandleRef.current };
            setCandles((prev) => [...prev, archived]);
          }

          lastOpenTimeRef.current = openTime;
          lastCandleRef.current = msg;
          setLiveCandle(msg);
        } catch {
          // ignore
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

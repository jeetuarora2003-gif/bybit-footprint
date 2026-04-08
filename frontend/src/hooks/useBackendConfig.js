import { useEffect, useState } from "react";

const HOST = window.location.host;
const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const BASE_HTTP = IS_LOCAL ? "http://localhost:8080" : `${window.location.protocol}//${HOST}`;

export default function useBackendConfig() {
  const [config, setConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`${BASE_HTTP}/config`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled) {
          setConfig(data);
        }
      } catch {
        // Backend config is optional for initial render.
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return config;
}

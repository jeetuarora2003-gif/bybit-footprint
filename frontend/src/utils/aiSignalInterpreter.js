const ACTION_BY_SIGNAL = {
  TRAP_SHORT: "SELL",
  TRAP_LONG: "BUY",
  CONTINUATION_LONG: "BUY",
  CONTINUATION_SHORT: "SELL",
  NO_TRADE: "WAIT",
};

const DEFAULT_THRESHOLD = 0.65;
const DEFAULT_MODEL = "gpt-5";
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const EM_DASH = "\u2014";

const LOCATION_LABELS = {
  resistance: "at resistance",
  support: "at support",
  vwap: "at VWAP",
  value_area_high: "at value area high",
  value_area_low: "at value area low",
  range_top: "at range top",
  range_bottom: "at range bottom",
  breakout_level: "at breakout level",
  breakdown_level: "at breakdown level",
  mid_range: "mid-range",
};

const RESULT_LABELS = {
  failed_up_move: "failed breakout",
  failed_down_move: "failed breakdown",
  failed_breakout: "failed breakout",
  failed_breakdown: "failed breakdown",
  accepted_above: "accepted above level",
  accepted_below: "accepted below level",
  breakout_holding: "breakout holding",
  breakdown_holding: "breakdown holding",
  success_up_move: "up move holding",
  success_down_move: "down move holding",
  blocked: "conditions blocked",
  mixed: "mixed follow-through",
};

const CONTEXT_LABELS = {
  range_top: "near range top",
  range_bottom: "near range bottom",
  range: "in range",
  trend_up: "in uptrend",
  trend_down: "in downtrend",
  bullish_trend: "in bullish trend",
  bearish_trend: "in bearish trend",
  pullback: "during pullback",
  reclaim: "on reclaim",
  breakdown: "on breakdown",
  breakout: "on breakout",
  chop: "in chop",
  compression: "in compression",
  mid_range: "mid-range",
};

function toEnumKey(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function toSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function humanizeSlug(value) {
  return toSlug(value)
    .split("_")
    .filter(Boolean)
    .join(" ");
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeSignalInput(input) {
  const normalized = {
    signal: toEnumKey(input?.signal),
    confidence: Number(input?.confidence),
    location: toSlug(input?.location),
    delta: toSlug(input?.delta),
    result: toSlug(input?.result),
    context: toSlug(input?.context),
  };

  if (!ACTION_BY_SIGNAL[normalized.signal]) {
    throw new Error(`Unsupported signal type: ${input?.signal ?? "unknown"}`);
  }

  if (!Number.isFinite(normalized.confidence)) {
    throw new Error("Signal confidence must be a number");
  }

  normalized.confidence = Math.max(0, Math.min(1, normalized.confidence));
  return normalized;
}

function buildReasonParts(signal) {
  const locationLabel = LOCATION_LABELS[signal.location] || humanizeSlug(signal.location);
  const resultLabel = RESULT_LABELS[signal.result] || humanizeSlug(signal.result);
  const contextLabel = CONTEXT_LABELS[signal.context] || humanizeSlug(signal.context);

  if (signal.signal === "TRAP_SHORT") {
    return [
      `buyers trapped ${locationLabel}`.trim(),
      resultLabel,
      contextLabel,
    ];
  }

  if (signal.signal === "TRAP_LONG") {
    return [
      `sellers trapped ${locationLabel}`.trim(),
      resultLabel,
      contextLabel,
    ];
  }

  if (signal.signal === "CONTINUATION_LONG") {
    return [
      `buyers in control ${locationLabel}`.trim(),
      resultLabel,
      contextLabel,
    ];
  }

  if (signal.signal === "CONTINUATION_SHORT") {
    return [
      `sellers in control ${locationLabel}`.trim(),
      resultLabel,
      contextLabel,
    ];
  }

  return [
    `no trade ${locationLabel}`.trim(),
    resultLabel,
    contextLabel,
  ];
}

function sanitizeReason(parts) {
  return compactWhitespace(parts.filter(Boolean).join(", "));
}

function percent(confidence) {
  return Math.round(confidence * 100);
}

function validateFormattedOutput(output, signal, threshold) {
  const text = compactWhitespace(output);
  if (!text) return false;

  if (signal.confidence < threshold) {
    return text === `WAIT ${EM_DASH} low confidence`;
  }

  const allowedAction = ACTION_BY_SIGNAL[signal.signal];
  if (!text.startsWith(`${allowedAction} (`) && !(signal.signal === "NO_TRADE" && text.startsWith("WAIT ("))) {
    return false;
  }

  if (!text.includes(EM_DASH)) return false;
  if (text.includes("\n")) return false;
  return true;
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        parts.push(content.text.trim());
      }
    }
  }

  return compactWhitespace(parts.join(" "));
}

async function callFormatterEndpoint(signal, options = {}) {
  const endpointUrl = compactWhitespace(options.endpointUrl || "");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!endpointUrl || typeof fetchImpl !== "function") {
    throw new Error("Formatter endpoint requires endpointUrl and fetch");
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(new Error("Formatter endpoint timeout")), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(endpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...signal,
        threshold: Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD,
      }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error(`Formatter endpoint failed: ${response.status}`);
    }

    const payload = await response.json();
    return compactWhitespace(payload?.message || payload?.text || "");
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function formatSignalWithoutAI(input, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;
  const signal = normalizeSignalInput(input);

  if (signal.confidence < threshold) {
    return `WAIT ${EM_DASH} low confidence`;
  }

  const action = ACTION_BY_SIGNAL[signal.signal];
  const reason = sanitizeReason(buildReasonParts(signal));
  return `${action} (${percent(signal.confidence)}%) ${EM_DASH} ${reason}`;
}

export function buildAISignalFormatterPrompt(input, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;
  const signal = normalizeSignalInput(input);

  return {
    instructions: [
      "You convert structured trading signals into one short human-readable line.",
      "You never analyze raw market data.",
      "You only translate the structured fields you are given.",
      `Output exactly one line in this format: ACTION (confidence%) ${EM_DASH} reason`,
      `If confidence is below threshold, output exactly: WAIT ${EM_DASH} low confidence`,
      "Allowed actions: TRAP_SHORT=SELL, TRAP_LONG=BUY, CONTINUATION_LONG=BUY, CONTINUATION_SHORT=SELL, NO_TRADE=WAIT",
      "Reason must combine location, result, and context.",
      "Do not add commentary, explanations, paragraphs, or extra lines.",
    ].join(" "),
    input: JSON.stringify({
      threshold,
      signal,
    }),
  };
}

async function callOpenAIForFormatting(signal, options = {}) {
  const apiKey = options.apiKey;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (!apiKey || typeof fetchImpl !== "function") {
    throw new Error("OpenAI formatter requires apiKey and fetch");
  }

  const baseUrl = compactWhitespace(options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = options.model || DEFAULT_MODEL;
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const prompt = buildAISignalFormatterPrompt(signal, options);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(new Error("OpenAI formatter timeout")), timeoutMs)
    : null;

  try {
    const response = await fetchImpl(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        reasoning: { effort: "low" },
        instructions: prompt.instructions,
        input: prompt.input,
        max_output_tokens: 40,
      }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI formatter failed: ${response.status}`);
    }

    const payload = await response.json();
    return extractResponseText(payload);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export async function interpretStructuredSignal(input, options = {}) {
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD;
  const signal = normalizeSignalInput(input);

  if (signal.confidence < threshold) {
    return `WAIT ${EM_DASH} low confidence`;
  }

  if (typeof options.mockResponse === "string") {
    const mockText = compactWhitespace(options.mockResponse);
    return validateFormattedOutput(mockText, signal, threshold)
      ? mockText
      : formatSignalWithoutAI(signal, { threshold });
  }

  if (options.useAI === false) {
    return formatSignalWithoutAI(signal, { threshold });
  }

  if (options.endpointUrl) {
    try {
      const endpointText = await callFormatterEndpoint(signal, {
        ...options,
        threshold,
      });
      if (validateFormattedOutput(endpointText, signal, threshold)) {
        return endpointText;
      }
    } catch {
      // Fallback below keeps the path deterministic and real-time safe.
    }
  }

  try {
    const aiText = await callOpenAIForFormatting(signal, {
      ...options,
      threshold,
    });
    if (validateFormattedOutput(aiText, signal, threshold)) {
      return aiText;
    }
  } catch {
    // Fallback below keeps the path deterministic and real-time safe.
  }

  return formatSignalWithoutAI(signal, { threshold });
}

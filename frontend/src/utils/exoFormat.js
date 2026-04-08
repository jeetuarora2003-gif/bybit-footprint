export function formatPrice(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

const BYBIT_QTY_STEP = 0.001;

function toDisplayLots(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  // Exocharts-style quantity readouts are easier to scan in whole lot units.
  return Math.round(Number(value) / BYBIT_QTY_STEP);
}

function formatWholeNumber(value) {
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: 0,
  });
}

function trimTrailingZeros(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
}

function formatShortNumber(value, digits = 1) {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${trimTrailingZeros(value / 1e12, digits)}T`;
  if (abs >= 1e9) return `${trimTrailingZeros(value / 1e9, digits)}B`;
  if (abs >= 1e6) return `${trimTrailingZeros(value / 1e6, digits)}M`;
  if (abs >= 1e3) return `${trimTrailingZeros(value / 1e3, digits)}k`;
  return trimTrailingZeros(value, Math.min(3, digits));
}

function formatShortWholeNumber(value) {
  return formatShortNumber(value, 1);
}

export function formatOriginalValue(value, digits = 3) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
}

export function formatSignedOriginalValue(value, digits = 3) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const numeric = Number(value);
  const formatted = formatOriginalValue(Math.abs(numeric), digits);
  if (numeric > 0) return `+${formatted}`;
  if (numeric < 0) return `-${formatted}`;
  return "0";
}

export function formatShortOriginalValue(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return formatShortNumber(Number(value), digits);
}

export function formatSignedShortOriginalValue(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const numeric = Number(value);
  const formatted = formatShortOriginalValue(Math.abs(numeric), digits);
  if (numeric > 0) return `+${formatted}`;
  if (numeric < 0) return `-${formatted}`;
  return "0";
}

export function formatCompactValue(value) {
  const lots = toDisplayLots(value);
  if (lots == null) return "-";
  return formatShortWholeNumber(lots);
}

export function formatSignedCompactValue(value) {
  const lots = toDisplayLots(value);
  if (lots == null) return "-";
  const formatted = formatShortWholeNumber(Math.abs(lots));
  if (lots > 0) return `+${formatted}`;
  if (lots < 0) return `-${formatted}`;
  return "0";
}

export function formatFootprintValue(value, options = {}) {
  const lots = toDisplayLots(value) ?? 0;
  if (lots === 0) return "";

  const { signed = false, shortNumbers = false } = options;
  const rendered = shortNumbers
    ? formatShortWholeNumber(Math.abs(lots))
    : formatWholeNumber(Math.abs(lots));

  if (signed && lots > 0) return `+${rendered}`;
  if (lots < 0) return `-${rendered}`;
  return rendered;
}

export function formatRange(low, high, digits = 1) {
  if (low == null || high == null) return "-";
  const range = Number(high) - Number(low);
  return formatPrice(range, digits);
}

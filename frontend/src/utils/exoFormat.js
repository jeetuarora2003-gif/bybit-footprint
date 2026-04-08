export function formatPrice(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCompactValue(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "-";

  const numeric = Number(value);
  const abs = Math.abs(numeric);
  if (abs >= 1e6) return `${(numeric / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(numeric / 1e3).toFixed(abs >= 1e4 ? 1 : 2)}K`;
  if (abs >= 100) return numeric.toFixed(0);
  if (abs >= 1) return numeric.toFixed(digits);
  if (abs >= 0.01) return numeric.toFixed(3);
  if (abs === 0) return "0";
  return numeric.toFixed(4);
}

export function formatSignedCompactValue(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return "-";
  const numeric = Number(value);
  const formatted = formatCompactValue(Math.abs(numeric), digits);
  if (numeric > 0) return `+${formatted}`;
  if (numeric < 0) return `-${formatted}`;
  return "0";
}

export function formatFootprintValue(value, options = {}) {
  const numeric = Number(value) || 0;
  if (Math.abs(numeric) < 0.000001) return "";

  const { signed = false, shortNumbers = false } = options;
  let rendered = "";

  if (shortNumbers) {
    rendered = formatCompactValue(Math.abs(numeric), 2);
    rendered = rendered.replace(/\.0K$/, "K");
  } else {
    const abs = Math.abs(numeric);
    const decimals = abs >= 1000 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 3 : abs >= 0.01 ? 4 : 5;
    rendered = abs.toFixed(decimals);
  }

  rendered = rendered.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");

  if (signed && numeric > 0) return `+${rendered}`;
  if (numeric < 0) return `-${rendered}`;
  return rendered;
}

export function formatRange(low, high, digits = 1) {
  if (low == null || high == null) return "-";
  const range = Number(high) - Number(low);
  return formatPrice(range, digits);
}

// Keep all reported windows in the cache; this preference only controls presentation.
export function visibleWindows(provider, options) {
  return provider.windows.filter(window => provider.id !== "agy"
    || options.agyClaudeGpt !== false
    || !window.id?.startsWith("claude_gpt_"));
}

// Reset times from some providers carry microseconds; QuickJS-style parsers can reject them.
export function parseTime(iso) {
  if (!iso) return Number.NaN;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? Date.parse(String(iso).replace(/(\.\d{3})\d+/, "$1")) : time;
}

// quota-axi leaves durations out of its default JSON; these are the ones the strip already labels (5h, 7d, 30d).
const DEFAULT_WINDOW_SECONDS = { session: 5 * 3600, weekly: 7 * 86400, monthly: 30 * 86400 };

// Share of the window already gone, 0..1: where usage "should" be if spread evenly.
// Null without a future reset time or a known duration (stale data would pin the mark to the end).
export function elapsedShare(window, now) {
  const seconds = window.windowSeconds || DEFAULT_WINDOW_SECONDS[window.kind];
  const reset = parseTime(window.resetsAt);
  if (!seconds || Number.isNaN(reset) || reset <= now) return null;
  return Math.min(1, Math.max(0, 1 - (reset - now) / 1000 / seconds));
}

// Usage colors: calm below 80%, yellow from 80%, red from 90%. Returns 0, 1 or 2.
export function levelIndex(percent) {
  return percent >= 90 ? 2 : percent >= 80 ? 1 : 0;
}

// "1,867 of 10,000 credits": the absolute amount behind a percentage, for providers that meter in units.
export function formatAmount(amount) {
  if (!amount || !Number.isFinite(amount.used) || !Number.isFinite(amount.limit)) return null;
  // No Intl in the mod runtime: group the thousands by hand.
  const number = value => {
    const [whole, fraction] = (Math.round(value * 10) / 10).toFixed(1).split(".");
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction === "0" ? "" : "." + fraction);
  };
  return `${number(amount.used)} of ${number(amount.limit)} ${amount.unit ?? ""}`.trim();
}

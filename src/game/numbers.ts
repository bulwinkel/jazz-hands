/** `value`, held between `low` and `high`. */
export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** `value`, held between 0 and 1. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** `value` rounded to `decimals` places after the point. */
export function roundTo(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** The middle value of `values`: the mean of the two middle values for an even count. 0 for none. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

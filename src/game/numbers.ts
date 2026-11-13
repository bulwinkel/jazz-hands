/** `value`, held between `low` and `high`. */
export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** `value`, held between 0 and 1. */
export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

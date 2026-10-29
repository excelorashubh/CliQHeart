export type DurationUnit = 'seconds' | 'milliseconds';

export function normalizeDurationSeconds(value: unknown, unit: DurationUnit): number | null {
  const numericValue = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  const seconds = unit === 'milliseconds' ? numericValue / 1000 : numericValue;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function isVerifiedDurationSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

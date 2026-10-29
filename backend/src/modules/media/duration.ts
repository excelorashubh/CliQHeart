export type DurationUnit = 'seconds' | 'milliseconds';

export function normalizeDurationSeconds(value: unknown, unit: DurationUnit): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  const seconds = unit === 'milliseconds' ? value / 1000 : value;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function isVerifiedDurationSeconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

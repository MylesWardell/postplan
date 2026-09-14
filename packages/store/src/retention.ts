export function parseRetentionDays(value: string | undefined): number {
  if (value === undefined) {
    return 90;
  }
  const days = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(days) || days > 100_000_000) {
    throw new Error(
      "PLAN_RETENTION_DAYS must be a whole nonnegative number of days; 0 disables expiry.",
    );
  }
  return days;
}
export function expired(lastUploadedAt: number, days: number, now: number): boolean {
  return days > 0 && lastUploadedAt <= Math.floor(now / 1000) - days * 86400;
}

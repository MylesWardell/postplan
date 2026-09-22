const TIME_UNITS: [name: string, seconds: number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Relative time such as "3 days ago". Accepts a Date or an ISO string from JSON. */
export function timeAgo(value: Date | string | null | undefined): string {
  if (!value) {
    return "unknown";
  }
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) {
    return "unknown";
  }

  const seconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  for (const [name, unitSeconds] of TIME_UNITS) {
    const amount = Math.floor(seconds / unitSeconds);
    if (amount >= 1) {
      return `${pluralize(amount, name)} ago`;
    }
  }
  return "just now";
}

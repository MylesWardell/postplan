// Reject invalid measurements, including unexpected successes on denial scenarios.
export function assertStatuses(
  scenario: string,
  statuses: Record<string, number>,
  n: number,
): void {
  const expected: Record<string, number> = {
    upload: 201,
    uploadLarge: 201,
    uploadGzip: 201,
    uploadMalformed: 400,
    uploadMalformedGzip: 400,
    uploadInvalidGzip: 400,
    uploadUnauthorized: 401,
    uploadIpLimited: 429,
    uploadKeyLimited: 429,
  };
  const code = expected[scenario] ?? 200;
  if (Object.keys(statuses).length !== 1 || statuses[String(code)] !== n) {
    throw new Error(
      `${scenario}: expected ${n} responses with status ${code}, received ${JSON.stringify(statuses)}`,
    );
  }
}

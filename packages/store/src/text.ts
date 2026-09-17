export function cleanText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim().slice(0, maxLength) || null;
}

// Mirrors SQLite's instr(lower(...)) search: lower() only folds ASCII letters.
const asciiLower = (value: string) => value.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
export function matchesDraftSearch(
  draft: { title: string; description: string | null; repoName: string | null },
  query: string | undefined,
): boolean {
  return (
    !query ||
    asciiLower(`${draft.title} ${draft.description ?? ""} ${draft.repoName ?? ""}`).includes(
      asciiLower(query),
    )
  );
}

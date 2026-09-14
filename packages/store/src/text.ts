export function cleanText(value: unknown, maxLength = 255): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim().slice(0, maxLength) || null;
}

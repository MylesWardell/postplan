export function isLoginAllowed(
  email: string | null,
  emailVerified: unknown,
  allowedDomains: readonly string[],
): boolean {
  if (allowedDomains.length === 0) {
    return true;
  }
  if (!email || emailVerified !== true) {
    return false;
  }

  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator !== email.indexOf("@") || separator === email.length - 1) {
    return false;
  }
  return allowedDomains.includes(email.slice(separator + 1).toLowerCase());
}

export function isLoginAllowed(
  email: string | null,
  emailVerified: unknown,
  rules: {
    allowedEmails: readonly string[];
    blockedEmails: readonly string[];
    allowedDomains: readonly string[];
  },
): boolean {
  const restricted =
    rules.allowedEmails.length > 0 ||
    rules.blockedEmails.length > 0 ||
    rules.allowedDomains.length > 0;
  if (!restricted) {
    return true;
  }
  if (!email || emailVerified !== true) {
    return false;
  }

  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator !== email.indexOf("@") || separator === email.length - 1) {
    return false;
  }
  const normalizedEmail = email.toLowerCase();
  if (rules.blockedEmails.includes(normalizedEmail)) {
    return false;
  }

  const hasAllowlist = rules.allowedEmails.length > 0 || rules.allowedDomains.length > 0;
  return (
    !hasAllowlist ||
    rules.allowedEmails.includes(normalizedEmail) ||
    rules.allowedDomains.includes(normalizedEmail.slice(separator + 1))
  );
}

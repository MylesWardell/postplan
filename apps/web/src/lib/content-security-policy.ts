export const createNonce = () => crypto.randomUUID().replaceAll("-", "");

export function applyContentSecurityPolicy(response: Response, nonce: string) {
  const { headers } = response;
  if (
    headers.get("content-type")?.includes("text/html") &&
    !headers.has("Content-Security-Policy")
  ) {
    const dev = process.env.NODE_ENV !== "production";
    headers.set(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self'${dev ? " 'unsafe-inline'" : ""}; img-src https: data:; connect-src 'self'${dev ? " ws: wss:" : ""}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    );
  }
  return response;
}

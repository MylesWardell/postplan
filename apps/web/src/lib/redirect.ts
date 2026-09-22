export function redirect(path: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: path });
  for (const cookie of cookies) {
    headers.append("Set-Cookie", cookie);
  }
  return new Response(null, { status: 303, headers });
}

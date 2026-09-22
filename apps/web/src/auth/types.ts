// Decoded HMAC session cookie payload (see web-auth.ts).
export interface Session {
  accountId: string;
  accountName: string;
  email: string | null;
  pictureUrl: string | null;
  exp: number;
}

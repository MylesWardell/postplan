import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { redirect } from "@tanstack/react-router";
import type { Session } from "#auth/types";
import { readSession } from "#auth/session";

export interface AuthState {
  session: Session | null;
}

export const getAuth = createServerFn({ method: "GET" }).handler(() => ({
  session: readSession(getRequest()),
}));

export async function requireAuth({
  context,
  location,
}: {
  context: { auth: AuthState };
  location: { href: string };
}): Promise<{ auth: AuthState }> {
  const { auth } = context;
  if (!auth.session && typeof window !== "undefined") {
    throw redirect({ href: location.href, reloadDocument: true }) as unknown as Error;
  }
  return { auth };
}

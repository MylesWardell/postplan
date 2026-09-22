import type { APIRoute } from "astro";

import { applyContentSecurityPolicy, createNonce } from "#lib/content-security-policy";

export const prerender = false;
// oRPC's Astro integration uses its Fetch adapter in an on-demand API route.
// POST /api/uploads is intercepted by the outer Hono application before Astro.
export const ALL: APIRoute = async ({ request, locals }) =>
  applyContentSecurityPolicy(await locals.api(request, locals.peerIp), createNonce());

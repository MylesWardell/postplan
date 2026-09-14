import { createHash, timingSafeEqual } from "node:crypto";
import { validateHtml } from "@postplan/store/html-policy";
import { signToken, verifyToken } from "../src/auth/session";
import { buildPkce } from "../src/auth/shoo";
import { r2Storage } from "./r2";
import { limiterName } from "./rate-limit";
import { reserveProbe } from "./budget";

const digest = (value: string) => createHash("sha256").update(value).digest();

export function authorizedProbe(request: Request, secret: string | undefined) {
  if (!secret) {
    return false;
  }
  const received = request.headers.get("authorization") ?? "";
  return timingSafeEqual(digest(received), digest(`Bearer ${secret}`));
}

export async function runProbe(env: Cloudflare.Env, html: string) {
  const started = performance.now();
  const policy = validateHtml(html, { maxBytes: 512 * 1024 });
  if (!policy.ok) {
    return Response.json({ ok: false, errors: policy.errors }, { status: 400 });
  }
  if (!(await reserveProbe(env.POSTPLAN_DB))) {
    return Response.json(
      { ok: false, error: "Experiment storage stopped or lifetime budget exhausted" },
      { status: 429 },
    );
  }
  const id = crypto.randomUUID();
  const key = `experiments/${id}.html`;
  const storage = r2Storage(env.HTML_BUCKET);
  const rule = { window: 60_000, maxRequests: 2 };
  const limiter = env.RATE_LIMITS.getByName(limiterName(env.EXPERIMENT_TOKEN, "probe", id, rule));
  try {
    const database = await env.POSTPLAN_DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    await storage.putHtml(key, html);
    const returned = await storage.getHtml(key);
    const first = await limiter.limit(rule);
    const second = await limiter.limit(rule);
    const third = await limiter.limit(rule);
    const token = signToken({ accountId: "experiment" }, env.EXPERIMENT_TOKEN, 60);
    const session = verifyToken(token, env.EXPERIMENT_TOKEN);
    const pkce = buildPkce();
    const ok =
      database?.ok === 1 &&
      returned === html &&
      first.success &&
      second.success &&
      !third.success &&
      session?.accountId === "experiment" &&
      pkce.challenge.length === 43;
    return Response.json({
      ok,
      bytes: new TextEncoder().encode(html).length,
      elapsedMs: performance.now() - started,
      database: database?.ok === 1,
      r2: returned === html,
      limiter: [first.success, second.success, third.success],
      crypto: session?.accountId === "experiment",
      title: policy.title,
    });
  } finally {
    await env.HTML_BUCKET.delete(key);
  }
}

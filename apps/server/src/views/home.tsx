import type { Session } from "../auth/types.js";
import { Layout, page } from "./layout.js";

export function homeResponse(session: Session | null): Response {
  return page(
    <Layout title="Share your next idea" session={session}>
      <section class="hero">
        <p class="eyebrow">From local file to shared idea</p>
        <h1>
          Good work deserves
          <br />a simple link.
        </h1>
        <p>
          Publish an HTML draft from your terminal. Share it with your team, track each version, and
          keep your ideas moving.
        </p>
        <div class="actions">
          <a class="button" href="/dashboard">
            Open your drafts ↗
          </a>
          <a class="button secondary" href="/cli/auth">
            Connect your CLI
          </a>
        </div>
        <div class="hero-terminal">
          <code>$ postplan upload ./plan.html</code>
          <p>One file. One command. Ready to share.</p>
        </div>
      </section>
      <div class="stats">
        <div class="stat">
          <h2>Publish from anywhere</h2>
          <span>Made for your terminal and your agents.</span>
        </div>
        <div class="stat">
          <h2>Keep the whole story</h2>
          <span>Every version, with its git provenance.</span>
        </div>
        <div class="stat">
          <h2>Manage in one place</h2>
          <span>Edit details and control public access.</span>
        </div>
      </div>
    </Layout>,
  );
}
export function signInResponse(next: string): Response {
  return page(
    <Layout title="Sign in">
      <section class="narrow panel pad">
        <p class="eyebrow">Your workspace</p>
        <h1>Pick up where you left off.</h1>
        <p class="muted">
          Sign in to manage your drafts and create API keys for your CLI. Your account uses the
          email and profile you approve with Shoo.
        </p>
        <a class="button" href={`/auth/sign-in?next=${encodeURIComponent(next)}`}>
          Continue with Shoo ↗
        </a>
      </section>
    </Layout>,
  );
}
export function messageResponse(title: string, message: string, status: number): Response {
  return page(
    <Layout title={title}>
      <section class="narrow panel pad">
        <p class="eyebrow">Postplan</p>
        <h1>{title}</h1>
        <p class="muted">{message}</p>
        <a class="button secondary" href="/dashboard">
          Back to drafts
        </a>
      </section>
    </Layout>,
    status,
  );
}
export const notFoundResponse = () =>
  messageResponse(
    "Page not found",
    "This draft or page is unavailable. Check the link or return to your workspace.",
    404,
  );

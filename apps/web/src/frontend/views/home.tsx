import type { Session } from "#auth/types";

import { Layout } from "../layout";
export function HomePage({ session }: { session: Session | null }) {
  return (
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
    </Layout>
  );
}

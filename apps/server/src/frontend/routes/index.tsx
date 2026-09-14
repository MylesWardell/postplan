import { getOnly } from "../methods.js";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Layout } from "../layout.js";

export const Route = createFileRoute("/")({
  server: { middleware: [getOnly] },
  component: HomePage,
});

function HomePage() {
  const { session } = Route.useRouteContext().auth;
  return (
    <Layout title="Share your next idea" session={session}>
      <section className="hero">
        <p className="eyebrow">From local file to shared idea</p>
        <h1>
          Good work deserves
          <br />a simple link.
        </h1>
        <p>
          Publish an HTML draft from your terminal. Share it with your team, track each version, and
          keep your ideas moving.
        </p>
        <div className="actions">
          <Link className="button" to="/dashboard">
            Open your drafts ↗
          </Link>
          <Link className="button secondary" to="/cli/auth">
            Connect your CLI
          </Link>
        </div>
        <div className="hero-terminal">
          <code>$ postplan upload ./plan.html</code>
          <p>One file. One command. Ready to share.</p>
        </div>
      </section>
      <div className="stats">
        <div className="stat">
          <h2>Publish from anywhere</h2>
          <span>Made for your terminal and your agents.</span>
        </div>
        <div className="stat">
          <h2>Keep the whole story</h2>
          <span>Every version, with its git provenance.</span>
        </div>
        <div className="stat">
          <h2>Manage in one place</h2>
          <span>Edit details and control public access.</span>
        </div>
      </div>
    </Layout>
  );
}

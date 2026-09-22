import { Layout } from "../layout";
import { page } from "../response.server";

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

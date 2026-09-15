import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "#frontend/auth";

export const Route = createFileRoute("/dashboard")({
  beforeLoad: requireAuth,
  component: () => <Outlet />,
});

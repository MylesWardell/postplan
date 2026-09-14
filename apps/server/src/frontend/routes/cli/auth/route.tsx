import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "#frontend/auth";

export const Route = createFileRoute("/cli/auth")({
  beforeLoad: requireAuth,
  component: () => <Outlet />,
});

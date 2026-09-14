import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireAuth } from "../../../auth.js";

export const Route = createFileRoute("/cli/auth")({
  beforeLoad: requireAuth,
  component: () => <Outlet />,
});

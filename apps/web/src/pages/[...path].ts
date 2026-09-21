import type { APIRoute } from "astro";
import { frontend } from "../frontend/router";

export const prerender = false;
export const ALL: APIRoute = ({ request, locals }) => frontend.fetch(request, locals);

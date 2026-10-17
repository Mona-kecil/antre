import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => new Response("OK");
export const POST = GET;

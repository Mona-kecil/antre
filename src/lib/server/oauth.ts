import { randomBytes } from "node:crypto";
import { error, type Cookies } from "@sveltejs/kit";
import { z } from "zod";

const pendingSchema = z.object({
  state: z.string().min(1),
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  workspaceId: z.string().min(1),
});
type Binding = { userId?: string; sessionId?: string };
type Channel = "threads" | "linkedin";
const callbackPath = (channel: Channel) =>
  channel === "threads" ? "/auth/callback" : "/auth/linkedin/callback";

export function startConnection(
  cookies: Cookies,
  url: URL,
  locals: Binding,
  workspaceId: string,
  channel: Channel,
) {
  if (!locals.userId || !locals.sessionId)
    error(401, "Sign in before connecting a posting profile.");
  const state = randomBytes(32).toString("base64url");
  cookies.set(
    `${channel}_state`,
    JSON.stringify({
      state,
      userId: locals.userId,
      sessionId: locals.sessionId,
      workspaceId,
    }),
    {
      path: callbackPath(channel),
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: 600,
    },
  );
  return state;
}

export function consumeConnection(
  cookies: Cookies,
  url: URL,
  locals: Binding,
  channel: Channel,
) {
  const stored = cookies.get(`${channel}_state`);
  cookies.delete(`${channel}_state`, { path: callbackPath(channel) });
  let pending: z.infer<typeof pendingSchema>;
  try {
    pending = pendingSchema.parse(JSON.parse(stored ?? "null"));
  } catch {
    error(400, "Connection expired. Start again from Settings.");
  }
  if (
    !locals.userId ||
    !locals.sessionId ||
    pending.userId !== locals.userId ||
    pending.sessionId !== locals.sessionId ||
    pending.state !== url.searchParams.get("state")
  ) {
    error(
      400,
      "Connection did not match this session. Start again from Settings.",
    );
  }
  return pending.workspaceId;
}

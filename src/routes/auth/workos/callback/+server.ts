import { error, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../../../convex/_generated/api";
import { authenticatedConvex } from "#lib/server/convex.ts";
import { authkit, safeReturnPath, setSession } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types";

const transaction = z.object({
  state: z.string().min(1),
  codeVerifier: z.string().min(1),
  returnTo: z.string(),
});

export const GET: RequestHandler = async ({ url, cookies }) => {
  const stored = cookies.get("workos_oauth");
  cookies.delete("workos_oauth", { path: "/auth/workos/callback" });
  let pending: z.infer<typeof transaction>;
  try {
    pending = transaction.parse(JSON.parse(stored ?? "null"));
  } catch {
    error(400, "Login expired. Start again from Login.");
  }
  if (pending.state !== url.searchParams.get("state"))
    error(400, "Login state did not match. Start again from Login.");
  if (url.searchParams.has("error")) redirect(303, "/?login=cancelled");
  const code = url.searchParams.get("code");
  if (!code) error(400, "Login did not return an authorization code.");
  const { workos, clientId, cookiePassword } = authkit();
  let authentication;
  try {
    authentication = await workos.userManagement.authenticateWithCode({
      code,
      codeVerifier: pending.codeVerifier,
      clientId,
      session: { sealSession: true, cookiePassword },
    });
  } catch {
    error(502, "Login could not finish. Start again from Login.");
  }
  if (!authentication.sealedSession)
    error(502, "Login could not create a session. Start again from Login.");
  setSession(cookies, url, authentication.sealedSession);
  const { client } = authenticatedConvex(authentication.accessToken);
  const previous = await client.query(api.workspaces.current, {});
  await client.mutation(api.workspaces.ensure, {});
  redirect(
    303,
    previous ? safeReturnPath(pending.returnTo) : "/app/onboarding",
  );
};

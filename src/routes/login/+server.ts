import { redirect } from "@sveltejs/kit";
import { authkit, safeReturnPath } from "#lib/server/session.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ url, cookies }) => {
  const { workos, clientId, redirectUri } = authkit();
  const authorization = await workos.userManagement.getAuthorizationUrlWithPKCE(
    {
      provider: "authkit",
      clientId,
      redirectUri,
      screenHint:
        url.searchParams.get("screen_hint") === "sign-up" ||
        url.searchParams.get("signup") === "1"
          ? "sign-up"
          : "sign-in",
    },
  );
  cookies.set(
    "workos_oauth",
    JSON.stringify({
      state: authorization.state,
      codeVerifier: authorization.codeVerifier,
      returnTo: safeReturnPath(url.searchParams.get("returnTo")),
    }),
    {
      path: "/auth/workos/callback",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      maxAge: 600,
    },
  );
  redirect(302, authorization.url, { external: ["https://api.workos.com"] });
};

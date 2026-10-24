import { defineEnvVars } from "@sveltejs/kit/env";
import { z } from "zod";

const optional = { schema: z.string().optional() };

export const variables = defineEnvVars({
  CONVEX_URL: { schema: z.url().optional() },
  WORKOS_API_KEY: optional,
  WORKOS_CLIENT_ID: optional,
  WORKOS_COOKIE_PASSWORD: optional,
  WORKOS_REDIRECT_URI: { schema: z.url().optional() },
  THREADS_APP_ID: optional,
  THREADS_APP_SECRET: optional,
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  LINKEDIN_REDIRECT_URI: { schema: z.url().optional() },
});

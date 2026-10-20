import { defineEnvVars } from "@sveltejs/kit/env";
import { z } from "zod";

export const variables = defineEnvVars({
  CONVEX_URL: {},
  ANTRE_SECRET: {},
  SESSION_SECRET: {},
  MCP_TOKEN: {},
  THREADS_APP_ID: { schema: z.string().optional() },
  THREADS_APP_SECRET: { schema: z.string().optional() },
  LINKEDIN_CLIENT_ID: { schema: z.string().optional() },
  LINKEDIN_CLIENT_SECRET: { schema: z.string().optional() },
  LINKEDIN_REDIRECT_URI: { schema: z.url().optional() },
});

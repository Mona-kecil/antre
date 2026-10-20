import { defineEnvVars } from "@sveltejs/kit/env";
import { z } from "zod";

const serverValue = {
  schema: z
    .string()
    .optional()
    .refine(
      (value) => Boolean(value) || process.env.VERCEL_ENV === "preview",
      "Required outside Vercel previews",
    ),
};

export const variables = defineEnvVars({
  CONVEX_URL: serverValue,
  ANTRE_SECRET: serverValue,
  SESSION_SECRET: serverValue,
  MCP_TOKEN: serverValue,
  THREADS_APP_ID: { schema: z.string().optional() },
  THREADS_APP_SECRET: { schema: z.string().optional() },
  LINKEDIN_CLIENT_ID: { schema: z.string().optional() },
  LINKEDIN_CLIENT_SECRET: { schema: z.string().optional() },
  LINKEDIN_REDIRECT_URI: { schema: z.url().optional() },
});

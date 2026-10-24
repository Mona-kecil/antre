import { defineEnvVars } from "@sveltejs/kit/env";
import { z } from "zod";

const optional = { schema: z.string().optional() };
const optionalUrl = {
  schema: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.url().optional(),
  ),
};

export const variables = defineEnvVars({
  CONVEX_URL: optionalUrl,
  WORKOS_API_KEY: optional,
  WORKOS_CLIENT_ID: optional,
  WORKOS_COOKIE_PASSWORD: optional,
  WORKOS_REDIRECT_URI: optionalUrl,
  THREADS_APP_ID: optional,
  THREADS_APP_SECRET: optional,
  LINKEDIN_CLIENT_ID: optional,
  LINKEDIN_CLIENT_SECRET: optional,
  LINKEDIN_REDIRECT_URI: optionalUrl,
});

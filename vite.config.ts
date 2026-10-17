import { defineConfig } from "vitest/config";
import adapter from "@sveltejs/adapter-vercel";
import { sveltekit } from "@sveltejs/kit/vite";

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      // Meta sends form callbacks without an Origin; hooks.server.ts guards other writes.
      csrf: { trustedOrigins: ["*"] },
    }),
  ],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "convex",
          environment: "edge-runtime",
          include: ["convex/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
    ],
    server: { deps: { inline: ["convex-test"] } },
  },
});

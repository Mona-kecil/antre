import { createHash, randomBytes } from "node:crypto";
import { fail, redirect } from "@sveltejs/kit";
import type { Actions } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { owner, reason } from "./owner.ts";
import { sessionCookie } from "./session.ts";

export const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => {
    try {
      if (value !== "UTC" && !value.includes("/")) return false;
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose an IANA time zone, such as Asia/Jakarta or America/New_York.");

export const workspaceActions = {
  timeZone: async ({ request, locals }) => {
    const { client } = await owner(locals.userId);
    const form = await request.formData();
    const parsed = timeZoneSchema.safeParse(form.get("timeZone"));
    if (!parsed.success)
      return fail(400, { error: parsed.error.issues[0].message });
    try {
      await client.mutation(api.workspaces.updateTimeZone, {
        timeZone: parsed.data,
      });
    } catch (cause) {
      return fail(400, {
        error: reason(
          cause,
          "The time zone could not be saved. Refresh and try again.",
        ),
      });
    }
    return {
      message: "Workspace time zone saved. Existing queued times stay fixed.",
    };
  },
  createAgent: async ({ request, locals }) => {
    const { client } = await owner(locals.userId);
    const form = await request.formData();
    const label = z.string().trim().min(1).max(80).safeParse(form.get("label"));
    if (!label.success)
      return fail(400, {
        error: "Give this agent key a name (1–80 characters).",
      });
    const agentToken = `antre_${randomBytes(32).toString("base64url")}`;
    const tokenHash = createHash("sha256").update(agentToken).digest("hex");
    try {
      await client.mutation(api.workspaces.createAgentGrant, {
        label: label.data,
        tokenHash,
      });
    } catch (cause) {
      return fail(400, {
        error: reason(
          cause,
          "The agent key could not be created. Refresh and try again.",
        ),
      });
    }
    return { message: "Agent key created", agentToken };
  },
  revokeAgent: async ({ request, locals }) => {
    const { client } = await owner(locals.userId);
    const form = await request.formData();
    const parsed = z.string().min(1).safeParse(form.get("id"));
    if (!parsed.success)
      return fail(400, { error: "Choose an agent key to revoke." });
    const id = parsed.data as Id<"agentGrants">;
    try {
      await client.mutation(api.workspaces.revokeAgentGrant, { id });
    } catch (cause) {
      return fail(400, {
        error: reason(
          cause,
          "The agent key could not be revoked. Refresh and try again.",
        ),
      });
    }
    return { message: "Agent key revoked" };
  },
  disconnect: async ({ request, locals }) => {
    const { client } = await owner(locals.userId);
    const form = await request.formData();
    const parsed = z
      .enum(["threads", "linkedin"])
      .safeParse(form.get("channel"));
    if (!parsed.success || form.get("confirm") !== "on")
      return fail(400, {
        error:
          "Confirm disconnecting this profile. Queued posts will wait for reconnect.",
      });
    try {
      await client.mutation(api.workspaces.disconnect, {
        channel: parsed.data,
      });
    } catch (cause) {
      return fail(400, {
        error: reason(
          cause,
          "The profile could not be disconnected. Refresh and try again.",
        ),
      });
    }
    return {
      message: "Profile disconnected. Queued posts wait for reconnect.",
    };
  },
  deleteWorkspace: async ({ request, locals, cookies }) => {
    const { client } = await owner(locals.userId);
    const form = await request.formData();
    if (form.get("confirmation") !== "DELETE")
      return fail(400, {
        error: "Type DELETE to confirm deleting your workspace.",
      });
    try {
      await client.mutation(api.workspaces.deleteWorkspace, {});
    } catch (cause) {
      return fail(400, {
        error: reason(
          cause,
          "The workspace could not be deleted. Refresh and try again.",
        ),
      });
    }
    cookies.delete(sessionCookie, { path: "/" });
    redirect(303, "/?workspace=deleted");
  },
} satisfies Actions;

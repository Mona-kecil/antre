import { fail, error } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import { convex } from "#lib/server/convex.ts";
import { wib } from "#lib/time.ts";
import type { Actions, PageServerLoad } from "./$types";
import type { Id } from "../../convex/_generated/dataModel";

const postId = z
  .string()
  .min(1)
  .transform((id) => id as Id<"posts">);
const partsSchema = z
  .array(
    z.object({
      text: z.string(),
      imageId: z
        .string()
        .optional()
        .transform((id) => id as Id<"_storage"> | undefined),
    }),
  )
  .min(1);

export const load: PageServerLoad = async ({ url, locals }) => {
  const { client, secret } = convex();
  const [posts, account] = await Promise.all([
    client.query(api.posts.listQueue, { secret }),
    client.query(api.account.current, { secret }),
  ]);
  if (!account || account.threadsUserId !== locals.userId)
    error(403, "This session does not belong to the owner");
  const edit = posts.find(
    (post) =>
      post._id === url.searchParams.get("edit") && post.status.kind === "draft",
  );
  const groups: { day: string; posts: typeof posts }[] = [];
  for (const post of posts) {
    const day =
      post.status.kind === "draft"
        ? "Drafts"
        : new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Jakarta",
            dateStyle: "full",
          }).format(post.status.at);
    let group = groups.find((group) => group.day === day);
    if (!group) {
      group = { day, posts: [] };
      groups.push(group);
    }
    group.posts.push(post);
  }
  return { account, groups, edit };
};

export const actions: Actions = {
  compose: async ({ request }) => {
    const form = await request.formData();
    const { client, secret } = convex();
    let id: Id<"posts"> | undefined;
    try {
      const parts = partsSchema.parse(JSON.parse(String(form.get("parts"))));
      const mode = z
        .enum(["draft", "queue", "schedule", "now"])
        .parse(form.get("mode"));
      let at: number | undefined;
      if (mode === "schedule") {
        const time = z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .parse(form.get("at"));
        at = Date.parse(`${time}:00+07:00`);
        if (!Number.isFinite(at) || at <= Date.now())
          return fail(400, { error: "Choose a future time in WIB" });
      }
      const existing = form.get("id");
      id = existing
        ? postId.parse(existing)
        : await client.mutation(api.posts.createDraft, {
            secret,
            parts,
            source: "web",
          });
      if (existing)
        await client.mutation(api.posts.updateDraft, { secret, id, parts });
      if (mode === "queue" || mode === "schedule") {
        const queuedAt = await client.mutation(api.posts.queue, {
          secret,
          id,
          ...(at === undefined ? {} : { at }),
        });
        return { message: `Queued for ${wib(queuedAt)}`, saved: true };
      }
      if (mode === "now")
        await client.mutation(api.posts.publishNow, { secret, id });
      return {
        message:
          mode === "now"
            ? "Publishing started. Refresh to see the result."
            : "Draft saved",
        saved: true,
      };
    } catch {
      return fail(400, {
        draftId: id,
        error: id
          ? "Draft saved, but the action failed. Check that the time is free and try again."
          : "Could not save this post. Use 1–500 characters per part.",
      });
    }
  },
  post: async ({ request }) => {
    const form = await request.formData();
    const { client, secret } = convex();
    try {
      const id = postId.parse(form.get("id"));
      switch (form.get("operation")) {
        case "queue":
          await client.mutation(api.posts.queue, { secret, id });
          break;
        case "unqueue":
          await client.mutation(api.posts.unqueue, { secret, id });
          break;
        case "retry":
          await client.mutation(api.posts.retry, { secret, id });
          break;
        case "delete":
          await client.mutation(api.posts.deletePost, { secret, id });
          break;
        default:
          return fail(400, { error: "Unknown post action" });
      }
      return { message: "Post updated" };
    } catch {
      return fail(400, {
        error: "Could not update this post. Refresh and try again.",
      });
    }
  },
};

import { fail } from "@sveltejs/kit";
import { z } from "zod";
import { api } from "../../../convex/_generated/api";
import { convex } from "#lib/server/convex.ts";
import { owner, requireOwner } from "#lib/server/owner.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const { client, secret } = convex();
  const [drafted, unanswered] = await Promise.all([
    client.query(api.replies.list, {
      secret,
      drafted: true,
      unanswered: false,
      limit: 10000,
    }),
    client.query(api.replies.list, { secret, limit: 10000 }),
  ]);
  const account = requireOwner(locals.userId, drafted.account);
  requireOwner(locals.userId, unanswered.account);
  return {
    account,
    syncedAt: unanswered.syncedAt,
    replies: [
      ...drafted.replies,
      ...unanswered.replies.filter((reply) => reply.draft === null),
    ],
  };
};

export const actions: Actions = {
  reply: async ({ request, locals }) => {
    const { client, secret } = await owner(locals.userId);
    const form = await request.formData();
    try {
      const replyId = z.string().min(1).parse(form.get("replyId"));
      switch (form.get("operation")) {
        case "save":
          await client.mutation(api.replies.saveDraft, {
            secret,
            replyId,
            text: z.string().parse(form.get("text")),
          });
          return { message: "Draft saved. Review it before pressing Send." };
        case "send":
          await client.action(api.replies.sendDraft, {
            secret,
            replyId,
            text: z.string().parse(form.get("text")),
          });
          return { message: "Saved draft sent" };
        case "discard":
          await client.mutation(api.replies.discardDraft, { secret, replyId });
          return { message: "Draft discarded" };
        default:
          return fail(400, { error: "Unknown reply action" });
      }
    } catch {
      return fail(400, {
        error:
          "Could not update this reply. Drafts need 1–500 characters. The draft may have changed; refresh and review it again before sending.",
      });
    }
  },
};

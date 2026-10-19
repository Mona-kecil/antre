import { dimensions } from "#lib/labels.ts";

const LIMIT = 20;

/** Filters shared by the Drafts and Library lists: ?topic ?angle ?format ?q ?page. */
export function listParams(url: URL) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "", 10) || 1);
  const text = url.searchParams.get("q")?.trim();
  return {
    filters: {
      ...Object.fromEntries(
        dimensions.flatMap((dimension) => {
          const code = url.searchParams.get(dimension);
          return code ? [[dimension, code]] : [];
        }),
      ),
      ...(text ? { text } : {}),
    } as { topic?: string; angle?: string; format?: string; text?: string },
    offset: (page - 1) * LIMIT,
    limit: LIMIT,
  };
}

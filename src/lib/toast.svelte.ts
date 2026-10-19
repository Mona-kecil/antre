import { deserialize } from "$app/forms";
import { invalidateAll } from "$app/navigation";
import type { SubmitFunction } from "$app/forms";

type Undo = { action: string; fields: Record<string, string> };
type Toast = { id: number; text: string; error: boolean; undo?: Undo };

export const toasts = $state<Toast[]>([]);
let next = 0;

export function toast(text: string, options: { error?: boolean; undo?: Undo } = {}) {
  const item = { id: next++, text, error: options.error ?? false, undo: options.undo };
  toasts.push(item);
  if (toasts.length > 3) toasts.shift();
  setTimeout(() => dismiss(item.id), options.undo ? 6000 : 4000);
}

export function dismiss(id: number) {
  const index = toasts.findIndex((item) => item.id === id);
  if (index >= 0) toasts.splice(index, 1);
}

/** Posts a form action outside a <form>, e.g. a toast's Undo. */
export async function post(action: string, fields: Record<string, string>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  const response = await fetch(action, {
    method: "POST",
    body,
    headers: { "x-sveltekit-action": "true" },
  });
  const result = deserialize(await response.text());
  if (result.type === "success") {
    const message = result.data?.message;
    if (typeof message === "string") toast(message);
  } else if (result.type === "failure") {
    toast(String(result.data?.error ?? "That didn't work. Try again."), { error: true });
  } else if (result.type === "error") {
    toast("That didn't work. Try again.", { error: true });
  }
  await invalidateAll();
  return result;
}

/** use:enhance callback: toast the action's message or error, then refresh data. */
export function act(
  done?: (data: Record<string, unknown> | undefined) => void,
): SubmitFunction {
  return () =>
    async ({ result, update }) => {
      if (result.type === "success") {
        const data = result.data;
        if (typeof data?.message === "string")
          toast(data.message, { undo: data.undo as Undo | undefined });
        done?.(data);
      } else if (result.type === "failure") {
        toast(String(result.data?.error ?? "That didn't work. Try again."), {
          error: true,
        });
      } else if (result.type === "error") {
        toast("Something went wrong. Refresh and try again.", { error: true });
      }
      await update({ reset: false });
    };
}

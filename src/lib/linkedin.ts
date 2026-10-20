import { z } from "zod";

export const MAX_LINKEDIN_TEXT = 3000;
export const linkedinTextSchema = z
  .string()
  .trim()
  .refine(
    (text) => text.length > 0 && [...text].length <= MAX_LINKEDIN_TEXT,
    "Use 1–3000 characters for a LinkedIn post",
  );

export function escapeLinkedInText(text: string) {
  return text.replace(/[|{}@\[\]()<>#\\*_~]/g, "\\$&");
}

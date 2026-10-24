import { z } from "zod";

export const DEFAULT_TOPIC_TAG = "";
export const MAX_TOPIC_TAG_LENGTH = 50;

export const topicTagSchema = z
  .string()
  .trim()
  .refine((tag) => [...tag].length <= MAX_TOPIC_TAG_LENGTH, {
    message: "Use up to 50 characters for the Threads topic.",
  })
  .refine((tag) => !/[.&]/.test(tag), {
    message: "Remove periods and ampersands from the Threads topic.",
  });

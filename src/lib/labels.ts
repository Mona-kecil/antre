export type Dimension = "topic" | "angle" | "format";
export type TaxonomyEntry = {
  dimension: Dimension;
  code: string;
  name: string;
  description?: string;
};
export type Meta = {
  topic?: string;
  angle?: string;
  format?: string;
  hook?: string;
  notes?: string;
};

export const dimensions: Dimension[] = ["topic", "angle", "format"];

// Linear's label hues, ordered so neighbouring topic codes contrast.
const hues = [
  "#5e6ad2",
  "#26b5ce",
  "#4cb782",
  "#f2994a",
  "#eb5757",
  "#bb87fc",
  "#e2b203",
  "#0f8b8d",
  "#e255a1",
  "#2f80ed",
  "#8a6b3f",
  "#6fcf97",
  "#d4703c",
  "#9b51e0",
  "#56ccf2",
  "#b8455c",
  "#7d8a99",
];

export function topicColor(code: string | undefined, taxonomy: TaxonomyEntry[]) {
  if (!code) return "var(--fg-3)";
  const topics = taxonomy
    .filter((entry) => entry.dimension === "topic")
    .map((entry) => entry.code);
  let index = topics.indexOf(code);
  if (index < 0)
    index = [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return hues[index % hues.length];
}

export function nameOf(
  dimension: Dimension,
  code: string,
  taxonomy: TaxonomyEntry[],
) {
  return (
    taxonomy.find(
      (entry) => entry.dimension === dimension && entry.code === code,
    )?.name ?? code
  );
}

/** Notes such as "IMAGE NEEDED" on a post with no image yet. */
export function needsImage(
  meta: Meta,
  parts: { imageId?: string; imageUrl?: string | null }[],
) {
  return (
    /image needed/i.test(meta.notes ?? "") &&
    !parts.some((part) => part.imageId || part.imageUrl)
  );
}

export type WeekKind = "queued" | "publishing" | "held" | "failed" | "published";
export type WeekMark = {
  id: string;
  at: number;
  kind: WeekKind;
  pinned: boolean;
  topic: string | null;
  text: string;
};
export type Week = {
  channel: "threads" | "linkedin";
  from: number;
  day: number;
  today: number;
  nextSlot: number | null;
  settings: {
    windows: { start: string; end: string }[];
    intervalMinutes: number;
    timeZone: string;
  };
  marks: WeekMark[];
};

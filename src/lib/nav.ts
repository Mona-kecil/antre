import type { IconName } from "#lib/components/Icon.svelte";

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  badge?: "drafts" | "replies";
};

const threads: NavItem[] = [
  { href: "/app", label: "Drafts", icon: "drafts", badge: "drafts" },
  { href: "/app/schedule", label: "Schedule", icon: "schedule" },
  { href: "/app/compose", label: "New", icon: "plus" },
  { href: "/app/replies", label: "Replies", icon: "replies", badge: "replies" },
  { href: "/app/library", label: "Library", icon: "library" },
];

const linkedin: NavItem[] = [
  { href: "/app/linkedin", label: "Drafts", icon: "drafts", badge: "drafts" },
  { href: "/app/linkedin?view=scheduled", label: "Schedule", icon: "schedule" },
  { href: "/app/linkedin/compose", label: "New", icon: "plus" },
  { href: "/app/linkedin?view=published", label: "Library", icon: "library" },
];

type Place = {
  pathname: string;
  href: string;
  searchParams: { get(name: string): string | null };
};

export const isLinkedIn = (url: Place) => url.pathname.startsWith("/app/linkedin");
export const navItems = (url: Place) => (isLinkedIn(url) ? linkedin : threads);

export function isCurrent(url: Place | undefined, href: string) {
  if (!url) return false;
  if (!isLinkedIn(url))
    return href === "/app" ? url.pathname === "/app" : url.pathname.startsWith(href);
  const target = new URL(href, url.href);
  const view = url.searchParams.get("view");
  const section = view === "scheduled" || view === "published" ? view : "drafts";
  return (
    url.pathname === target.pathname &&
    section === (target.searchParams.get("view") ?? "drafts")
  );
}

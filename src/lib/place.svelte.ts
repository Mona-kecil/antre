import { getContext, setContext } from "svelte";
import { page } from "$app/state";

/** Where the app shell is. The public home renders the shell over a sample workspace with its own URL. */
export type Place = {
  readonly url: typeof page.url;
  readonly badges: Record<string, number>;
};

const key = Symbol("place");

export const providePlace = (place: Place) => setContext(key, place);

const current: Place = {
  get url() {
    return page.url;
  },
  get badges() {
    return (page.data.badges ?? {}) as Record<string, number>;
  },
};

export const usePlace = () => getContext<Place | undefined>(key) ?? current;

/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as account from "../account.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as images from "../images.js";
import type * as lib_media from "../lib/media.js";
import type * as lib_postStore from "../lib/postStore.js";
import type * as lib_scheduling from "../lib/scheduling.js";
import type * as library from "../library.js";
import type * as linkedin from "../linkedin.js";
import type * as maintenance from "../maintenance.js";
import type * as ownership from "../ownership.js";
import type * as posts from "../posts.js";
import type * as publishing from "../publishing.js";
import type * as replies from "../replies.js";
import type * as scoped from "../scoped.js";
import type * as sync from "../sync.js";
import type * as testing_storage from "../testing/storage.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  account: typeof account;
  auth: typeof auth;
  crons: typeof crons;
  http: typeof http;
  images: typeof images;
  "lib/media": typeof lib_media;
  "lib/postStore": typeof lib_postStore;
  "lib/scheduling": typeof lib_scheduling;
  library: typeof library;
  linkedin: typeof linkedin;
  maintenance: typeof maintenance;
  ownership: typeof ownership;
  posts: typeof posts;
  publishing: typeof publishing;
  replies: typeof replies;
  scoped: typeof scoped;
  sync: typeof sync;
  "testing/storage": typeof testing_storage;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

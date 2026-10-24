import {
  workspaceTest,
  workosOwner,
  storeOwnedImage,
} from "#lib/server/testing.ts";
import { expect, test, vi } from "vitest";
import schema from "../../../convex/schema";
import { MAX_IMAGE_BYTES } from "../../../convex/lib/media";
import { POST } from "./+server";

const bridge = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }));
vi.mock("#lib/server/convex.ts", () => ({
  convex: () => ({ client: bridge, secret: undefined }),
}));
const modules = import.meta.glob([
  "../../../convex/**/*.ts",
  "!../../../convex/**/*.test.ts",
]);

test("web uploads accept JPEG/PNG and reject WebP, SVG, empty images, and images over 8 MB", async () => {
  const { t, other, workspaceId } = await workspaceTest(modules);
  bridge.query.mockImplementation(t.query);
  bridge.mutation.mockImplementation(t.mutation);
  const upload = vi.fn(async (_url: string, init: RequestInit) => {
    if (!(init.body instanceof Blob)) throw new Error("Expected image blob");
    const image = init.body;
    return Response.json({
      storageId: await t.run((ctx) => storeOwnedImage(ctx, workspaceId, image)),
    });
  });
  const send = (type: string, bytes: Uint8Array<ArrayBuffer>) =>
    POST({
      locals: { userId: workosOwner },
      request: new Request("https://antre.example/upload", {
        method: "POST",
        headers: { "Content-Type": type },
        body: bytes,
      }),
      fetch: upload,
    } as unknown as Parameters<typeof POST>[0]);
  try {
    for (const type of ["image/png", "image/jpeg"]) {
      const response = await send(type, new Uint8Array([1, 2, 3]));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ storageId: expect.any(String) });
    }
    for (const [type, bytes] of [
      ["image/webp", new Uint8Array([1])],
      ["image/svg+xml", new Uint8Array([1])],
      ["image/png", new Uint8Array()],
      ["image/png", new Uint8Array(MAX_IMAGE_BYTES + 1)],
    ] as const)
      await expect(send(type, bytes)).rejects.toMatchObject({ status: 400 });
    expect(upload).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  }
});

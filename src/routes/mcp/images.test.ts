import { EventEmitter } from "node:events";
import { IncomingMessage, type RequestOptions } from "node:http";
import { Socket } from "node:net";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "../../../convex/lib/media";
import { downloadImage } from "./images";

const network = vi.hoisted(() => ({ request: vi.fn(), lookup: vi.fn() }));
vi.mock("node:http", async (original) => ({
  ...(await original<typeof import("node:http")>()),
  request: network.request,
}));
vi.mock("node:https", () => ({ request: network.request }));
vi.mock("node:dns/promises", () => ({ lookup: network.lookup }));

const responses = new Map<
  string,
  {
    status?: number;
    headers?: IncomingMessage["headers"];
    chunks?: Buffer[];
  }
>();

beforeEach(() => {
  network.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  network.request.mockImplementation(
    (
      url: URL,
      options: RequestOptions,
      receive: (message: IncomingMessage) => void,
    ) => {
      const req = new EventEmitter();
      const end = async () => {
        try {
          await new Promise<void>((resolve, reject) => {
            if (!options.lookup) throw new Error("Expected pinned DNS lookup");
            options.lookup(url.hostname, { all: true }, (error, addresses) => {
              if (error) reject(error);
              else {
                expect(addresses).toEqual([
                  { address: "93.184.216.34", family: 4 },
                ]);
                resolve();
              }
            });
          });
          const route = responses.get(url.pathname);
          if (!route) throw new Error("Unexpected image request");
          const message = new IncomingMessage(new Socket());
          message.statusCode = route.status ?? 200;
          message.headers = route.headers ?? { "content-type": "image/png" };
          receive(message);
          for (const chunk of route.chunks ?? []) message.push(chunk);
          message.push(null);
        } catch (error) {
          req.emit("error", error);
        }
      };
      return Object.assign(req, { end });
    },
  );
});

afterEach(() => {
  responses.clear();
  vi.resetAllMocks();
});

test("URL downloads follow public redirects with one deadline, preserve image bytes, and reject private DNS or redirect targets", async () => {
  responses.set("/start", { status: 302, headers: { location: "/image" } });
  responses.set("/image", {
    headers: { "content-type": "image/png; charset=binary" },
    chunks: [Buffer.from("PNG")],
  });
  const image = await downloadImage("https://images.example/start");
  expect(image.type).toBe("image/png");
  expect(await image.text()).toBe("PNG");
  expect(network.lookup).toHaveBeenCalledTimes(2);
  const firstOptions: RequestOptions = network.request.mock.calls[0][1];
  const secondOptions: RequestOptions = network.request.mock.calls[1][1];
  expect(firstOptions.signal).toBeInstanceOf(AbortSignal);
  expect(secondOptions.signal).toBe(firstOptions.signal);

  responses.set("/private", {
    status: 302,
    headers: { location: "http://127.0.0.1/image" },
  });
  await expect(downloadImage("https://images.example/private")).rejects.toThrow(
    "public address",
  );
  network.lookup.mockResolvedValue([{ address: "10.1.2.3", family: 4 }]);
  await expect(downloadImage("https://private.example/image")).rejects.toThrow(
    "public address",
  );
  network.lookup.mockResolvedValue([
    { address: "::ffff:127.0.0.1", family: 6 },
  ]);
  await expect(downloadImage("https://mapped.example/image")).rejects.toThrow(
    "public address",
  );
});

test("URL downloads reject bad media, declared or streamed oversize bodies, failed responses, and redirect loops", async () => {
  responses.set("/type", {
    headers: { "content-type": "image/webp" },
    chunks: [Buffer.from("webp")],
  });
  responses.set("/declared", {
    headers: {
      "content-type": "image/png",
      "content-length": String(MAX_IMAGE_BYTES + 1),
    },
  });
  responses.set("/streamed", {
    chunks: [Buffer.alloc(MAX_IMAGE_BYTES), Buffer.from("x")],
  });
  responses.set("/empty", {});
  responses.set("/failure", { status: 404 });
  responses.set("/loop", { status: 302, headers: { location: "/loop" } });
  for (const [path, message] of [
    ["type", "JPEG or PNG"],
    ["declared", "8 MB"],
    ["streamed", "8 MB"],
    ["empty", "1 byte"],
    ["failure", "download failed"],
    ["loop", "redirects"],
  ])
    await expect(
      downloadImage(`https://images.example/${path}`),
    ).rejects.toThrow(message);
});

import { createHmac } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import { POST as uninstall } from "./uninstall/+server";
import { POST as erase, GET as status } from "./delete/+server";
vi.mock("$app/env/private", () => ({
  THREADS_APP_SECRET: "test_provider_secret",
  CONVEX_URL: "https://provider-test.convex.cloud",
}));
afterEach(() => vi.unstubAllGlobals());
function signed(payload: unknown) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${createHmac("sha256", "test_provider_secret").update(body).digest("base64url")}.${body}`;
}
const proof = () =>
  signed({
    algorithm: "HMAC-SHA256",
    user_id: "threads_profile",
    issued_at: Math.floor(Date.now() / 1000),
  });
const event = (value: string) =>
  ({
    url: new URL("https://antre.example/auth/delete"),
    request: new Request("https://antre.example/auth/delete", {
      method: "POST",
      body: new URLSearchParams({ signed_request: value }),
    }),
  }) as never;

test.each([
  "",
  "invalid.signature",
  signed({ algorithm: "none", user_id: "profile", issued_at: 0 }),
  signed({ algorithm: "HMAC-SHA256", user_id: "", issued_at: 0 }),
])(
  "provider callbacks reject invalid signed requests before backend writes",
  async (value) => {
    const network = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", network);
    await expect(uninstall(event(value))).rejects.toMatchObject({
      status: 400,
    });
    expect(network).not.toHaveBeenCalled();
  },
);

test("uninstall forwards the original signed proof for independent backend verification without browser or agent authority", async () => {
  const network = vi.fn<typeof fetch>(async () =>
    Response.json({ status: "success", value: null, logLines: [] }),
  );
  vi.stubGlobal("fetch", network);
  const signedRequest = proof();
  expect((await uninstall(event(signedRequest))).status).toBe(200);
  expect(
    new Headers(network.mock.calls[0][1]?.headers).has("authorization"),
  ).toBe(false);
  const body = String(network.mock.calls[0][1]?.body);
  expect(body).toContain(signedRequest);
  expect(body).toContain("uninstall");
});

test("deletion returns a backend confirmation and a status URL without exposing the profile ID", async () => {
  const code = "c".repeat(43);
  const network = vi.fn<typeof fetch>(async () =>
    Response.json({
      status: "success",
      value: { confirmationCode: code },
      logLines: [],
    }),
  );
  vi.stubGlobal("fetch", network);
  const response = await erase(event(proof()));
  expect(await response.json()).toEqual({
    confirmation_code: code,
    url: `https://antre.example/auth/delete?code=${code}`,
  });
  network.mockResolvedValueOnce(
    Response.json({
      status: "success",
      value: { status: "complete" },
      logLines: [],
    }),
  );
  const receipt = await status({
    url: new URL(`https://antre.example/auth/delete?code=${code}`),
  } as never);
  expect(await receipt.text()).toContain("has been deleted");
});

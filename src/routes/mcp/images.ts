import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { MAX_IMAGE_BYTES, validateImage } from "../../../convex/lib/media";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] satisfies [string, number][])
  blocked.addSubnet(address, prefix);
blocked.addSubnet("2001::", 23, "ipv6");
blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");

function requirePublicAddress(address: string) {
  const family = isIP(address);
  if (
    family === 0 ||
    (family === 4 && blocked.check(address, "ipv4")) ||
    (family === 6 &&
      (!globalV6.check(address, "ipv6") || blocked.check(address, "ipv6")))
  )
    throw new Error("Image URL must resolve to a public address");
}

export function decodeImage(base64: string, contentType: string) {
  if (base64.length > MAX_IMAGE_BASE64_LENGTH)
    throw new Error("Images must be between 1 byte and 8 MB");
  if (base64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(base64))
    throw new Error("Use raw, padded base64 without a data URL prefix");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64)
    throw new Error("Use raw, padded base64 without a data URL prefix");
  validateImage({ contentType, size: bytes.length });
  return new Blob([bytes], { type: contentType });
}

export async function downloadImage(value: string) {
  // One deadline covers DNS, redirects, and the entire response body.
  const signal = AbortSignal.timeout(10_000);
  let url = new URL(value);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error("Use a public HTTP(S) image URL without credentials");
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname)) requirePublicAddress(hostname);
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const response = await new Promise<import("node:http").IncomingMessage>(
      (resolve, reject) => {
        const req = request(
          url,
          {
            signal,
            headers: { Accept: "image/jpeg, image/png" },
            // Pin the checked DNS result so a second lookup cannot reach a private IP.
            lookup(host, options, callback) {
              void lookup(host, { all: true }).then(
                (addresses) => {
                  try {
                    for (const { address } of addresses)
                      requirePublicAddress(address);
                    const first = addresses[0];
                    if (!first) throw new Error("Image URL has no address");
                    if (options.all) callback(null, [first]);
                    else callback(null, first.address, first.family);
                  } catch (error) {
                    callback(
                      error instanceof Error
                        ? error
                        : new Error("Invalid image address"),
                      "",
                      4,
                    );
                  }
                },
                () => callback(new Error("Could not resolve image URL"), "", 4),
              );
            },
          },
          resolve,
        );
        req.on("error", reject);
        req.end();
      },
    );
    try {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        const location = response.headers.location;
        if (!location || redirects === 3)
          throw new Error("Too many image URL redirects");
        url = new URL(location, url);
        continue;
      }
      if (status < 200 || status >= 300)
        throw new Error("Image download failed");
      const contentType = response.headers["content-type"]
        ?.split(";")[0]
        .trim()
        .toLowerCase();
      const declaredSize = Number(response.headers["content-length"] ?? 1);
      validateImage({ contentType, size: declaredSize });
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        validateImage({ contentType, size });
        chunks.push(bytes);
      }
      validateImage({ contentType, size });
      return new Blob([Buffer.concat(chunks)], { type: contentType });
    } finally {
      response.destroy();
    }
  }
  throw new Error("Too many image URL redirects");
}

export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

import { describe, it, expect, vi } from "vitest";
import { resolveImageUrl } from "../utils/imageResolver.js";

describe("resolveImageUrl", () => {
  it("returns empty string for empty input", async () => {
    expect(await resolveImageUrl("")).toBe("");
    expect(await resolveImageUrl("  ")).toBe("");
  });

  it("returns HTTP(S) URLs as-is", async () => {
    const url = "https://example.com/image.png";
    expect(await resolveImageUrl(url)).toBe(url);
  });

  it("returns HTTP URLs as-is", async () => {
    const url = "http://example.com/image.png";
    expect(await resolveImageUrl(url)).toBe(url);
  });

  it("converts ipfs:// protocol to gateway URL", async () => {
    const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

    // Mock fetch to simulate gateway response
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const result = await resolveImageUrl(`ipfs://${cid}`);
    expect(result).toContain(cid);
    expect(result).toMatch(/^https:\/\//);

    fetchSpy.mockRestore();
  });

  it("resolves bare IPFS CIDs", async () => {
    const cid = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const result = await resolveImageUrl(cid);
    expect(result).toContain(cid);

    fetchSpy.mockRestore();
  });

  it("returns unknown formats as-is", async () => {
    expect(await resolveImageUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
  });
});

import { describe, it, expect } from "vitest";
import { NETWORK_REGISTRY, getNetworkConfig } from "../provider.js";

describe("NETWORK_REGISTRY", () => {
  it("has preview config", () => {
    const cfg = NETWORK_REGISTRY.preview;
    expect(cfg.indexerUrl).toContain("preview.midnight.network");
    expect(cfg.indexerWsUrl).toContain("wss://");
    expect(cfg.tldAddress).toBeTruthy();
  });

  it("has preprod config", () => {
    const cfg = NETWORK_REGISTRY.preprod;
    expect(cfg.indexerUrl).toContain("preprod.midnight.network");
    expect(cfg.tldAddress).toBeTruthy();
  });

  it("has mainnet config", () => {
    const cfg = NETWORK_REGISTRY.mainnet;
    expect(cfg.indexerUrl).toContain("mainnet.midnight.network");
    expect(cfg.indexerWsUrl).toContain("wss://");
    expect(cfg.tldAddress).toBeTruthy();
  });
});

describe("getNetworkConfig", () => {
  it("returns config for known network", () => {
    const cfg = getNetworkConfig("mainnet");
    expect(cfg).toBe(NETWORK_REGISTRY.mainnet);
  });

  it("throws for unknown network", () => {
    expect(() => getNetworkConfig("foonet")).toThrow(/Unknown network/);
  });
});

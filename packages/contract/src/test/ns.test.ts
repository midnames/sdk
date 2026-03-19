import { NSSimulator } from "./ns-simulator.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";

setNetworkId("undeployed");

function paddedKey(dataBytes: number[]): Uint8Array {
  const key = new Uint8Array(32).fill(255);
  for (let i = 0; i < dataBytes.length; i++) key[i] = dataBytes[i];
  return key;
}

function stringToKey(s: string): Uint8Array {
  const bytes = Array.from(new TextEncoder().encode(s));
  return paddedKey(bytes);
}

const dummyOwner = { bytes: new Uint8Array(32) };
const dummyResolver = { bytes: new Uint8Array(32) };

describe("Leaf contract", () => {
  it("generates initial ledger state deterministically", () => {
    const simulator0 = new NSSimulator();
    const simulator1 = new NSSimulator();
    const l0 = simulator0.getLedger();
    const l1 = simulator1.getLedger();
    expect(l0.COST_SHORT).toEqual(l1.COST_SHORT);
    expect(l0.COIN_COLOR).toEqual(l1.COIN_COLOR);
    expect(l0.DOMAIN_OWNER).toEqual(l1.DOMAIN_OWNER);
    expect(l0.PARENT_DOMAIN).toEqual(l1.PARENT_DOMAIN);
    expect(l0.DOMAIN).toEqual(l1.DOMAIN);
    expect(l0.domains.isEmpty()).toEqual(l1.domains.isEmpty());
  });

  it("properly initializes ledger state", () => {
    const simulator = new NSSimulator();
    const ledger = simulator.getLedger();
    expect(ledger.COST_SHORT).toEqual(100n);
    expect(ledger.domains.isEmpty()).toBe(true);
  });
});

describe("buy_domain_for — validation", () => {
  it("accepts a valid domain purchase with proper padding", () => {
    const simulator = new NSSimulator();
    // "alice" = [0x61, 0x6c, 0x69, 0x63, 0x65]
    const key = stringToKey("alice");
    expect(() => simulator.buyDomainFor(dummyOwner, key, 5n, dummyResolver)).not.toThrow();
  });

  it("accepts len=1 (short premium name)", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x41]);
    expect(() => simulator.buyDomainFor(dummyOwner, key, 1n, dummyResolver)).not.toThrow();
  });

  it("accepts len=32 (max length domain)", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(0x41);
    expect(() => simulator.buyDomainFor(dummyOwner, key, 32n, dummyResolver)).not.toThrow();
  });

  it("rejects non-255 byte in padding region", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x41, 0x42]);
    key[2] = 0x43; // should be 255
    expect(() => simulator.buyDomainFor(dummyOwner, key, 2n, dummyResolver)).toThrow();
  });

  it("rejects len > 32", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(0x41);
    expect(() => simulator.buyDomainFor(dummyOwner, key, 33n, dummyResolver)).toThrow();
  });

  it("rejects len = 0 (empty name)", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(255);
    expect(() => simulator.buyDomainFor(dummyOwner, key, 0n, dummyResolver)).toThrow();
  });

  it("rejects duplicate domain purchase", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    simulator.buyDomainFor(dummyOwner, key, 5n, dummyResolver);
    expect(() => simulator.buyDomainFor(dummyOwner, key, 5n, dummyResolver)).toThrow();
  });

  it("stores domain data correctly after purchase", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("bob");
    const ledger = simulator.buyDomainFor(dummyOwner, key, 3n, dummyResolver);
    expect(ledger.domains.member(key)).toBe(true);
    const data = ledger.domains.lookup(key);
    expect(data.owner).toEqual(dummyOwner);
    expect(data.resolver).toEqual(dummyResolver);
  });

  it("converts string to properly padded Bytes<32>", () => {
    const key = stringToKey("alice");
    // "alice" = [0x61, 0x6c, 0x69, 0x63, 0x65]
    expect(key[0]).toBe(0x61);
    expect(key[1]).toBe(0x6c);
    expect(key[2]).toBe(0x69);
    expect(key[3]).toBe(0x63);
    expect(key[4]).toBe(0x65);
    for (let i = 5; i < 32; i++) {
      expect(key[i]).toBe(255);
    }
  });
});

describe("register_domain_for — validation", () => {
  it("accepts a valid domain registration with proper padding", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("test");
    expect(() => simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver)).not.toThrow();
  });

  it("rejects invalid padding", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x41, 0x42]);
    key[2] = 0x00; // should be 255
    expect(() => simulator.registerDomainFor(dummyOwner, key, 2n, dummyResolver)).toThrow();
  });

  it("rejects empty name (len=0)", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(255);
    expect(() => simulator.registerDomainFor(dummyOwner, key, 0n, dummyResolver)).toThrow();
  });
});

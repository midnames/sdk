import { NSSimulator, computeCommitment } from "./ns-simulator.js";
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
const defaultRand = 42n;

function buyWithCommit(
  sim: NSSimulator,
  owner: { bytes: Uint8Array },
  key: Uint8Array,
  len: bigint,
  resolver: { bytes: Uint8Array },
  rand = defaultRand
) {
  sim.commitDomain(computeCommitment(key, owner, rand));
  return sim.buyDomainFor(owner, key, len, resolver, rand);
}

// ===========================================
//            Initialization
// ===========================================

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
    expect(ledger.COST_MED).toEqual(50n);
    expect(ledger.COST_LONG).toEqual(10n);
    expect(ledger.BUY_ENABLED).toBe(true);
    expect(ledger.domains.isEmpty()).toBe(true);
    expect(ledger.fields.isEmpty()).toBe(true);
    expect(ledger.commitments.isEmpty()).toBe(true);
  });
});

// ===========================================
//      buy_domain_for — basic validation
// ===========================================

describe("buy_domain_for — validation", () => {
  it("accepts a valid domain purchase with proper padding", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    expect(() => buyWithCommit(simulator, dummyOwner, key, 5n, dummyResolver)).not.toThrow();
  });

  it("accepts len=1 (short premium name)", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x61]); // 'a'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 1n, dummyResolver)).not.toThrow();
  });

  it("accepts len=32 (max length domain)", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(0x61); // all 'a'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 32n, dummyResolver)).not.toThrow();
  });

  it("rejects non-255 byte in padding region", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x61, 0x62]); // 'a', 'b'
    key[2] = 0x63; // should be 255
    expect(() => buyWithCommit(simulator, dummyOwner, key, 2n, dummyResolver)).toThrow();
  });

  it("rejects len > 32", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(0x61);
    expect(() => buyWithCommit(simulator, dummyOwner, key, 33n, dummyResolver)).toThrow();
  });

  it("rejects len = 0 (empty name)", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(255);
    expect(() => buyWithCommit(simulator, dummyOwner, key, 0n, dummyResolver)).toThrow();
  });

  it("rejects duplicate domain purchase", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    buyWithCommit(simulator, dummyOwner, key, 5n, dummyResolver, 1n);
    expect(() => buyWithCommit(simulator, dummyOwner, key, 5n, dummyResolver, 2n)).toThrow();
  });

  it("stores domain data correctly after purchase", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("bob");
    const ledger = buyWithCommit(simulator, dummyOwner, key, 3n, dummyResolver);
    expect(ledger.domains.member(key)).toBe(true);
    const data = ledger.domains.lookup(key);
    expect(data.owner).toEqual(dummyOwner);
    expect(data.resolver).toEqual(dummyResolver);
  });

  it("converts string to properly padded Bytes<32>", () => {
    const key = stringToKey("alice");
    expect(key[0]).toBe(0x61); // 'a'
    expect(key[1]).toBe(0x6c); // 'l'
    expect(key[2]).toBe(0x69); // 'i'
    expect(key[3]).toBe(0x63); // 'c'
    expect(key[4]).toBe(0x65); // 'e'
    for (let i = 5; i < 32; i++) {
      expect(key[i]).toBe(255);
    }
  });
});

// ===========================================
//     register_domain_for — validation
// ===========================================

describe("register_domain_for — validation", () => {
  it("accepts a valid domain registration with proper padding", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("test");
    expect(() => simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver)).not.toThrow();
  });

  it("rejects invalid padding", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x61, 0x62]); // 'a', 'b'
    key[2] = 0x00; // should be 255
    expect(() => simulator.registerDomainFor(dummyOwner, key, 2n, dummyResolver)).toThrow();
  });

  it("rejects empty name (len=0)", () => {
    const simulator = new NSSimulator();
    const key = new Uint8Array(32).fill(255);
    expect(() => simulator.registerDomainFor(dummyOwner, key, 0n, dummyResolver)).toThrow();
  });

  it("stores domain data correctly after registration", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("test");
    const ledger = simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver);
    expect(ledger.domains.member(key)).toBe(true);
    const data = ledger.domains.lookup(key);
    expect(data.owner).toEqual(dummyOwner);
    expect(data.resolver).toEqual(dummyResolver);
  });

  it("rejects duplicate registration", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("test");
    simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver);
    expect(() => simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver)).toThrow();
  });
});

// ===========================================
//  Character validation — buy_domain_for
// ===========================================

describe("buy_domain_for — character validation", () => {
  it("accepts lowercase a-z", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("abcxyz");
    expect(() => buyWithCommit(simulator, dummyOwner, key, 6n, dummyResolver)).not.toThrow();
  });

  it("accepts digits 0-9", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("123");
    expect(() => buyWithCommit(simulator, dummyOwner, key, 3n, dummyResolver)).not.toThrow();
  });

  it("accepts hyphen in middle", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("my-name");
    expect(() => buyWithCommit(simulator, dummyOwner, key, 7n, dummyResolver)).not.toThrow();
  });

  it("accepts mixed valid characters", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("a1-b2-c3");
    expect(() => buyWithCommit(simulator, dummyOwner, key, 8n, dummyResolver)).not.toThrow();
  });

  it("rejects uppercase letters", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x41]); // 'A'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 1n, dummyResolver)).toThrow();
  });

  it("rejects leading hyphen", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x2d, 0x61]); // '-a'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 2n, dummyResolver)).toThrow();
  });

  it("rejects trailing hyphen", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x61, 0x2d]); // 'a-'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 2n, dummyResolver)).toThrow();
  });

  it("rejects single hyphen", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x2d]); // '-'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 1n, dummyResolver)).toThrow();
  });

  it("rejects special characters", () => {
    const simulator = new NSSimulator();
    expect(() => buyWithCommit(simulator, dummyOwner, paddedKey([0x21]), 1n, dummyResolver)).toThrow(); // '!'
    const sim2 = new NSSimulator();
    expect(() => buyWithCommit(sim2, dummyOwner, paddedKey([0x40]), 1n, dummyResolver)).toThrow(); // '@'
  });

  it("rejects space character", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x20]); // space
    expect(() => buyWithCommit(simulator, dummyOwner, key, 1n, dummyResolver)).toThrow();
  });

  it("rejects null byte", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x00]); // null
    expect(() => buyWithCommit(simulator, dummyOwner, key, 1n, dummyResolver)).toThrow();
  });

  it("rejects underscore", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x5f]); // '_'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 1n, dummyResolver)).toThrow();
  });

  it("rejects dot", () => {
    const simulator = new NSSimulator();
    const key = paddedKey([0x2e]); // '.'
    expect(() => buyWithCommit(simulator, dummyOwner, key, 1n, dummyResolver)).toThrow();
  });
});

// ===========================================
// Character validation — register_domain_for
// ===========================================

describe("register_domain_for — character validation", () => {
  it("accepts lowercase a-z", () => {
    const simulator = new NSSimulator();
    expect(() => simulator.registerDomainFor(dummyOwner, stringToKey("abc"), 3n, dummyResolver)).not.toThrow();
  });

  it("accepts digits 0-9", () => {
    const simulator = new NSSimulator();
    expect(() => simulator.registerDomainFor(dummyOwner, stringToKey("789"), 3n, dummyResolver)).not.toThrow();
  });

  it("accepts hyphen in middle", () => {
    const simulator = new NSSimulator();
    expect(() => simulator.registerDomainFor(dummyOwner, stringToKey("a-b"), 3n, dummyResolver)).not.toThrow();
  });

  it("rejects uppercase letters", () => {
    const simulator = new NSSimulator();
    expect(() => simulator.registerDomainFor(dummyOwner, paddedKey([0x41]), 1n, dummyResolver)).toThrow();
  });

  it("rejects leading hyphen", () => {
    const simulator = new NSSimulator();
    expect(() => simulator.registerDomainFor(dummyOwner, paddedKey([0x2d, 0x61]), 2n, dummyResolver)).toThrow();
  });

  it("rejects trailing hyphen", () => {
    const simulator = new NSSimulator();
    expect(() => simulator.registerDomainFor(dummyOwner, paddedKey([0x61, 0x2d]), 2n, dummyResolver)).toThrow();
  });

  it("rejects special characters", () => {
    const simulator = new NSSimulator();
    expect(() => simulator.registerDomainFor(dummyOwner, paddedKey([0x21]), 1n, dummyResolver)).toThrow();
  });
});

// ===========================================
//       Commit-reveal — buy_domain_for
// ===========================================

describe("commit-reveal — buy_domain_for", () => {
  it("rejects buy without any commitment", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    expect(() => simulator.buyDomainFor(dummyOwner, key, 5n, dummyResolver, defaultRand)).toThrow();
  });

  it("accepts buy with valid commitment", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    const commitment = computeCommitment(key, dummyOwner, defaultRand);
    simulator.commitDomain(commitment);
    expect(() => simulator.buyDomainFor(dummyOwner, key, 5n, dummyResolver, defaultRand)).not.toThrow();
  });

  it("commitment is consumed after buy", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    const commitment = computeCommitment(key, dummyOwner, defaultRand);
    simulator.commitDomain(commitment);
    simulator.buyDomainFor(dummyOwner, key, 5n, dummyResolver, defaultRand);
    // Commitment should be removed from ledger
    const ledger = simulator.getLedger();
    expect(ledger.commitments.member(commitment)).toBe(false);
  });

  it("wrong rand fails to match commitment", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    const commitment = computeCommitment(key, dummyOwner, 1n);
    simulator.commitDomain(commitment);
    // Use a different rand for the buy
    expect(() => simulator.buyDomainFor(dummyOwner, key, 5n, dummyResolver, 999n)).toThrow();
  });

  it("duplicate commit with same value fails", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    const commitment = computeCommitment(key, dummyOwner, defaultRand);
    simulator.commitDomain(commitment);
    expect(() => simulator.commitDomain(commitment)).toThrow();
  });

  it("cancel_commitment removes commitment", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    const commitment = computeCommitment(key, dummyOwner, defaultRand);
    simulator.commitDomain(commitment);
    expect(simulator.getLedger().commitments.member(commitment)).toBe(true);
    simulator.cancelCommitment(key, dummyOwner, defaultRand);
    expect(simulator.getLedger().commitments.member(commitment)).toBe(false);
  });

  it("cancel_commitment fails for non-existent commitment", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("alice");
    expect(() => simulator.cancelCommitment(key, dummyOwner, defaultRand)).toThrow();
  });
});

// ===========================================
//          Fields management
// ===========================================

describe("fields management", () => {
  it("insert_field adds a field", () => {
    const simulator = new NSSimulator();
    const ledger = simulator.insertField("name", "Alice");
    expect(ledger.fields.member("name")).toBe(true);
    expect(ledger.fields.lookup("name")).toBe("Alice");
  });

  it("insert_field overwrites existing field", () => {
    const simulator = new NSSimulator();
    simulator.insertField("name", "Alice");
    const ledger = simulator.insertField("name", "Bob");
    expect(ledger.fields.lookup("name")).toBe("Bob");
  });

  it("clear_field removes a field", () => {
    const simulator = new NSSimulator();
    simulator.insertField("name", "Alice");
    const ledger = simulator.clearField("name");
    expect(ledger.fields.member("name")).toBe(false);
  });

  it("clear_all_fields removes all fields", () => {
    const simulator = new NSSimulator();
    simulator.insertField("name", "Alice");
    simulator.insertField("bio", "Developer");
    simulator.insertField("twitter", "@alice");
    const ledger = simulator.clearAllFields();
    expect(ledger.fields.isEmpty()).toBe(true);
  });

  it("add_multiple_fields adds several fields at once", () => {
    const simulator = new NSSimulator();
    const kvs = [
      { is_some: true, value: ["name", "Alice"] as [string, string] },
      { is_some: true, value: ["bio", "Dev"] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
    ];
    const ledger = simulator.addMultipleFields(kvs);
    expect(ledger.fields.member("name")).toBe(true);
    expect(ledger.fields.lookup("name")).toBe("Alice");
    expect(ledger.fields.member("bio")).toBe(true);
    expect(ledger.fields.lookup("bio")).toBe("Dev");
  });
});

// ===========================================
//          Domain management
// ===========================================

describe("domain management", () => {
  it("set_resolver updates resolver for existing domain", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("test");
    simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver);
    const newResolver = { bytes: new Uint8Array(32).fill(1) };
    const ledger = simulator.setResolver(key, newResolver);
    expect(ledger.domains.lookup(key).resolver).toEqual(newResolver);
    // Owner should remain unchanged
    expect(ledger.domains.lookup(key).owner).toEqual(dummyOwner);
  });

  it("set_resolver fails for non-existent domain", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("nope");
    expect(() => simulator.setResolver(key, dummyResolver)).toThrow();
  });

  it("transfer_domain changes owner in domains map", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("test");
    simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver);
    const newOwner = { bytes: new Uint8Array(32).fill(2) };
    const ledger = simulator.transferDomain(key, newOwner);
    expect(ledger.domains.lookup(key).owner).toEqual(newOwner);
    // Resolver should remain unchanged
    expect(ledger.domains.lookup(key).resolver).toEqual(dummyResolver);
  });

  it("transfer_domain updates domains_owned tracking", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("test");
    simulator.registerDomainFor(dummyOwner, key, 4n, dummyResolver);
    const newOwner = { bytes: new Uint8Array(32).fill(2) };
    const ledger = simulator.transferDomain(key, newOwner);
    // New owner should have the domain
    expect(ledger.domains_owned.member(newOwner)).toBe(true);
    expect(ledger.domains_owned.lookup(newOwner).member(key)).toBe(true);
    // Old owner should no longer have it
    expect(ledger.domains_owned.lookup(dummyOwner).member(key)).toBe(false);
  });

  it("transfer_domain fails for non-existent domain", () => {
    const simulator = new NSSimulator();
    const key = stringToKey("nope");
    const newOwner = { bytes: new Uint8Array(32).fill(2) };
    expect(() => simulator.transferDomain(key, newOwner)).toThrow();
  });

  it("multiple domains can be registered under the same parent", () => {
    const simulator = new NSSimulator();
    const key1 = stringToKey("alice");
    const key2 = stringToKey("bob");
    simulator.registerDomainFor(dummyOwner, key1, 5n, dummyResolver);
    const ledger = simulator.registerDomainFor(dummyOwner, key2, 3n, dummyResolver);
    expect(ledger.domains.member(key1)).toBe(true);
    expect(ledger.domains.member(key2)).toBe(true);
    expect(ledger.domains.size()).toBe(2n);
  });
});

// ===========================================
//          Owner operations
// ===========================================

describe("owner operations", () => {
  it("change_owner updates DOMAIN_OWNER", () => {
    const simulator = new NSSimulator();
    const newOwner = { bytes: new Uint8Array(32).fill(5) };
    const ledger = simulator.changeOwner(newOwner);
    expect(ledger.DOMAIN_OWNER).toEqual(newOwner);
  });

  it("update_color updates COIN_COLOR", () => {
    const simulator = new NSSimulator();
    const newColor = new Uint8Array(32).fill(0xab);
    const ledger = simulator.updateColor(newColor);
    expect(ledger.COIN_COLOR).toEqual(newColor);
  });

  it("update_costs updates all cost tiers", () => {
    const simulator = new NSSimulator();
    const ledger = simulator.updateCosts(200n, 100n, 20n);
    expect(ledger.COST_SHORT).toEqual(200n);
    expect(ledger.COST_MED).toEqual(100n);
    expect(ledger.COST_LONG).toEqual(20n);
  });

  it("update_default_field updates DEFAULT_FIELD", () => {
    const simulator = new NSSimulator();
    const ledger = simulator.updateDefaultField({ is_some: true, value: "hello" });
    expect(ledger.DEFAULT_FIELD.is_some).toBe(true);
    expect(ledger.DEFAULT_FIELD.value).toBe("hello");
  });

  it("update_domain_target updates DOMAIN_TARGET", () => {
    const simulator = new NSSimulator();
    const newTarget = {
      is_left: true,
      left: { bytes: new Uint8Array(32).fill(0xcc) },
      right: {
        is_left: true,
        left: { bytes: new Uint8Array(32) },
        right: { bytes: new Uint8Array(32) }
      }
    };
    const ledger = simulator.updateDomainTarget(newTarget);
    expect(ledger.DOMAIN_TARGET.is_left).toBe(true);
    expect(ledger.DOMAIN_TARGET.left).toEqual({ bytes: new Uint8Array(32).fill(0xcc) });
  });

  it("update_target_and_fields updates target and adds fields atomically", () => {
    const simulator = new NSSimulator();
    const newTarget = {
      is_left: true,
      left: { bytes: new Uint8Array(32).fill(0xdd) },
      right: {
        is_left: true,
        left: { bytes: new Uint8Array(32) },
        right: { bytes: new Uint8Array(32) }
      }
    };
    const kvs = [
      { is_some: true, value: ["website", "example.com"] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
      { is_some: false, value: ["", ""] as [string, string] },
    ];
    const ledger = simulator.updateTargetAndFields(newTarget, kvs);
    expect(ledger.DOMAIN_TARGET.is_left).toBe(true);
    expect(ledger.DOMAIN_TARGET.left).toEqual({ bytes: new Uint8Array(32).fill(0xdd) });
    expect(ledger.fields.member("website")).toBe(true);
    expect(ledger.fields.lookup("website")).toBe("example.com");
  });
});

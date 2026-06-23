import { NSSimulator } from "./ns-simulator.js";
import { deriveOwnerPublicKey, hexToBytes } from "./derive.js";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, it, expect } from "vitest";

setNetworkId("undeployed");

// The original buyer's domain secret key (held in their browser today).
const BUYER = "11".repeat(32);
// The migration deployer / admin key — must be irrelevant to ownership.
const ADMIN = "22".repeat(32);
// Anyone else.
const ATTACKER = "33".repeat(32);

const newColor = new Uint8Array(32).fill(7);

describe("migration ownership model: explicit owner + legacy derivation", () => {
  it("binds DOMAIN_OWNER to the explicit pubkey, not the deployer's key", () => {
    const ownerPubkey = deriveOwnerPublicKey(hexToBytes(BUYER));
    // Deployed with ADMIN's witness, but owner is set explicitly to the BUYER's key.
    const sim = new NSSimulator(ADMIN, ownerPubkey);
    expect(sim.getLedger().DOMAIN_OWNER[0]).toEqual(ownerPubkey);
  });

  it("lets the original buyer operate the migrated resolver with their existing key", () => {
    // This only passes if the JS derivation exactly matches the contract's
    // on-chain derive_public_key (persistentHash([tag, secret])).
    const ownerPubkey = deriveOwnerPublicKey(hexToBytes(BUYER));
    const sim = new NSSimulator(BUYER, ownerPubkey);
    expect(() => sim.updateColor(newColor)).not.toThrow();
    expect(sim.getLedger().COIN_COLOR).toEqual(newColor);
  });

  it("rejects anyone whose key does not derive the stored owner pubkey", () => {
    const ownerPubkey = deriveOwnerPublicKey(hexToBytes(BUYER));
    const sim = new NSSimulator(ATTACKER, ownerPubkey);
    expect(() => sim.updateColor(newColor)).toThrow(/Not the domain owner/);
  });
});

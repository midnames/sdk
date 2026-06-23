import { createHash } from "node:crypto";

/**
 * Owner-key derivation matching the leaf contract's `derive_public_key`
 * (and the legacy single-contract `ns.compact`):
 *
 *   owner_pubkey = persistentHash([pad(32, "midnight.domains"), secret])
 *                = sha256( pad32("midnight.domains") ++ secret )
 *
 * Node-only (uses `node:crypto`) — for migration tooling and tests. The browser
 * buy-flow needs a WebCrypto equivalent (Phase 5).
 */
export function deriveOwnerPublicKey(secretKey: Uint8Array): Uint8Array {
  if (secretKey.length !== 32) {
    throw new Error(`secretKey must be 32 bytes, got ${secretKey.length}`);
  }
  const tag = new Uint8Array(32);
  tag.set(new TextEncoder().encode("midnight.domains"));
  const input = new Uint8Array(64);
  input.set(tag, 0);
  input.set(secretKey, 32);
  return new Uint8Array(createHash("sha256").update(input).digest());
}

export function hexToBytes(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, "hex"));
}

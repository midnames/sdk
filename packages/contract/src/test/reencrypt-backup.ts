/**
 * Converts a batch-deploy export into the frontend backup format, re-encrypted with a new password.
 *
 * Usage:
 *   bun run src/test/reencrypt-backup.ts <batch-export.json> <old-password> <new-password>
 */
import { StorageEncryption } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import * as fs from "node:fs";
import { Buffer } from "buffer";

async function decryptPayload(encryptedPayload: string, saltHex: string, password: string): Promise<any> {
  const salt = Buffer.from(saltHex, "hex");
  const enc = await StorageEncryption.create(password, { existingSalt: salt });
  return JSON.parse(await enc.decrypt(encryptedPayload));
}

async function encryptPayload(payload: any, password: string) {
  const enc = await StorageEncryption.create(password);
  const encryptedPayload = await enc.encrypt(JSON.stringify(payload));
  const salt = enc.getSalt().toString("hex");
  return { encryptedPayload, salt };
}

const [backupPath, oldPassword, newPassword] = process.argv.slice(2);

if (!backupPath || !oldPassword || !newPassword) {
  console.error("Usage: bun run reencrypt-backup.ts <batch-export.json> <old-password> <new-password>");
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(backupPath, "utf-8"));

// Merge all per-contract private states into one payload
const mergedStates: Record<string, string> = {};

for (const [domain, entry] of Object.entries<any>(backup.privateStates)) {
  const contractAddress = entry.contractAddress;
  const ps = entry.privateState;
  const decrypted = await decryptPayload(ps.encryptedPayload, ps.salt, oldPassword);
  // decrypted.states has raw state IDs (e.g. "namespacePrivateState") — scope them with contract address
  for (const [stateId, value] of Object.entries<string>(decrypted.states)) {
    mergedStates[`${contractAddress}:${stateId}`] = value;
  }
  console.log(`Merged private state for "${domain}" (${contractAddress})`);
}

const mergedPayload = {
  version: 1,
  exportedAt: new Date().toISOString(),
  stateCount: Object.keys(mergedStates).length,
  states: mergedStates,
};

console.log("Re-encrypting merged private states...");
const newPrivateStates = await encryptPayload(mergedPayload, newPassword);

// Signing keys: just re-encrypt as-is
console.log("Re-encrypting signing keys...");
const skDecrypted = await decryptPayload(backup.signingKeys.encryptedPayload, backup.signingKeys.salt, oldPassword);
const newSigningKeys = await encryptPayload(skDecrypted, newPassword);

const output = {
  privateStates: {
    format: "midnight-private-state-export",
    ...newPrivateStates,
  },
  signingKeys: {
    format: "midnight-signing-key-export",
    ...newSigningKeys,
  },
  exportedAt: new Date().toISOString(),
};

const outPath = backupPath.replace(".json", `-frontend.json`);
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");
console.log(`Written to: ${outPath}`);

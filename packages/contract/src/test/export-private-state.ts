/**
 * Re-runs the frontend-backup export for contracts that are already deployed.
 *
 * batch-deploy.ts does this inline at the end of a run, so a missing EXPORT_PASSWORD
 * aborts the export after the contracts are already on chain. This script produces the
 * same file from the persisted private state, without redeploying anything.
 *
 * Requires the midnight-level-db written by the original deploy, and the same SEED
 * (it scopes the private-state accountId) and MIDNIGHT_SECRET_KEY.
 *
 * Usage:
 *   EXPORT_PASSWORD=... bun run src/test/export-private-state.ts <domain>=<address> [<domain>=<address> ...]
 *
 * Example:
 *   EXPORT_PASSWORD=hunter2 bun run src/test/export-private-state.ts \
 *     night=e2655a6d554d5d3ceb03dfbee517ad4186d6c287c5e638a29258320dde3e0ba7
 */
import "dotenv/config";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { createHash, randomBytes, createCipheriv, pbkdf2Sync } from "crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Buffer } from "buffer";
import { resolveSeed } from "./batch-deploy.js";

const entries = process.argv.slice(2).map((arg) => {
  const [domain, address] = arg.split("=");
  if (!domain || !address) {
    throw new Error(`Expected <domain>=<address>, got "${arg}"`);
  }
  return { domain, address };
});

if (entries.length === 0) {
  console.error(
    "Usage: EXPORT_PASSWORD=... bun run src/test/export-private-state.ts <domain>=<address> [...]",
  );
  process.exit(1);
}

const exportPassword = process.env.EXPORT_PASSWORD;
if (!exportPassword) {
  throw new Error("EXPORT_PASSWORD env variable is required");
}
const secretKeyHex = process.env.MIDNIGHT_SECRET_KEY;
if (!secretKeyHex) {
  throw new Error("MIDNIGHT_SECRET_KEY env variable is required");
}

const networkId = (process.env.NETWORK ?? "preview") as any;
setNetworkId(networkId);

// The private state is scoped by accountId, so rebuild the same unshielded address
// the deploy ran under — same derivation as initWalletWithSeed().
const hexSeed = await resolveSeed();
const hdWallet = HDWallet.fromSeed(Buffer.from(hexSeed, "hex"));
if (hdWallet.type !== "seedOk") {
  throw new Error("Failed to initialize HDWallet");
}
const derived = hdWallet.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);
if (derived.type !== "keysDerived") {
  throw new Error("Failed to derive keys");
}
hdWallet.hdWallet.clear();
const accountId = createKeystore(derived.keys[Roles.NightExternal], networkId)
  .getBech32Address()
  .asString();

console.log(`network:   ${networkId}`);
console.log(`accountId: ${accountId}`);

const psp = levelPrivateStateProvider<"namespacePrivateState">({
  privateStoragePasswordProvider: () => "Midnames-private-state-42",
  accountId,
}) as any;

// derivedKey = sha256(secretKeyBytes) — matches Compact's persistentHash
const derivedKey = createHash("sha256")
  .update(Buffer.from(secretKeyHex, "hex"))
  .digest("hex");

const salt = randomBytes(16);
const iv = randomBytes(12);
const encKey = pbkdf2Sync(exportPassword, salt, 100_000, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", encKey, iv);
const encrypted = Buffer.concat([
  cipher.update(secretKeyHex, "utf8"),
  cipher.final(),
]);
const encryptedSecretKey = {
  data: Buffer.concat([encrypted, cipher.getAuthTag()]).toString("hex"),
  salt: salt.toString("hex"),
  iv: iv.toString("hex"),
};

const keyRegistry = [
  {
    id: crypto.randomUUID(),
    derivedKey,
    label: "batch-deploy",
    domains: entries.map((e) => e.domain),
    contractAddresses: entries.map((e) => e.address),
    createdAt: Date.now(),
    encryptedSecretKey,
  },
];

// exportSigningKeys() dumps every signing key stored under this accountId — it is not
// scoped by contract address. setContractAddress is only here to mirror batch-deploy.ts;
// the export covers all the contracts listed above regardless.
psp.setContractAddress(entries[0].address);
const signingKeys = await psp.exportSigningKeys({ password: exportPassword });
console.log(`Exported signing keys (all contracts under this account)`);

const exportPath = path.resolve("batch-deploy-private-state-export.json");
fs.writeFileSync(
  exportPath,
  JSON.stringify(
    { keyRegistry, signingKeys, exportedAt: new Date().toISOString() },
    null,
    2,
  ),
  "utf-8",
);
console.log(`Frontend backup written to: ${exportPath}`);
process.exit(0);

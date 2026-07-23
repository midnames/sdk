/**
 * Generates a fresh random wallet seed and prints the addresses derived from it.
 * Derivation only — no network access, nothing is written to disk.
 *
 * Usage:
 *   bun run src/test/new-preview-wallet.ts [networkId]   # default: preview
 */
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { createKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import {
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { randomBytes } from "node:crypto";
import { Buffer } from "buffer";

const networkId = (process.argv[2] ?? "preview") as any;
setNetworkId(networkId);

// A 32-byte hex seed, which resolveSeed() in batch-deploy.ts accepts directly.
const hexSeed = randomBytes(32).toString("hex");
const seed = Buffer.from(hexSeed, "hex");

const hdWallet = HDWallet.fromSeed(seed);
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

const unshieldedKeystore = createKeystore(derived.keys[Roles.NightExternal], networkId);
const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(derived.keys[Roles.Zswap]);

// ZswapSecretKeys exposes both public keys as 64-char hex strings.
const shieldedAddress = ShieldedAddress.codec
  .encode(
    networkId,
    new ShieldedAddress(
      new ShieldedCoinPublicKey(Buffer.from(shieldedSecretKeys.coinPublicKey, "hex")),
      new ShieldedEncryptionPublicKey(
        Buffer.from(shieldedSecretKeys.encryptionPublicKey, "hex"),
      ),
    ),
  )
  .asString();

console.log(JSON.stringify({
  networkId,
  hexSeed,
  unshieldedBech32: unshieldedKeystore.getBech32Address().asString(),
  unshieldedRaw: unshieldedKeystore.getAddress().toString(),
  shieldedAddress,
}, null, 2));

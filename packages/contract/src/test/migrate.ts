import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { Buffer } from "buffer";
import * as ledgerSdk from "@midnight-ntwrk/ledger-v8";
import { findDeployedContract } from "@midnight-ntwrk/midnight-js-contracts";

import { Leaf } from "../../dist";
import { domainToKey, keyToDomain } from "../utils.js";
import { deriveOwnerPublicKey, hexToBytes } from "./derive.js";
import type { DomainSettings } from "./batch-config";
import {
  type NetworkConfig,
  makePreviewConfig,
  makePreprodConfig,
  makeMainnetConfig,
  resolveSeed,
  buildWalletAndWaitForFunds,
  configureProviders,
  deployLeafContract,
  buyDomainFor,
  callLeafCircuit,
  leafContractInstance,
  waitForSync,
  displayWalletBalances,
  registerNightForDust,
  cacheWalletState,
} from "./batch-deploy.js";

/**
 * One-time migration of existing `.night` domains from the legacy single contract
 * to the multi-contract (leaf) system. Reads a snapshot produced by
 * `migration/scripts/phase0-enumerate.ts`, deploys one resolver per domain bound to
 * the *buyer's* existing owner key (read from the snapshot — no user secret needed),
 * and registers each under the admin-owned TLD.
 *
 * Only domains NOT owned by the admin/root key are migrated; the admin's own reserved
 * domains are redeployed separately.
 *
 * Usage:
 *   SEED=<admin mnemonic|hexseed> MIDNIGHT_SECRET_KEY=<admin domain secret hex> \
 *     bun run src/test/migrate.ts <snapshot.json> [tldContractAddress]
 *
 * Resumable: writes a manifest after every domain and skips anything already registered
 * in the TLD, so a re-run continues where it stopped.
 */

interface SnapshotDomain {
  fullDomain: string;
  label: string;
  owner_public_key: string;
  owner_address: string;
  target: string;
  target_type: "contract" | "shielded" | "unshielded";
  default_field: string | null;
  payment_config: {
    cost_short: string;
    cost_med: string;
    cost_long: string;
    coin_color: string;
    buy_enabled: boolean;
  };
  fields: Record<string, string>;
}

interface Snapshot {
  stats: { network: string; tld: string };
  root: SnapshotDomain;
  domains: SnapshotDomain[];
}

const TARGET_TYPE: Record<string, Leaf.AddressType> = {
  contract: Leaf.AddressType.ContractAddr,
  shielded: Leaf.AddressType.ZswapCPKAddr,
  unshielded: Leaf.AddressType.UnshieldedAddr,
};

function settingsOf(d: SnapshotDomain): Required<DomainSettings> {
  return {
    coinColor: d.payment_config.coin_color,
    costs: {
      short: BigInt(d.payment_config.cost_short),
      medium: BigInt(d.payment_config.cost_med),
      long: BigInt(d.payment_config.cost_long),
    },
    buyEnabled: d.payment_config.buy_enabled,
  };
}

// Transient failures worth retrying after a re-sync: node rejections (a stale dust coin/witness
// after rapid spends, or a momentarily-full block) AND infra blips (indexer/proof-server 5xx,
// dropped connections). Retrying picks fresh coins / hits the service once it recovers.
function isRetriable(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e);
  return /Custom error: 170|exhaust the block|Transaction submission|could not balance|InsufficientFunds|Response not successful|status code 5\d\d|ServerError|ApolloError|ECONNRESET|ETIMEDOUT|socket hang ?up|fetch failed|503|502|504|Service (Temporarily )?Unavailable|Temporarily Unavailable|Wallet\.Other/i.test(
    msg,
  );
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  resettle: () => Promise<void>,
  attempts = 5,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isRetriable(e) || attempt >= attempts) throw e;
      console.log(`  ${label}: ${String((e as any)?.message ?? e).split("\n")[0]} — re-syncing, retry ${attempt}/${attempts - 1}`);
      await resettle();
    }
  }
}

// Pad field entries to the contract's Vector<10, Maybe<[string,string]>> shape.
function padKvs(entries: [string, string][]) {
  const kvs = entries
    .slice(0, 10)
    .map(([k, v]) => ({ is_some: true, value: [k, v] as [string, string] }));
  while (kvs.length < 10) kvs.push({ is_some: false, value: ["", ""] as [string, string] });
  return kvs;
}

function pickNetwork(network: string): NetworkConfig {
  if (network === "preprod") return makePreprodConfig();
  if (network === "mainnet") return makeMainnetConfig();
  if (network === "preview") return makePreviewConfig();
  throw new Error(`Unsupported network "${network}" for migration`);
}

async function main() {
  const snapshotPath = process.argv[2];
  const tldAddressArg = process.argv[3];
  if (!snapshotPath) {
    console.error(
      "Usage: bun run src/test/migrate.ts <snapshot.json> [tldContractAddress]",
    );
    process.exit(1);
  }

  const adminSecret = process.env.MIDNIGHT_SECRET_KEY;
  if (!adminSecret) throw new Error("MIDNIGHT_SECRET_KEY (admin domain secret hex) is required");

  const snapshot: Snapshot = JSON.parse(fs.readFileSync(path.resolve(snapshotPath), "utf-8"));
  const adminOwnerKey = snapshot.root.owner_public_key;
  const tld = snapshot.stats.tld;

  // Where to actually deploy. Defaults to the snapshot's source network, but DEPLOY_NETWORK lets us
  // rehearse a dataset on another network (e.g. migrate the mainnet dataset onto preprod first).
  const targetNetwork = process.env.DEPLOY_NETWORK ?? snapshot.stats.network;

  // Migrate only the non-admin (real buyer) domains.
  const toMigrate = snapshot.domains.filter((d) => d.owner_public_key !== adminOwnerKey);
  console.log(
    `Snapshot ${snapshot.stats.network} → deploy to ${targetNetwork}: ${snapshot.domains.length} domains, ` +
      `${toMigrate.length} non-admin to migrate (admin key ${adminOwnerKey.slice(0, 12)}…).`,
  );

  // Manifest is keyed off the snapshot file so different datasets/rehearsals never collide.
  const manifestPath = path.resolve(snapshotPath).replace(/(-snapshot)?\.json$/, "-migration-manifest.json");
  const manifest: {
    network: string;
    tldAddress?: string;
    domains: Record<string, { resolver: string; owner: string }>;
  } = fs.existsSync(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, "utf-8"))
    : { network: targetNetwork, domains: {} };
  const saveManifest = () => fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Wallet + providers
  const networkConfig = pickNetwork(targetNetwork);
  const seed = await resolveSeed();
  const walletContext = await buildWalletAndWaitForFunds(networkConfig, seed);
  // Persist the freshly-synced state right away so a later failure never costs another full sync.
  await cacheWalletState(targetNetwork, walletContext);

  try {
    const providers = await configureProviders(walletContext, networkConfig);
    const adminOwnerAddress = new Uint8Array(
      Buffer.from(walletContext.unshieldedKeystore.getAddress().toString().replace("0x", ""), "hex"),
    );
    const adminOwnerPubkey = deriveOwnerPublicKey(hexToBytes(adminSecret));

    // 1. Deploy or join the admin-owned TLD, seeded with the root's payment config.
    let tldContract;
    if (tldAddressArg ?? manifest.tldAddress) {
      const addr = (tldAddressArg ?? manifest.tldAddress)!;
      console.log(`Joining existing TLD at ${addr}`);
      tldContract = await findDeployedContract(providers, {
        contractAddress: addr,
        compiledContract: leafContractInstance as any,
        privateStateId: "namespacePrivateState",
        initialPrivateState: { secretKey: adminSecret },
      });
    } else {
      console.log(`Deploying TLD "${tld}" (admin-owned)`);
      tldContract = await deployLeafContract(
        providers,
        null,
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        new Uint8Array(32),
        adminOwnerPubkey,
        adminOwnerAddress,
        adminSecret,
        tld,
        [],
        settingsOf(snapshot.root),
      );
    }
    const tldAddress = tldContract.deployTxData.public.contractAddress;
    manifest.tldAddress = tldAddress;
    saveManifest();
    console.log(`TLD ${tld} @ ${tldAddress}`);

    // Skip domains already registered under the TLD (resume safety).
    const tldState = await providers.publicDataProvider.queryContractState(tldAddress);
    const registered = new Set<string>();
    if (tldState) {
      for (const [key] of Leaf.ledger(tldState.data).domains) registered.add(keyToDomain(key));
    }

    // 2. Deploy + register each buyer domain.
    let i = 0;
    for (const d of toMigrate) {
      i++;
      const prefix = `[${i}/${toMigrate.length}] ${d.fullDomain}`;
      if (registered.has(d.label) || manifest.domains[d.fullDomain]) {
        console.log(`${prefix} — already migrated, skipping`);
        continue;
      }

      // Let the indexer/wallet catch up before the next tx (so dust coins aren't stale). The sync
      // wait is itself retried, since the public indexer occasionally returns 5xx mid-run.
      const afterTx = async () => {
        await new Promise((r) => setTimeout(r, 9_000));
        for (let attempt = 1; ; attempt++) {
          try {
            await waitForSync(walletContext.wallet);
            return;
          } catch (e) {
            if (!isRetriable(e) || attempt >= 6) throw e;
            console.log(`  sync-wait: ${String((e as any)?.message ?? e).split("\n")[0]} — retry ${attempt}`);
            await new Promise((r) => setTimeout(r, 6_000));
          }
        }
      };
      await afterTx();
      try {
        await displayWalletBalances(walletContext.wallet);
        await registerNightForDust(walletContext);
      } catch (e) {
        console.log(`  (non-fatal) balance/dust check skipped: ${String((e as any)?.message ?? e).split("\n")[0]}`);
      }

      // Deploy the resolver admin-owned with NO fields: seeding fields in the constructor pushes
      // the deploy tx (which carries the contract's verifier keys) over the block limit. Fields are
      // seeded via a small call tx, then ownership is handed to the buyer — all as the admin.
      console.log(`${prefix} — deploying resolver (admin-owned, 0 fields)`);
      const resolver = await withRetry("deploy", () =>
        deployLeafContract(
          providers,
          tld,
          tldAddress,
          hexToBytes(d.target),
          adminOwnerPubkey,
          adminOwnerAddress,
          adminSecret,
          d.label,
          [],
          settingsOf(d),
          TARGET_TYPE[d.target_type],
          d.default_field,
        ), afterTx);
      const resolverAddress = resolver.deployTxData.public.contractAddress;
      await afterTx();

      const fieldEntries = Object.entries(d.fields);
      if (fieldEntries.length) {
        console.log(`${prefix} — seeding ${fieldEntries.length} fields`);
        await withRetry("add_fields", () =>
          callLeafCircuit(resolverAddress, "add_multiple_fields", [padKvs(fieldEntries)], providers), afterTx);
        await afterTx();
      }

      console.log(`${prefix} — transferring ownership to buyer ${d.owner_public_key.slice(0, 12)}…`);
      await withRetry("change_owner", () =>
        callLeafCircuit(
          resolverAddress,
          "change_owner",
          [hexToBytes(d.owner_public_key), { bytes: hexToBytes(d.owner_address) }],
          providers,
        ), afterTx);
      await afterTx();

      console.log(`${prefix} — registering under TLD`);
      await withRetry("register", () =>
        buyDomainFor(tldContract, hexToBytes(d.owner_public_key), d.label, resolverAddress, providers), afterTx);

      manifest.domains[d.fullDomain] = { resolver: resolverAddress, owner: d.owner_public_key };
      saveManifest();
      // Checkpoint wallet state so a crash mid-run resumes with a near-current cache.
      await cacheWalletState(targetNetwork, walletContext);
      console.log(`${prefix} — done @ ${resolverAddress}`);
    }

    console.log(`\nMigration complete. Manifest: ${manifestPath}`);
  } finally {
    await cacheWalletState(targetNetwork, walletContext);
    try {
      await walletContext.wallet.stop();
    } catch {
      /* ignore */
    }
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

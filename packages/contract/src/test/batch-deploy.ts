import "dotenv/config";
import type { DomainEntry, BatchDeployConfig, DomainSettings } from "./batch-config";

// ─── Midnight SDK Imports ───────────────────────────────────────────────────
import * as ledger from "@midnight-ntwrk/ledger-v8";
import {
  unshieldedToken,
  nativeToken,
  type UnprovenTransaction,
} from "@midnight-ntwrk/ledger-v8";
import {
  type MidnightProvider,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { NetworkId } from "@midnight-ntwrk/wallet-sdk-abstractions";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import {
  createUnprovenCallTx,
  deployContract,
  findDeployedContract,
  type ContractProviders,
  type DeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js-contracts";

import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import {
  createKeystore,
  PublicKey as UnshieldedPublicKey,
  type UnshieldedKeystore,
  UnshieldedWallet,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import {
  InMemoryTransactionHistoryStorage,
  TransactionHistoryStorage,
} from "@midnight-ntwrk/wallet-sdk-abstractions";

import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { Leaf, witnesses } from "../../dist";
import { domainToKey } from "../utils.js";
import { deriveOwnerPublicKey, hexToBytes } from "./derive.js";

import * as Rx from "rxjs";
import * as path from "node:path";
import * as fs from "node:fs";
import { webcrypto, createHash, randomBytes, createCipheriv } from "crypto";
import { WebSocket } from "ws";
import { Buffer } from "buffer";
import { type Logger } from "pino";
import pinoPretty from "pino-pretty";
import pino from "pino";
import * as bip39 from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";

// @ts-expect-error: Needed to enable WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─── Logger ─────────────────────────────────────────────────────────────────
const logger: Logger = pino(
  {
    level:
      process.env.DEBUG_LEVEL !== undefined &&
      process.env.DEBUG_LEVEL !== null &&
      process.env.DEBUG_LEVEL !== ""
        ? process.env.DEBUG_LEVEL
        : "info",
    depthLimit: 20,
  },
  pinoPretty({
    colorize: true,
    sync: true,
    customColors: { debug: "green" },
  }),
);

// Number of ledger updates applied per batch during wallet sync. Larger = much
// faster catch-up when the wallet is far behind tip.
const SYNC_BATCH_SIZE = 5000;

// ─── Network Config ─────────────────────────────────────────────────────────
export interface NetworkConfig {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly networkId: string;
}

export function makePreviewConfig(): NetworkConfig {
  const cfg = {
    indexer: "https://indexer.preview.midnight.network/api/v3/graphql",
    indexerWS: "wss://indexer.preview.midnight.network/api/v3/graphql/ws",
    node: "wss://rpc.preview.midnight.network",
    proofServer: "https://ps.midnames.com",
    networkId: "preview",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

export function makePreprodConfig(): NetworkConfig {
  const cfg = {
    indexer: "https://indexer.preprod.midnight.network/api/v3/graphql",
    indexerWS: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
    node: "wss://rpc.preprod.midnight.network",
    proofServer: "https://ps.midnames.com",
    networkId: "preprod",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

export function makeMainnetConfig(): NetworkConfig {
  const cfg = {
    indexer: "https://midnight-proxy-mainnet-indexer.faculerena.workers.dev/api/v3/graphql",
    indexerWS: "wss://midnight-proxy-mainnet-indexer.faculerena.workers.dev/api/v3/graphql/ws",
    node: "wss://rpc.mainnet.midnight.network",
    //node: "wss://rpc.mainnet.midnight.foundation/v1/mk_b041adce419487067f9c85b5abacb632",
    proofServer: "https://ps.midnames.com",
    networkId: "mainnet",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

function makeStandaloneConfig(): NetworkConfig {
  const cfg = {
    indexer: "http://127.0.0.1:8088/api/v3/graphql",
    indexerWS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
    node: "ws://127.0.0.1:9944",
    proofServer: "http://127.0.0.1:6300",
    networkId: "undeployed",
  };
  setNetworkId(cfg.networkId);
  return cfg;
}

// ─── Wallet Cache ──────────────────────────────────────────────────────────
// Caches are per-network so preprod/mainnet state never collide. Defaults to a local
// gitignored dir — NOT the minting-server's wallet cache — so runs can't clobber it.
// Override with WALLET_CACHE_DIR to reuse an existing cache.
const WALLET_CACHE_DIR =
  process.env.WALLET_CACHE_DIR ?? path.resolve(import.meta.dirname, "..", "..", ".wallet-cache");

function walletCachePath(networkId: string): string {
  return path.join(WALLET_CACHE_DIR, `.midnight-wallet-cache-${networkId}.json`);
}

export interface WalletCache {
  shielded: string;
  unshielded: string;
  dust: string;
}

export function readWalletCache(networkId: string): WalletCache | null {
  try {
    const raw = fs.readFileSync(walletCachePath(networkId), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.shielded && parsed.unshielded && parsed.dust) {
      return parsed as WalletCache;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeWalletCache(networkId: string, cache: WalletCache): void {
  try {
    fs.mkdirSync(WALLET_CACHE_DIR, { recursive: true });
    fs.writeFileSync(walletCachePath(networkId), JSON.stringify(cache), "utf-8");
    logger.info(`Wallet state cached (${networkId})`);
  } catch (e) {
    logger.error(`Failed to write wallet cache: ${e}`);
  }
}

/** Serialize all sub-wallets and persist them to the per-network cache. */
export async function cacheWalletState(
  networkId: string,
  ctx: WalletContext,
): Promise<void> {
  try {
    const shielded = await ctx.shieldedWallet.serializeState();
    const unshielded = await ctx.unshieldedWallet.serializeState();
    const dust = await ctx.dustWallet.serializeState();
    writeWalletCache(networkId, { shielded, unshielded, dust });
  } catch (e) {
    logger.error(`Error saving wallet state: ${e}`);
  }
}

// ─── Wallet Types & Helpers ─────────────────────────────────────────────────
export interface WalletContext {
  wallet: WalletFacade;
  shieldedWallet: any;
  unshieldedWallet: any;
  dustWallet: any;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

type UnboundTransaction = ledger.Transaction<
  ledger.SignatureEnabled,
  ledger.Proof,
  ledger.PreBinding
>;

// ─── Contract Instance ──────────────────────────────────────────────────────
const contractConfig = {
  privateStateStoreName: "nameservice-private-state",
  zkConfigPath: path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "dist",
    "managed",
    "leaf",
  ),
};

export const leafContractInstance = CompiledContract.make(
  "leaf-contract",
  Leaf.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractConfig.zkConfigPath),
);

// ─── Address Parsing ────────────────────────────────────────────────────────
export function parseContractAddress(address: string): { bytes: Uint8Array } {
  let hexString: string;
  if (address.startsWith("0200")) {
    hexString = address.slice(4);
  } else if (address.startsWith("0x")) {
    hexString = address.slice(2);
  } else {
    hexString = address;
  }
  const bytes = new Uint8Array(Buffer.from(hexString, "hex"));
  return { bytes: bytes.length === 32 ? bytes : bytes.subarray(-32) };
}

export const ZERO_ADDR =
  "0000000000000000000000000000000000000000000000000000000000000000";

async function mnemonicToHexSeed(mnemonic: string): Promise<string> {
  if (!bip39.validateMnemonic(mnemonic, english)) {
    throw new Error("Invalid BIP39 mnemonic");
  }
  const seed = await bip39.mnemonicToSeed(mnemonic, "");
  return Buffer.from(seed).toString("hex");
}

export async function resolveSeed(configSeed?: string): Promise<string> {
  const raw = configSeed ?? process.env.SEED;
  if (!raw) {
    throw new Error("No seed provided — set SEED in .env or walletSeed in config");
  }
  // If it looks like hex, use directly
  if (/^[0-9a-fA-F]{64,}$/.test(raw)) {
    return raw;
  }
  // Otherwise treat as BIP39 mnemonic
  return await mnemonicToHexSeed(raw);
}

// ─── Wallet Lifecycle ───────────────────────────────────────────────────────
// Derive a sync percent + a robust "really synced" flag from per-wallet progress
// (mirrors gsd-wallet: facade.isSynced can lag the actual applied indices).
interface SyncStatus {
  percent: number;
  reallySynced: boolean;
  allConnected: boolean;
  shieldedSynced: boolean;
  unshieldedSynced: boolean;
  dustSynced: boolean;
}

function syncStatus(state: any): SyncStatus {
  const sp = state?.shielded?.progress;
  const up = state?.unshielded?.progress;
  const dp = state?.dust?.progress;
  if (!sp || !up || !dp) {
    return {
      percent: 0,
      reallySynced: !!state?.isSynced,
      allConnected: false,
      shieldedSynced: false,
      unshieldedSynced: false,
      dustSynced: false,
    };
  }
  const n = (x: any) => Number(x ?? 0);
  const shieldedSynced = sp.isConnected
    ? (n(sp.highestRelevantWalletIndex) === 0 ? n(sp.highestIndex) === 0 : n(sp.appliedIndex) >= n(sp.highestRelevantWalletIndex))
    : false;
  const unshieldedSynced = up.isConnected
    ? (n(up.highestTransactionId) === 0 || n(up.appliedId) >= n(up.highestTransactionId))
    : false;
  const dustSynced = dp.isConnected
    ? (n(dp.highestRelevantWalletIndex) === 0 ? n(dp.highestIndex) === 0 : n(dp.appliedIndex) >= n(dp.highestRelevantWalletIndex))
    : false;
  const allConnected = sp.isConnected && up.isConnected && dp.isConnected;
  const totalApplied = n(sp.appliedIndex) + n(up.appliedId) + n(dp.appliedIndex);
  const totalHighest = n(sp.highestRelevantWalletIndex) + n(up.highestTransactionId) + n(dp.highestRelevantWalletIndex);
  const percent = totalHighest > 0 ? Math.min(100, Math.floor((totalApplied / totalHighest) * 100)) : (allConnected ? 100 : 0);
  const reallySynced = !!state.isSynced || (allConnected && shieldedSynced && unshieldedSynced && dustSynced);
  return { percent, reallySynced, allConnected, shieldedSynced, unshieldedSynced, dustSynced };
}

// "Ready to transact" — full sync normally, or (with SKIP_SHIELDED_SYNC) once unshielded AND
// dust are fully synced (we can skip the unneeded shielded note-scan, but spending dust for fees
// needs the COMPLETE dust state — a partial dust sync produces an invalid spend → node error 170).
function syncGatePassed(state: any): boolean {
  const s = syncStatus(state);
  if (process.env.SKIP_SHIELDED_SYNC !== "1") return s.reallySynced;
  return s.allConnected && s.unshieldedSynced && s.dustSynced;
}

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.tap((state) => {
        const { percent, reallySynced } = syncStatus(state);
        logger.info(`Waiting for wallet sync. ${percent}% (synced=${reallySynced})`);
      }),
      Rx.filter((state) => syncGatePassed(state)),
    ),
  );

/**
 * Initial-sync wait that logs real progress and checkpoints every ~11s, so a crash
 * mid-sync resumes near tip instead of replaying the whole chain (mirrors gsd-wallet).
 */
export async function syncWithCheckpoints(ctx: WalletContext, networkId: string): Promise<void> {
  // The shielded note-scan dominates a far-behind sync. Our deploys pay fees in dust and
  // registrations under the admin TLD are free, so no shielded value is ever spent — set
  // SKIP_SHIELDED_SYNC=1 to proceed once unshielded+dust are synced instead of waiting it out.
  // SKIP_SHIELDED_SYNC: the shielded note-scan is unneeded (deploys pay fees in dust, registrations
  // under the admin TLD are free). On a CLEAN sync the dust balance is correct from the first blocks,
  // so proceed as soon as unshielded is synced and there's spendable dust — no need to wait out the
  // full dust scan. (A stale checkpoint can report a false 0 dust; always clean-sync when in doubt.)
  const skipShielded = process.env.SKIP_SHIELDED_SYNC === "1";
  let lastCheckpoint = Date.now();
  for (;;) {
    const state = await Rx.firstValueFrom(ctx.wallet.state());
    const s = syncStatus(state);
    let dustBal = 0n;
    try { dustBal = state.dust.balance(new Date()); } catch { /* not ready yet */ }
    const done = syncGatePassed(state);
    logger.info(
      `Wallet sync ${s.percent}% (synced=${s.reallySynced}` +
        (skipShielded ? `, gate=unshielded+dust u=${s.unshieldedSynced} d=${s.dustSynced} dustBal=${dustBal}` : "") +
        `)`,
    );
    if (done) break;
    if (Date.now() - lastCheckpoint >= 11_000) {
      lastCheckpoint = Date.now();
      await cacheWalletState(networkId, ctx);
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  await cacheWalletState(networkId, ctx);
}

const waitForFunds = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.tap((state) => {
        const unshielded = state.unshielded?.balances[nativeToken().raw] ?? 0n;
        const shielded = state.shielded?.balances[nativeToken().raw] ?? 0n;
        logger.info(
          `Waiting for funds. Synced: ${state.isSynced}, Unshielded: ${unshielded}, Shielded: ${shielded}`,
        );
      }),
      Rx.filter((state) => state.isSynced),
    ),
  );

export const displayWalletBalances = async (
  wallet: WalletFacade,
): Promise<{ unshielded: bigint; shielded: bigint; total: bigint }> => {
  const state = await Rx.firstValueFrom(wallet.state());
  const unshielded = state.unshielded?.balances[nativeToken().raw] ?? 0n;
  const shielded = state.shielded?.balances[nativeToken().raw] ?? 0n;
  const total = unshielded + shielded;
  logger.info(`Unshielded: ${unshielded}, Shielded: ${shielded}, Total: ${total} tSTAR`);
  return { unshielded, shielded, total };
};

export const registerNightForDust = async (
  walletContext: WalletContext,
): Promise<boolean> => {
  const state = await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(Rx.filter((s) => syncGatePassed(s))),
  );

  const unregisteredNightUtxos =
    state.unshielded?.availableCoins.filter(
      (coin) =>
        coin.utxo.type === "0000000000000000000000000000000000000000000000000000000000000000" &&
        coin.meta.registeredForDustGeneration === false,
    ) ?? [];

  if (unregisteredNightUtxos.length === 0) {
    logger.info("No unshielded Night UTXOs available for dust registration");
    const dustBalance = state.dust
      ? state.dust.capabilities.coinsAndBalances.getWalletBalance(state.dust.state, new Date())
      : 0n;
    logger.info(`Current dust balance: ${dustBalance}`);
    return dustBalance > 0n;
  }

  logger.info(
    `Found ${unregisteredNightUtxos.length} unregistered Night UTXOs, registering for dust...`,
  );

  try {
    const recipe =
      await walletContext.wallet.registerNightUtxosForDustGeneration(
        unregisteredNightUtxos,
        walletContext.unshieldedKeystore.getPublicKey(),
        (payload) => walletContext.unshieldedKeystore.signData(payload),
      );

    const finalizedTx = await walletContext.wallet.finalizeTransaction(
      recipe.transaction,
    );
    const txId = await walletContext.wallet.submitTransaction(finalizedTx);
    logger.info(`Dust registration submitted: ${txId}`);

    logger.info("Waiting for dust to be generated...");
    await Rx.firstValueFrom(
      walletContext.wallet.state().pipe(
        Rx.throttleTime(5_000),
        Rx.tap((s) => {
          const dustBalance = s.dust
            ? s.dust.capabilities.coinsAndBalances.getWalletBalance(s.dust.state, new Date())
            : 0n;
          logger.debug(`Dust balance: ${dustBalance}`);
        }),
        Rx.filter((s) => {
          const dustBalance = s.dust
            ? s.dust.capabilities.coinsAndBalances.getWalletBalance(s.dust.state, new Date())
            : 0n;
          return dustBalance > 0n;
        }),
      ),
    );

    logger.info("Dust registration complete!");
    return true;
  } catch (e) {
    logger.error(`Failed to register Night UTXOs for dust: ${e}`);
    return false;
  }
};

const initWalletWithSeed = async (
  seed: Buffer,
  config: NetworkConfig,
): Promise<WalletContext> => {
  const hdWallet = HDWallet.fromSeed(seed);
  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet");
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== "keysDerived") {
    throw new Error("Failed to derive keys");
  }

  hdWallet.hdWallet.clear();

  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(
    derivationResult.keys[Roles.Zswap],
  );
  const dustSecretKey = ledger.DustSecretKey.fromSeed(
    derivationResult.keys[Roles.Dust],
  );
  const unshieldedKeystore = createKeystore(
    derivationResult.keys[Roles.NightExternal],
    config.networkId as NetworkId.NetworkId,
  );

  const walletConfiguration = {
    networkId: config.networkId as NetworkId.NetworkId,
    costParameters: {
      additionalFeeOverhead: 1_000_000_000n,
      feeBlocksMargin: 5,
    },
    relayURL: new URL(config.node),
    provingServerUrl: new URL(config.proofServer),
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    indexerUrl: config.indexerWS,
    // Apply ledger updates in large batches — without this the wallet applies blocks
    // far slower and a months-behind sync can take hours (mirrors gsd-wallet).
    batchUpdates: { size: SYNC_BATCH_SIZE },
    // Required by shielded, unshielded and dust alike; every wallet writes its own section
    // into the same entry (keyed by tx hash), so they all share one store.
    txHistoryStorage: new InMemoryTransactionHistoryStorage(
      TransactionHistoryStorage.TransactionHistoryCommonSchema,
    ),
  };

  const cache = readWalletCache(config.networkId);

  let shieldedWallet: any;
  let dustWallet: any;
  let unshieldedWallet: any;

  if (cache) {
    logger.info("Restoring wallet from cached state...");
  } else {
    logger.info("No wallet cache found, starting fresh sync...");
  }

  const facade = await WalletFacade.init({
    configuration: walletConfiguration,
    shielded: (cfg: any) => {
      if (cache) {
        try {
          shieldedWallet = ShieldedWallet(cfg).restore(cache.shielded);
          return shieldedWallet;
        } catch (e) {
          logger.warn(`Failed to restore shielded wallet from cache: ${e}`);
        }
      }
      shieldedWallet = ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys);
      return shieldedWallet;
    },
    dust: (cfg: any) => {
      if (cache) {
        try {
          dustWallet = DustWallet(cfg).restore(cache.dust);
          return dustWallet;
        } catch (e) {
          logger.warn(`Failed to restore dust wallet from cache: ${e}`);
        }
      }
      dustWallet = DustWallet(cfg).startWithSecretKey(
        dustSecretKey,
        ledger.LedgerParameters.initialParameters().dust,
      );
      return dustWallet;
    },
    unshielded: (cfg: any) => {
      if (cache) {
        try {
          unshieldedWallet = UnshieldedWallet(cfg).restore(cache.unshielded);
          return unshieldedWallet;
        } catch (e) {
          logger.warn(`Failed to restore unshielded wallet from cache: ${e}`);
        }
      }
      unshieldedWallet = UnshieldedWallet(cfg).startWithPublicKey(
        UnshieldedPublicKey.fromKeyStore(unshieldedKeystore),
      );
      return unshieldedWallet;
    },
  });
  await facade.start(shieldedSecretKeys, dustSecretKey);

  return { wallet: facade, shieldedWallet, unshieldedWallet, dustWallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
};

export const buildWalletAndWaitForFunds = async (
  config: NetworkConfig,
  hexSeed: string,
): Promise<WalletContext> => {
  logger.info("Building wallet from hex seed...");
  const seed = Buffer.from(hexSeed, "hex");
  const walletContext = await initWalletWithSeed(seed, config);

  logger.info(
    `Wallet address: ${walletContext.unshieldedKeystore.getBech32Address().asString()}`,
  );

  logger.info("Waiting for wallet to sync...");
  await syncWithCheckpoints(walletContext, config.networkId);

  const { total } = await displayWalletBalances(walletContext.wallet);
  if (total === 0n) {
    logger.info("Waiting to receive tokens...");
    await waitForFunds(walletContext.wallet);
    await displayWalletBalances(walletContext.wallet);
  }

  const dustRegistered = await registerNightForDust(walletContext);
  if (!dustRegistered) {
    logger.warn("Dust registration failed — deployment may fail without dust for fees");
  }

  return walletContext;
};

const createWalletAndMidnightProvider = async (
  walletContext: WalletContext,
): Promise<WalletProvider & MidnightProvider> => {
  await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(Rx.filter((s) => syncGatePassed(s))),
  );

  return {
    getCoinPublicKey(): ledger.CoinPublicKey {
      return walletContext.shieldedSecretKeys
        .coinPublicKey as unknown as ledger.CoinPublicKey;
    },
    getEncryptionPublicKey(): ledger.EncPublicKey {
      return walletContext.shieldedSecretKeys
        .encryptionPublicKey as unknown as ledger.EncPublicKey;
    },
    async balanceTx(
      tx: UnboundTransaction,
      ttl?: Date,
    ): Promise<ledger.FinalizedTransaction> {
      const txTtl = ttl ?? new Date(Date.now() + 30 * 60 * 1000);
      const recipe = await walletContext.wallet.balanceUnboundTransaction(tx, {
        shieldedSecretKeys: walletContext.shieldedSecretKeys,
        dustSecretKey: walletContext.dustSecretKey,
      }, { ttl: txTtl });

      const signSegment = (data: Uint8Array) =>
        walletContext.unshieldedKeystore.signData(data);
      const signedRecipe = await walletContext.wallet.signRecipe(recipe, signSegment);

      return await walletContext.wallet.finalizeRecipe(signedRecipe);
    },
    async submitTx(
      tx: ledger.FinalizedTransaction,
    ): Promise<ledger.TransactionId> {
      return await walletContext.wallet.submitTransaction(tx);
    },
  };
};

export const configureProviders = async (
  walletContext: WalletContext,
  config: NetworkConfig,
) => {
  setNetworkId(config.networkId);
  const walletAndMidnightProvider =
    await createWalletAndMidnightProvider(walletContext);

  const zkConfig = new NodeZkConfigProvider<string>(contractConfig.zkConfigPath);

  return {
    privateStateProvider: levelPrivateStateProvider<"namespacePrivateState">({
      privateStoragePasswordProvider: () => "Midnames-private-state-42",
      accountId: walletContext.unshieldedKeystore.getBech32Address().asString(),
    }),
    publicDataProvider: indexerPublicDataProvider(
      config.indexer,
      config.indexerWS,
    ),
    zkConfigProvider: zkConfig,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfig),
    walletProvider: walletAndMidnightProvider,
    midnightProvider: walletAndMidnightProvider,
  };
};

// ─── Contract Deployment ────────────────────────────────────────────────────
export const DEFAULT_DOMAIN_SETTINGS: Required<DomainSettings> = {
  coinColor: nativeToken().raw.toString().replace("0x", ""),
  costs: { short: 100n, medium: 10n, long: 1n },
  buyEnabled: true,
};

function resolveDomainSettings(
  perDomain?: DomainSettings,
  globalDefaults?: DomainSettings,
): Required<DomainSettings> {
  return {
    coinColor: perDomain?.coinColor ?? globalDefaults?.coinColor ?? DEFAULT_DOMAIN_SETTINGS.coinColor,
    costs: {
      short: perDomain?.costs?.short ?? globalDefaults?.costs?.short ?? DEFAULT_DOMAIN_SETTINGS.costs.short,
      medium: perDomain?.costs?.medium ?? globalDefaults?.costs?.medium ?? DEFAULT_DOMAIN_SETTINGS.costs.medium,
      long: perDomain?.costs?.long ?? globalDefaults?.costs?.long ?? DEFAULT_DOMAIN_SETTINGS.costs.long,
    },
    buyEnabled: perDomain?.buyEnabled ?? globalDefaults?.buyEnabled ?? DEFAULT_DOMAIN_SETTINGS.buyEnabled,
  };
}

export async function deployLeafContract(
  providers: ContractProviders,
  parentDomain: string | null,
  parentResolver: string,
  targetBytes: Uint8Array,
  ownerPubkey: Uint8Array,
  ownerAddress: Uint8Array,
  secretKey: string,
  domain: string | null,
  initialFields: Array<[string, string]> = [],
  settings: Required<DomainSettings> = DEFAULT_DOMAIN_SETTINGS,
  targetType: Leaf.AddressType = Leaf.AddressType.ZswapCPKAddr,
  defaultField: string | null = null,
) {
  logger.info(`Deploying leaf contract for domain: ${domain || "root"}`);
  logger.info(`  coinColor: ${settings.coinColor}`);
  logger.info(`  costs: short=${settings.costs.short}, medium=${settings.costs.medium}, long=${settings.costs.long}`);
  logger.info(`  buyEnabled: ${settings.buyEnabled}`);

  // Build kvs parameter: Vector<10, Maybe<[string, string]>>
  const kvs: Array<{ is_some: boolean; value: [string, string] }> = [];
  for (const [key, value] of initialFields.slice(0, 10)) {
    kvs.push({ is_some: true, value: [key, value] });
  }
  while (kvs.length < 10) {
    kvs.push({ is_some: false, value: ["", ""] });
  }

  const deployedContract = await deployContract(providers, {
    compiledContract: leafContractInstance as any,
    privateStateId: "namespacePrivateState",
    initialPrivateState: { secretKey },
    args: [
      parentDomain
        ? { is_some: true, value: domainToKey(parentDomain).key }
        : { is_some: false, value: new Uint8Array(32) },
      parseContractAddress(parentResolver),
      [targetBytes, targetType],
      domain ? { is_some: true, value: domainToKey(domain).key } : { is_some: false, value: new Uint8Array(32) },
      new Uint8Array(Buffer.from(settings.coinColor, "hex")),
      settings.costs.short,
      settings.costs.medium,
      settings.costs.long,
      defaultField !== null ? { is_some: true, value: defaultField } : { is_some: false, value: "" },
      settings.buyEnabled,
      ownerPubkey,
      { bytes: ownerAddress },
      kvs,
    ],
  });

  logger.info(
    `Deployed at: ${deployedContract.deployTxData.public.contractAddress}`,
  );
  return deployedContract;
}

/** Prove + balance + submit a single circuit call on an already-deployed leaf contract. */
export async function callLeafCircuit(
  contractAddress: string,
  circuitId: string,
  args: any[],
  providers: ContractProviders,
): Promise<string> {
  const unprovenCallTxData = await createUnprovenCallTx(providers, {
    compiledContract: leafContractInstance as any,
    circuitId,
    contractAddress,
    args,
    privateStateId: "namespacePrivateState",
  });
  const provedTx = await providers.proofProvider.proveTx(unprovenCallTxData.private.unprovenTx);
  const finalizedTx = await providers.walletProvider.balanceTx(provedTx);
  return await providers.midnightProvider.submitTx(finalizedTx);
}

export async function buyDomainFor(
  contract:
    | FoundContract<any>
    | DeployedContract<any>,
  ownerDerivedKey: Uint8Array,
  domainName: string,
  resolverAddress: string,
  providers: ContractProviders,
) {
  logger.info(`Buying domain: ${domainName}`);

  // 1. Build unproven call tx
  const { key: domainKey, len: domainLen } = domainToKey(domainName);
  const unprovenCallTxData = await createUnprovenCallTx(providers, {
    compiledContract: leafContractInstance as any,
    circuitId: "register_domain_for",
    contractAddress: contract.deployTxData.public.contractAddress,
    args: [
      ownerDerivedKey,
      domainKey,
      domainLen,
      parseContractAddress(resolverAddress),
    ],
    privateStateId: "namespacePrivateState",
  });

  const unprovenTx = unprovenCallTxData.private.unprovenTx;

  // 2. Prove using httpClientProofProvider (sends ZKIR to proof server)
  logger.info("Proving transaction...");
  const provedTx = await providers.proofProvider.proveTx(unprovenTx);

  // 3. Balance + finalize, then submit
  logger.info("Balancing and submitting transaction...");
  const finalizedTx = await providers.walletProvider.balanceTx(provedTx);
  const txId = await providers.midnightProvider.submitTx(finalizedTx);

  logger.info(`Domain ${domainName} purchased. Tx: ${txId}`);
  return { public: { txId } };
}

// ─── Service Check ──────────────────────────────────────────────────────────
async function checkServiceAvailability(url: string): Promise<boolean> {
  try {
    if (url.startsWith("ws://") || url.startsWith("wss://")) {
      return new Promise<boolean>((resolve) => {
        const ws = new WebSocket(url);
        const timeoutId = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);
        ws.on("open", () => {
          clearTimeout(timeoutId);
          ws.close();
          resolve(true);
        });
        ws.on("error", () => {
          clearTimeout(timeoutId);
          resolve(false);
        });
      });
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { signal: controller.signal, method: "GET" });
    clearTimeout(timeoutId);
    return response.status < 500;
  } catch {
    return false;
  }
}

async function checkAllServices(config: NetworkConfig): Promise<boolean> {
  logger.info("Checking service availability...");
  const services = [
    { name: "Indexer", url: config.indexer },
    { name: "Node", url: config.node },
    { name: "Proof Server", url: config.proofServer },
  ];

  const results = await Promise.all(
    services.map(async (service) => {
      const available = await checkServiceAvailability(service.url);
      logger.info(
        `${service.name} (${service.url}): ${available ? "Available" : "Unavailable"}`,
      );
      return { ...service, available };
    }),
  );

  const allAvailable = results.every((s) => s.available);
  if (!allAvailable) {
    logger.error("Some services are unavailable.");
  } else {
    logger.info("All services are available");
  }
  return allAvailable;
}

// ─── Topological Sort (Kahn's Algorithm) ────────────────────────────────────
function topologicalSort(
  domains: DomainEntry[],
  tld: string,
  existingContracts: Record<string, string>,
): DomainEntry[] {
  // Build a set of all known domains (config + existing + TLD)
  const configDomainSet = new Set(domains.map((d) => d.domain));
  const existingSet = new Set(Object.keys(existingContracts));

  // Validate: every parent must exist in config, existingContracts, or be the TLD
  for (const entry of domains) {
    const parts = entry.domain.split(".");
    if (parts.length > 1) {
      const parentDomain = parts.slice(1).join(".");
      if (
        !configDomainSet.has(parentDomain) &&
        !existingSet.has(parentDomain) &&
        parentDomain !== tld
      ) {
        throw new Error(
          `Parent "${parentDomain}" for domain "${entry.domain}" is not in config or existingContracts`,
        );
      }
    }
    // Top-level domains have TLD as parent — always valid
  }

  // Build adjacency: parent -> children (only within config domains)
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const entry of domains) {
    inDegree.set(entry.domain, 0);
    children.set(entry.domain, []);
  }

  for (const entry of domains) {
    const parts = entry.domain.split(".");
    if (parts.length > 1) {
      const parentDomain = parts.slice(1).join(".");
      if (configDomainSet.has(parentDomain)) {
        // Parent is in config — add edge
        children.get(parentDomain)!.push(entry.domain);
        inDegree.set(entry.domain, (inDegree.get(entry.domain) ?? 0) + 1);
      }
      // If parent is in existingContracts or is TLD, no dependency edge needed
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [domain, degree] of inDegree) {
    if (degree === 0) queue.push(domain);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);
    for (const child of children.get(current) ?? []) {
      const newDegree = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, newDegree);
      if (newDegree === 0) queue.push(child);
    }
  }

  if (sorted.length !== domains.length) {
    throw new Error(
      "Cycle detected in domain hierarchy — cannot determine deployment order",
    );
  }

  // Map sorted domain names back to DomainEntry objects
  const entryMap = new Map(domains.map((d) => [d.domain, d]));
  return sorted.map((name) => entryMap.get(name)!);
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateConfig(config: BatchDeployConfig): void {
  const domainNames = config.domains.map((d) => d.domain);
  const duplicates = domainNames.filter(
    (name, i) => domainNames.indexOf(name) !== i,
  );
  if (duplicates.length > 0) {
    throw new Error(`Duplicate domains: ${duplicates.join(", ")}`);
  }

  for (const entry of config.domains) {
    if (entry.fields.length > 10) {
      throw new Error(
        `Domain "${entry.domain}" has ${entry.fields.length} fields (max 10)`,
      );
    }
  }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────
async function batchDeploy(config: BatchDeployConfig): Promise<void> {
  const tld = config.tld ?? "night";
  const existingContracts = config.existingContracts ?? {};

  // Validate
  validateConfig(config);

  // Sort domains topologically
  const sortedDomains = topologicalSort(config.domains, tld, existingContracts);
  logger.info(
    `Deployment order: ${sortedDomains.map((d) => d.domain).join(" -> ")}`,
  );

  // Setup network
  const networkConfig =
    config.network === "preview"
      ? makePreviewConfig()
      : config.network === "preprod"
        ? makePreprodConfig()
        : config.network === "mainnet"
          ? makeMainnetConfig()
          : makeStandaloneConfig();

  // Check services
  const servicesOk = await checkAllServices(networkConfig);
  if (!servicesOk) {
    throw new Error("Required services are unavailable");
  }

  // Determine wallet seed
  const seed = await resolveSeed(config.walletSeed);

  const walletContext = await buildWalletAndWaitForFunds(networkConfig, seed);

  try {
    const providers = await configureProviders(walletContext, networkConfig);

    // Get coin public key for wallet target
    const coinPublicKey = walletContext.shieldedSecretKeys
      .coinPublicKey as unknown as ledger.CoinPublicKey;
    const coinPublicKeyBytes = new Uint8Array(
      (coinPublicKey as any).raw ||
        Buffer.from(coinPublicKey.toString().replace("0x", ""), "hex"),
    );
    const ownerAddressBytes = new Uint8Array(
      Buffer.from(
        walletContext.unshieldedKeystore.getAddress().toString().replace("0x", ""),
        "hex",
      ),
    );

    const secretKeyHex = process.env.MIDNIGHT_SECRET_KEY;
    if (!secretKeyHex) {
      throw new Error("MIDNIGHT_SECRET_KEY env variable is required");
    }
    // In a plain batch deploy the deployer owns every domain it creates.
    const ownerDerivedKey = deriveOwnerPublicKey(hexToBytes(secretKeyHex));

    // Track deployed contracts: domain -> contract
    const deployedContracts: Map<
      string,
      | FoundContract<any>
      | DeployedContract<any>
    > = new Map();

    // Load existing contracts
    for (const [domain, address] of Object.entries(existingContracts)) {
      logger.info(`Loading existing contract for "${domain}" at ${address}`);
      const found = await findDeployedContract(providers, {
        contractAddress: address,
        compiledContract: leafContractInstance as any,
        privateStateId: "namespacePrivateState",
        initialPrivateState: { secretKey: secretKeyHex },
      });
      deployedContracts.set(domain, found);
    }

    // Deploy/join TLD
    let rootContract:
      | FoundContract<any>
      | DeployedContract<any>;

    if (config.tldContractAddress) {
      logger.info(
        `Joining existing TLD contract: ${config.tldContractAddress}`,
      );
      rootContract = await findDeployedContract(providers, {
        contractAddress: config.tldContractAddress,
        compiledContract: leafContractInstance as any,
        privateStateId: "namespacePrivateState",
        initialPrivateState: { secretKey: secretKeyHex },
      });
    } else {
      const tldSettings = resolveDomainSettings(undefined, config.defaults);
      rootContract = await deployLeafContract(
        providers,
        null,
        "0x" + ZERO_ADDR,
        coinPublicKeyBytes,
        ownerDerivedKey,
        ownerAddressBytes,
        secretKeyHex,
        tld,
        [],
        tldSettings,
      );
    }
    deployedContracts.set(tld, rootContract);

    // Deploy each domain in sorted order
    for (const entry of sortedDomains) {
      // Wait for indexer to catch up, then sync wallet state
      logger.info("Waiting for indexer to process recent blocks...");
      await new Promise((r) => setTimeout(r, 6_500));
      logger.info("Syncing wallet state before next deployment...");
      await waitForSync(walletContext.wallet);
      await displayWalletBalances(walletContext.wallet);

      // Re-register dust if depleted (only Night UTXOs)
      const hasDust = await registerNightForDust(walletContext);
      if (!hasDust) {
        logger.warn("Dust depleted — waiting for dust regeneration...");
      }

      const parts = entry.domain.split(".");
      const domainName = parts[0];
      const parentDomainPath = parts.length > 1 ? parts.slice(1).join(".") : tld;

      const parentContract = deployedContracts.get(parentDomainPath);
      if (!parentContract) {
        throw new Error(
          `Parent contract for "${parentDomainPath}" not found — this should not happen after topological sort`,
        );
      }

      const domainSettings = resolveDomainSettings(entry.settings, config.defaults);
      const domainContract = await deployLeafContract(
        providers,
        parentDomainPath,
        parentContract.deployTxData.public.contractAddress,
        coinPublicKeyBytes,
        ownerDerivedKey,
        ownerAddressBytes,
        secretKeyHex,
        domainName,
        entry.fields,
        domainSettings,
      );

      deployedContracts.set(entry.domain, domainContract);

      // Wait for deploy TX to settle before buying
      logger.info("Waiting for deploy TX to settle...");
      await new Promise((r) => setTimeout(r, 6_500));
      await waitForSync(walletContext.wallet);

      await buyDomainFor(
        parentContract,
        ownerDerivedKey,
        domainName,
        domainContract.deployTxData.public.contractAddress,
        providers,
      );
    }

    // Print results
    logger.info("\n=== Deployed Contracts ===");
    const results: Record<string, string> = {};
    for (const [domain, contract] of deployedContracts) {
      const addr = contract.deployTxData.public.contractAddress;
      results[domain] = addr;
      logger.info(`${domain}: ${addr}`);
    }

    // Also output as JSON for scripting
    console.log(JSON.stringify(results, null, 2));

    // Build frontend-compatible backup
    const exportPassword = process.env.EXPORT_PASSWORD;
    if (!exportPassword) {
      throw new Error("EXPORT_PASSWORD env variable is required for private state export");
    }
    logger.info("\n=== Building Frontend Backup ===");

    const psp = providers.privateStateProvider as any;
    const tldAddr = rootContract.deployTxData.public.contractAddress;

    // Compute derivedKey = sha256(secretKeyBytes) — matches Compact's persistentHash
    const derivedKey = createHash("sha256").update(Buffer.from(secretKeyHex, "hex")).digest("hex");

    // Encrypt the secret key for the export file
    const { pbkdf2Sync } = await import("crypto");
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const encKey = pbkdf2Sync(exportPassword, salt, 100_000, 32, "sha256");
    const cipher = createCipheriv("aes-256-gcm", encKey, iv);
    const encrypted = Buffer.concat([cipher.update(secretKeyHex, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedSecretKey = {
      data: Buffer.concat([encrypted, authTag]).toString("hex"),
      salt: salt.toString("hex"),
      iv: iv.toString("hex"),
    };

    // Build key registry with encrypted secret key
    const keyRegistry = [{
      id: crypto.randomUUID(),
      derivedKey,
      label: "batch-deploy",
      domains: Array.from(deployedContracts.keys()),
      contractAddresses: Array.from(deployedContracts.values()).map(
        (c) => c.deployTxData.public.contractAddress,
      ),
      createdAt: Date.now(),
      encryptedSecretKey,
    }];

    // Export signing keys
    psp.setContractAddress(tldAddr);
    const signingKeys = await psp.exportSigningKeys({ password: exportPassword });
    logger.info("Exported signing keys");

    const exportData = {
      keyRegistry,
      signingKeys,
      exportedAt: new Date().toISOString(),
    };

    const exportPath = path.resolve("batch-deploy-private-state-export.json");
    fs.writeFileSync(exportPath, JSON.stringify(exportData, null, 2), "utf-8");
    logger.info(`Frontend backup written to: ${exportPath}`);
  } finally {
    logger.info("Serializing wallet state...");
    await cacheWalletState(networkConfig.networkId, walletContext);

    try {
      await walletContext.wallet.stop();
      logger.info("Wallet closed");
    } catch (e) {
      logger.error(`Error closing wallet: ${e}`);
    }
  }
}

// ─── CLI Entry ──────────────────────────────────────────────────────────────
if (import.meta.main) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error(
      "Usage: bun run batch-deploy.ts <config-file.ts>\n\nExample: bun run src/test/batch-deploy.ts src/test/example-deploy.config.ts",
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(configPath);
  const configModule = await import(resolvedPath);
  const deployConfig: BatchDeployConfig = configModule.config;

  if (!deployConfig) {
    console.error(
      `Config file must export a "config" named export of type BatchDeployConfig`,
    );
    process.exit(1);
  }

  await batchDeploy(deployConfig);
}

export { batchDeploy };

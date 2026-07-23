import * as ledger from "@midnight-ntwrk/ledger-v8";
import { nativeToken } from "@midnight-ntwrk/ledger-v8";
import {
  type MidnightProvider,
  type WalletProvider,
} from "@midnight-ntwrk/midnight-js-types";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import type { ContractProviders } from "@midnight-ntwrk/midnight-js-contracts";

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

import * as Rx from "rxjs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import { WebSocket } from "ws";
import { Buffer } from "buffer";
import * as bip39 from "@scure/bip39";

// @ts-expect-error: Needed for WebSocket usage through apollo
globalThis.WebSocket = WebSocket;

// ─── Constants ───────────────────────────────────────────────────────────────

export const TEST_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

export const ATTACKER_MNEMONIC =
  "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";

const COMPOSE_FILE = path.resolve(
  import.meta.dirname,
  "undeployed.yml",
);

const MIDNIGHT_LOCAL_NETWORK_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
  "midnight-local-network",
);

const ZK_CONFIG_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "managed",
  "leaf",
);

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NetworkConfig {
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly networkId: string;
}

export interface WalletContext {
  wallet: WalletFacade;
  shieldedSecretKeys: ledger.ZswapSecretKeys;
  dustSecretKey: ledger.DustSecretKey;
  unshieldedKeystore: UnshieldedKeystore;
}

type UnboundTransaction = ledger.Transaction<
  ledger.SignatureEnabled,
  ledger.Proof,
  ledger.PreBinding
>;

export interface TestContext {
  walletContext: WalletContext;
  providers: ContractProviders;
  networkConfig: NetworkConfig;
}

// ─── Network Config ──────────────────────────────────────────────────────────

function makeStandaloneConfig(): NetworkConfig {
  return {
    indexer: "http://127.0.0.1:8088/api/v3/graphql",
    indexerWS: "ws://127.0.0.1:8088/api/v3/graphql/ws",
    node: "ws://127.0.0.1:9944",
    proofServer: "http://127.0.0.1:6300",
    networkId: "undeployed",
  };
}

// ─── Docker ──────────────────────────────────────────────────────────────────

export function startDocker(): void {
  console.log("[e2e] Starting local network via docker compose...");
  execSync(`docker compose -f "${COMPOSE_FILE}" up -d`, {
    shell: true as any,
    stdio: "inherit",
    timeout: 120_000,
  });
}

export function stopDocker(): void {
  console.log("[e2e] Stopping local network...");
  execSync(`docker compose -f "${COMPOSE_FILE}" down`, {
    shell: true as any,
    stdio: "inherit",
    timeout: 60_000,
  });
}

async function waitForServiceHealth(
  url: string,
  label: string,
  fetchOpts?: RequestInit,
  maxRetries = 30,
  intervalMs = 2_000,
): Promise<void> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, fetchOpts);
      if (res.ok) {
        console.log(`[e2e] ${label} is healthy`);
        return;
      }
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`[e2e] ${label} did not become healthy after ${maxRetries * intervalMs / 1000}s`);
}

async function waitForServices(config: NetworkConfig): Promise<void> {
  console.log("[e2e] Waiting for services to be healthy...");
  // Node has a /health endpoint
  await waitForServiceHealth("http://127.0.0.1:9944/health", "Node");
  // Indexer is a GraphQL endpoint — needs POST
  await waitForServiceHealth(config.indexer, "Indexer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ __typename }" }),
  });
  // Proof server - just check it responds
  await waitForServiceHealth(config.proofServer, "Proof Server");
}

// ─── Funding ─────────────────────────────────────────────────────────────────

export function fundWallet(mnemonic: string): void {
  console.log("[e2e] Funding test wallet via midnight-local-network...");
  execSync(`yarn fund "${mnemonic}"`, {
    cwd: MIDNIGHT_LOCAL_NETWORK_DIR,
    shell: true as any,
    stdio: "inherit",
    timeout: 120_000,
  });
  console.log("[e2e] Funding complete");
}

// ─── Wallet ──────────────────────────────────────────────────────────────────

async function mnemonicToSeed(mnemonic: string): Promise<Buffer> {
  const seed = await bip39.mnemonicToSeed(mnemonic, "");
  return Buffer.from(seed);
}

async function initWalletWithSeed(
  seed: Buffer,
  config: NetworkConfig,
): Promise<WalletContext> {
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
    config.networkId,
  );

  // Every wallet writes its own section into the same entry (keyed by tx hash), so shielded,
  // unshielded, dust and the facade all share one store.
  const baseConfiguration = {
    networkId: config.networkId,
    costParameters: {
      additionalFeeOverhead: 1_000_000_000n,
      feeBlocksMargin: 5,
    },
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(
      TransactionHistoryStorage.TransactionHistoryCommonSchema,
    ),
  };

  const shieldedWallet = ShieldedWallet(baseConfiguration).startWithSecretKeys(
    shieldedSecretKeys,
  );
  const dustWallet = DustWallet(baseConfiguration).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );
  const unshieldedWallet = UnshieldedWallet(
    baseConfiguration,
  ).startWithPublicKey(UnshieldedPublicKey.fromKeyStore(unshieldedKeystore));

  const wallet = await WalletFacade.init({
    configuration: {
      ...baseConfiguration,
      relayURL: new URL(config.node),
      provingServerUrl: new URL(config.proofServer),
    },
    shielded: async () => shieldedWallet,
    unshielded: async () => unshieldedWallet,
    dust: async () => dustWallet,
  });
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return { wallet, shieldedSecretKeys, dustSecretKey, unshieldedKeystore };
}

// ─── Wallet Lifecycle ────────────────────────────────────────────────────────

export const waitForSync = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((state) => state.isSynced),
    ),
  );

export const getUnshieldedBalance = async (wallet: WalletFacade): Promise<bigint> => {
  const state = await Rx.firstValueFrom(
    wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );
  return state.unshielded?.balances[nativeToken().raw] ?? 0n;
};

export const waitForBalanceChange = (
  wallet: WalletFacade,
  previousBalance: bigint,
  timeoutMs = 120_000,
): Promise<bigint> =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => s.isSynced),
      Rx.map((s) => s.unshielded?.balances[nativeToken().raw] ?? 0n),
      Rx.filter((balance) => balance !== previousBalance),
      Rx.timeout(timeoutMs),
    ),
  );

export const waitForFunds = (wallet: WalletFacade) =>
  Rx.firstValueFrom(
    wallet.state().pipe(
      Rx.throttleTime(10_000),
      Rx.filter((state) => state.isSynced),
      Rx.map(
        (s) =>
          (s.unshielded?.balances[nativeToken().raw] ?? 0n) +
          (s.shielded?.balances[nativeToken().raw] ?? 0n),
      ),
      Rx.filter((balance) => balance > 0n),
    ),
  );

export const registerNightForDust = async (
  walletContext: WalletContext,
): Promise<boolean> => {
  const state = await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  const unregisteredNightUtxos =
    state.unshielded?.availableCoins.filter(
      (coin) =>
        coin.utxo.type ===
          "0000000000000000000000000000000000000000000000000000000000000000" &&
        coin.meta.registeredForDustGeneration === false,
    ) ?? [];

  if (unregisteredNightUtxos.length === 0) {
    const dustBalance = state.dust
      ? state.dust.capabilities.coinsAndBalances.getWalletBalance(
          state.dust.state,
          new Date(),
        )
      : 0n;
    return dustBalance > 0n;
  }

  console.log(
    `[e2e] Found ${unregisteredNightUtxos.length} unregistered Night UTXOs, registering for dust...`,
  );

  const recipe =
    await walletContext.wallet.registerNightUtxosForDustGeneration(
      unregisteredNightUtxos,
      walletContext.unshieldedKeystore.getPublicKey(),
      (payload) => walletContext.unshieldedKeystore.signData(payload),
    );

  const finalizedTx = await walletContext.wallet.finalizeTransaction(
    recipe.transaction,
  );
  await walletContext.wallet.submitTransaction(finalizedTx);

  await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(
      Rx.throttleTime(5_000),
      Rx.filter((s) => {
        const dustBalance = s.dust
          ? s.dust.capabilities.coinsAndBalances.getWalletBalance(
              s.dust.state,
              new Date(),
            )
          : 0n;
        return dustBalance > 0n;
      }),
    ),
  );

  console.log("[e2e] Dust registration complete");
  return true;
};

// ─── Provider Config ─────────────────────────────────────────────────────────

async function configureProviders(
  walletContext: WalletContext,
  config: NetworkConfig,
  accountId = "e2e-test",
): Promise<ContractProviders> {
  setNetworkId(config.networkId);

  await Rx.firstValueFrom(
    walletContext.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  const walletAndMidnightProvider: WalletProvider & MidnightProvider = {
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
      const recipe = await walletContext.wallet.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: walletContext.shieldedSecretKeys,
          dustSecretKey: walletContext.dustSecretKey,
        },
        { ttl: txTtl },
      );
      const signSegment = (data: Uint8Array) =>
        walletContext.unshieldedKeystore.signData(data);
      const signedRecipe = await walletContext.wallet.signRecipe(
        recipe,
        signSegment,
      );
      return await walletContext.wallet.finalizeRecipe(signedRecipe);
    },
    async submitTx(
      tx: ledger.FinalizedTransaction,
    ): Promise<ledger.TransactionId> {
      return await walletContext.wallet.submitTransaction(tx);
    },
  };

  const zkConfig = new NodeZkConfigProvider<string>(ZK_CONFIG_PATH);

  return {
    privateStateProvider: levelPrivateStateProvider<"namespacePrivateState">({
      privateStoragePasswordProvider: () => "e2e-test-P4ssword!not-secret",
      accountId,
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
}

// ─── Main Setup/Teardown ─────────────────────────────────────────────────────

const NO_UP = process.argv.includes("--no-up") || process.env.E2E_NO_UP === "1";

export async function setupTestEnvironment(): Promise<TestContext> {
  // 1. Start docker (unless --no-up)
  if (!NO_UP) {
    startDocker();
  } else {
    console.log("[e2e] Skipping docker compose up (--no-up)");
  }

  // 2. Network config
  const networkConfig = makeStandaloneConfig();
  setNetworkId(networkConfig.networkId);

  // 3. Wait for services
  await waitForServices(networkConfig);

  // 4. Fund wallet
  fundWallet(TEST_MNEMONIC);

  // 4.5. Wait for indexer to process funding tx
  console.log("[e2e] Waiting for indexer to process funding tx...");
  await new Promise((r) => setTimeout(r, 10_000));

  // 5. Initialize wallet
  console.log("[e2e] Initializing wallet...");
  const seed = await mnemonicToSeed(TEST_MNEMONIC);
  const walletContext = await initWalletWithSeed(seed, networkConfig);

  // 6. Wait for sync + funds
  console.log("[e2e] Waiting for wallet sync...");
  await waitForSync(walletContext.wallet);
  console.log("[e2e] Waiting for funds...");
  await waitForFunds(walletContext.wallet);

  // 7. Register dust if needed
  await registerNightForDust(walletContext);

  // 8. Configure providers
  console.log("[e2e] Configuring providers...");
  const providers = await configureProviders(walletContext, networkConfig);

  console.log("[e2e] Setup complete!");
  return { walletContext, providers, networkConfig };
}

export async function setupAdditionalWallet(
  networkConfig: NetworkConfig,
  mnemonic: string,
  label: string,
): Promise<TestContext> {
  fundWallet(mnemonic);
  console.log(`[e2e] Waiting for indexer to process ${label} funding tx...`);
  await new Promise((r) => setTimeout(r, 10_000));

  console.log(`[e2e] Initializing ${label} wallet...`);
  const seed = await mnemonicToSeed(mnemonic);
  const walletContext = await initWalletWithSeed(seed, networkConfig);

  await waitForSync(walletContext.wallet);
  await waitForFunds(walletContext.wallet);
  await registerNightForDust(walletContext);

  const providers = await configureProviders(walletContext, networkConfig, `e2e-${label}`);
  console.log(`[e2e] ${label} wallet ready`);
  return { walletContext, providers, networkConfig };
}

export async function teardownTestEnvironment(
  ctx: TestContext,
): Promise<void> {
  try {
    await ctx.walletContext.wallet.stop();
  } catch {
    // ignore shutdown errors
  }
  stopDocker();
}

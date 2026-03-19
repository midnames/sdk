import { type Wallet } from "@midnight-ntwrk/wallet-api";
import { nativeToken } from "@midnight-ntwrk/ledger";
import {
  getLedgerNetworkId,
  getZswapNetworkId,
  NetworkId,
  setNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import { type Resource, WalletBuilder } from "@midnight-ntwrk/wallet";
import * as Rx from "rxjs";
import { type Logger } from "pino";
import pinoPretty from "pino-pretty";
import pino from "pino";

// Configuration interfaces
export interface Config {
  readonly logDir: string;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
}

class TestnetConfig implements Config {
  logDir = "";
  indexer = "https://indexer.testnet-02.midnight.network/api/v1/graphql";
  indexerWS = "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";
  node = "https://rpc.testnet-02.midnight.network";
  proofServer = "http://127.0.0.1:6300";
  constructor() {
    setNetworkId(NetworkId.TestNet);
  }
}

class StandaloneConfig implements Config {
  logDir = "";
  indexer = "http://127.0.0.1:8088/api/v1/graphql";
  indexerWS = "ws://127.0.0.1:8088/api/v1/graphql/ws";
  node = "http://127.0.0.1:9944";
  proofServer = "http://127.0.0.1:6300";
  constructor() {
    setNetworkId(NetworkId.Undeployed);
  }

  // Detect running Docker container ports
  async detectRunningContainerPorts() {
    try {
      const { execSync } = await import("node:child_process");

      // Get indexer port from running container
      const indexerOutput = execSync("docker port counter-indexer 8088/tcp", {
        encoding: "utf8",
      });
      const indexerPort = indexerOutput.split("\n")[0].split(":")[1];
      if (indexerPort) {
        this.indexer = `http://127.0.0.1:${indexerPort}/api/v1/graphql`;
        this.indexerWS = `ws://127.0.0.1:${indexerPort}/api/v1/graphql/ws`;
      }

      // Get node port from running container
      const nodeOutput = execSync("docker port counter-node 9944/tcp", {
        encoding: "utf8",
      });
      const nodePort = nodeOutput.split("\n")[0].split(":")[1];
      if (nodePort) {
        this.node = `http://127.0.0.1:${nodePort}`;
      }

      // Get proof server port from running container
      const proofOutput = execSync(
        "docker port counter-proof-server 6300/tcp",
        { encoding: "utf8" }
      );
      const proofPort = proofOutput.split("\n")[0].split(":")[1];
      if (proofPort) {
        this.proofServer = `http://127.0.0.1:${proofPort}`;
      }
    } catch (error) {
      console.log(
        "Could not detect running Docker container ports, using default ports"
      );
      console.log("Make sure Docker containers are running: docker ps");
    }
  }
}

// Logger setup
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
    customColors: {
      debug: "green",
    },
  })
);

// Default seeds for different networks
const GENESIS_MINT_WALLET_SEED =
  "0000000000000000000000000000000000000000000000000000000000000001";
const TESTNET_DEFAULT_SEED =
  "557beb4d4bd5c88948712fd375b20f44ed9f38ade5e6ee8c27ece84d26de1639";

export const buildWallet = async (
  { indexer, indexerWS, node, proofServer }: Config,
  seed: string
): Promise<Wallet & Resource> => {
  logger.info("Building wallet from seed...");
  const wallet = await WalletBuilder.buildFromSeed(
    indexer,
    indexerWS,
    proofServer,
    node,
    seed,
    getZswapNetworkId(),
    "info"
  );
  wallet.start();
  return wallet;
};

function formatBalance(balance: bigint): string {
  // Assuming tDUST has 9 decimal places
  const divisor = 1_000_000_000n;
  const whole = balance / divisor;
  const fraction = balance % divisor;
  
  // Format with decimal point
  const fractionStr = fraction.toString().padStart(9, '0');
  const trimmedFraction = fractionStr.replace(/0+$/, ''); // Remove trailing zeros
  
  if (trimmedFraction === '') {
    return `${whole}`;
  } else {
    return `${whole}.${trimmedFraction}`;
  }
}

function showUsage() {
  console.log(`
🚀 Midnight Wallet Balance Monitor

Usage:
  bun run wallet.ts <network> [seed]

Networks:
  standalone    Connect to local standalone network
  testnet      Connect to remote testnet

Seed:
  Optional wallet seed (hex string)
  If not provided, uses default seed for the network

Examples:
  bun run wallet.ts testnet
  bun run wallet.ts standalone
  bun run wallet.ts testnet 557beb4d4bd5c88948712fd375b20f44ed9f38ade5e6ee8c27ece84d26de1639

Environment Variables:
  WALLET_SEED    Set wallet seed via environment variable
  DEBUG_LEVEL    Set log level (debug, info, warn, error)
`);
}

async function main() {
  const args = process.argv.slice(2);
  const networkType = args[0];

  if (!networkType || !["testnet", "standalone"].includes(networkType)) {
    showUsage();
    process.exit(1);
  }

  // Get seed from args, env, or use default
  let seed = args[1] || process.env.WALLET_SEED;
  if (!seed) {
    seed = networkType === "standalone" ? GENESIS_MINT_WALLET_SEED : TESTNET_DEFAULT_SEED;
    logger.info(`Using default seed for ${networkType}`);
  }

  logger.info(`Starting wallet monitor for ${networkType} network`);

  // Configure network
  let config: Config;
  if (networkType === "testnet") {
    config = new TestnetConfig();
  } else {
    config = new StandaloneConfig();
    // Detect running Docker container ports
    await (config as StandaloneConfig).detectRunningContainerPorts();
    logger.info(
      `Using ports - Indexer: ${config.indexer}, Node: ${config.node}, Proof: ${config.proofServer}`
    );
  }

  let wallet: (Wallet & Resource) | null = null;

  try {
    // Build wallet
    wallet = await buildWallet(config, seed);

    // Get initial state
    const initialState = await Rx.firstValueFrom(wallet.state());
    logger.info(`Wallet address: ${initialState.address}`);
    logger.info(`Encryption public key: ${initialState.encryptionPublicKey}`);
    logger.info(`Coin public key: ${initialState.coinPublicKey}`);

    // Monitor wallet state
    logger.info("Starting balance monitor (Ctrl+C to exit)...\n");
    
    let lastBalance: bigint | undefined = undefined;
    let lastTxCount = 0;
    let lastBlockHeight: bigint | undefined = undefined;
    
    const subscription = wallet.state().pipe(
      Rx.throttleTime(2000), // Update every 2 seconds
    ).subscribe((state) => {
      const balance = state.balances[nativeToken()] ?? 0n;
      const applyGap = state.syncProgress?.lag.applyGap ?? 0n;
      const sourceGap = state.syncProgress?.lag.sourceGap ?? 0n;
      const synced = state.syncProgress?.synced ? "✓" : "⟳";
      const txCount = state.transactionHistory.length;
      
      // Check if significant changes occurred
      const balanceChanged = lastBalance !== undefined && lastBalance !== balance;
      const txCountChanged = lastTxCount !== txCount;
      
      // Build status line
      const statusLine = 
        `[${new Date().toLocaleTimeString()}] ` +
        `Balance: ${formatBalance(balance)} tDUST | ` +
        `Sync: ${synced} | ` +
        `Backend lag: ${sourceGap} | ` +
        `Wallet lag: ${applyGap} | ` +
        `Txs: ${txCount}`;
      
      // Add change indicators
      const changes = [];
      if (balanceChanged) changes.push(`Balance: ${formatBalance(lastBalance!)} → ${formatBalance(balance)}`);
      if (txCountChanged) changes.push(`New txs: ${txCount - lastTxCount}`);
      
      if (changes.length > 0) {
        console.log(statusLine + ` | ⚡ ${changes.join(', ')}`);
      } else {
        console.log(statusLine);
      }
      
      // Update last values
      lastBalance = balance;
      lastTxCount = txCount;
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('\n\nShutting down wallet monitor...');
      subscription.unsubscribe();
      if (wallet) {
        await wallet.close();
        logger.info('Wallet closed');
      }
      process.exit(0);
    });

    // Keep the process running
    await new Promise(() => {});
    
  } catch (error) {
    logger.error("Wallet monitor failed:", error);
    throw error;
  } finally {
    if (wallet) {
      await wallet.close();
      logger.info("Wallet closed");
    }
  }
}

if (import.meta.main) {
  main().catch(console.error);
}
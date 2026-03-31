import { type Wallet } from "@midnight-ntwrk/wallet-api";
import {
  createCoinInfo,
  encodeContractAddress,
  nativeToken,
} from "@midnight-ntwrk/ledger";
import * as whd from "@midnight-ntwrk/wallet-sdk-hd";
import {
  getZswapNetworkId,
  NetworkId,
  setNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import { type Resource } from "@midnight-ntwrk/wallet";
import {
  findDeployedContract,
  deployContract,
  type ContractProviders,
} from "@midnight-ntwrk/midnight-js-contracts";
import {
  MidnightBech32m,
  ShieldedCoinPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";

import { CompiledContract } from "@midnight-ntwrk/compact-js";
import { Leaf } from "../../dist";
import { witnesses } from "../../dist/witnesses";

// Import MidnamesSDK
import {
  resolveDomain,
  getDomainProfile,
  getDomainInfo,
  getDomainFields,
  getDomainSettings,
  // Import operations
  insertField as sdkInsertField,
  clearField as sdkClearField,
  clearAllFields as sdkClearAllFields,
  addMultipleFields as sdkAddMultipleFields,
  updateDomainTarget as sdkUpdateDomainTarget,
  updateDomainCost as sdkUpdateDomainCost,
  updateDomainColor as sdkUpdateDomainColor,
  registerDomainFor as sdkRegisterDomainFor,
  buyDomainFor as sdkBuyDomainFor,
  type Result,
} from "../../../midnames-sdk";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";

import { type Logger } from "pino";
import pinoPretty from "pino-pretty";
import pino from "pino";
import * as bip39 from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english";

// Import configurations and helper functions from full.ts
import {
  type Config,
  TestnetConfig,
  StandaloneConfig,
  buildWalletAndWaitForFunds,
  configureProviders,
} from "./full";

// JSON output mode detection
const isJSONMode = process.env.OUTPUT_MODE === 'json';

// Logger setup - suppress output in JSON mode
const logger: Logger = isJSONMode 
  ? pino({ level: 'silent' }) // Silent in JSON mode
  : pino(
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

// Leaf contract instance - need zkConfigPath for CompiledContract
const contractZkConfigPath = new URL("../../dist/managed/leaf", import.meta.url).pathname;
const leafContractInstance = CompiledContract.make("leaf-contract", Leaf.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(contractZkConfigPath),
);

// Helper function to convert BIP39 mnemonic to seed using HD derivation
async function mnemonicToSeed(mnemonic: string): Promise<string> {
  if (!bip39.validateMnemonic(mnemonic, english)) {
    throw new Error("Invalid BIP39 mnemonic");
  }
  
  // Convert mnemonic to BIP39 seed (512 bits)
  const bip39Seed = await bip39.mnemonicToSeed(mnemonic, ""); // Empty passphrase
  
  // Use HD derivation with Midnight's path: m/44'/2400'/0'/3/0 (Zswap role)
  const hdWalletResult = whd.HDWallet.fromSeed(bip39Seed);
  
  if (hdWalletResult.type !== 'seedOk') {
    throw new Error(`Failed to create HD wallet: ${hdWalletResult.error}`);
  }
  
  // Derive key for Zswap role (role 3, index 0)
  const derivationResult = hdWalletResult.hdWallet
    .selectAccount(0)
    .selectRole(whd.Roles.Zswap)  // Role 3
    .deriveKeyAt(0);
  
  if (derivationResult.type !== 'keyDerived') {
    throw new Error("Failed to derive key");
  }
  
  // Convert to hex string (32 bytes)
  return Buffer.from(derivationResult.key).toString('hex');
}

// Helper function to get seed from environment or parameter
async function getSeedFromEnv(): Promise<string> {
  const seedEnv = process.env.SEED;
  if (!seedEnv) {
    throw new Error("SEED environment variable is required");
  }
  
  // Check if it's a hex seed (64 chars) or BIP39 mnemonic
  if (/^[0-9a-fA-F]{64}$/.test(seedEnv)) {
    // It's already a hex seed
    return seedEnv;
  } else {
    // Assume it's a BIP39 mnemonic
    return await mnemonicToSeed(seedEnv);
  }
}

// Helper function to determine if a command is read-only (doesn't need wallet)
function isReadOnlyCommand(command: string): boolean {
  const readOnlyCommands = ['query', 'resolve', 'info', 'fields', 'settings'];
  return readOnlyCommands.includes(command);
}

// Helper function to parse domain string and validate format
function parseDomainName(domain: string): { domainName: string; parentDomain: string; isValid: boolean } {
  const parts = domain.split('.');
  if (parts.length < 2 || parts[parts.length - 1] !== 'night') {
    return { domainName: '', parentDomain: '', isValid: false };
  }
  
  if (parts.length === 2) {
    // Top-level domain like "domain.night"
    return {
      domainName: parts[0],
      parentDomain: 'night',
      isValid: true
    };
  } else {
    // Subdomain like "sub.domain.night"
    return {
      domainName: parts[0],
      parentDomain: parts.slice(1).join('.'),
      isValid: true
    };
  }
}

// Helper function to get domain's resolver contract address using SDK
async function getDomainResolverAddress(
  publicDataProvider: any,
  fullDomain: string
): Promise<string | null> {
  try {
    // Use the SDK's domain profile to get the contract address
    const result = await getDomainProfile(fullDomain, { provider: publicDataProvider });
    if (!result.success) {
      return null;
    }
    return result.data.info?.resolver || null;
  } catch {
    return null;
  }
}

// Helper function to create a valid CoinInfo for payment
function createPaymentCoin(value: bigint = 1n) {
  const coinInfo = createCoinInfo(nativeToken(), value);
  return {
    nonce: new Uint8Array(Buffer.from(coinInfo.nonce, 'hex')),
    color: encodeContractAddress(nativeToken()),
    value: coinInfo.value,
  };
}

// Helper function to parse address
function parseAddress(address: string): { bytes: Uint8Array } {
  const bech32Parsed = MidnightBech32m.parse(address);
  const coinPublicKey = ShieldedCoinPublicKey.codec.decode(
    getZswapNetworkId(),
    bech32Parsed
  );
  return { bytes: new Uint8Array(coinPublicKey.data) };
}

// Helper function to parse contract addresses properly
function parseContractAddress(address: string): { bytes: Uint8Array } {
  let hexString: string;
  
  if (address.startsWith("0200")) {
    // SDK format: remove "0200" prefix
    hexString = address.slice(4);
  } else if (address.startsWith("0x")) {
    // Hex format: remove "0x" prefix
    hexString = address.slice(2);
  } else {
    // Assume raw hex
    hexString = address;
  }
  
  const bytes = new Uint8Array(Buffer.from(hexString, "hex"));
  // Ensure exactly 32 bytes
  return { bytes: bytes.length === 32 ? bytes : bytes.subarray(-32) };
}

// Helper function to parse target (wallet or contract address)
function parseTarget(target: string): { tag: "Left"; value: { bytes: Uint8Array } } | { tag: "Right"; value: string } {
  if (target.startsWith("0x") || target.startsWith("02")) {
    // Contract address
    return {
      tag: "Right",
      value: target
    };
  } else {
    // Wallet address
    return {
      tag: "Left",
      value: parseAddress(target)
    };
  }
}

// Helper to handle SDK Results
function handleResult<T>(result: Result<T>, context: string): T {
  if (!result.success) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data;
}

// JSON output helpers
interface JSONResponse {
  success: boolean;
  command: string;
  domain?: string;
  data?: any;
  error?: string;
  metadata: {
    network?: string;
    timestamp: string;
  };
}

function createJSONResponse(
  success: boolean, 
  command: string, 
  domain?: string,
  data?: any, 
  error?: string,
  network?: string
): JSONResponse {
  return {
    success,
    command,
    domain,
    data: data || null,
    error: error || null,
    metadata: {
      network,
      timestamp: new Date().toISOString()
    }
  };
}

function outputJSON(response: JSONResponse) {
  console.log(JSON.stringify(response, null, 2));
}

function logOrCollect(message: string, data?: any) {
  if (!isJSONMode) {
    if (data) {
      logger.info(message, data);
    } else {
      logger.info(message);
    }
  }
  // In JSON mode, we collect data and output at the end
}

// Helper to join a domain's contract
async function joinDomainContract(
  providers: ContractProviders<typeof leafContractInstance>,
  domainContractAddress: string
) {
  return await findDeployedContract(providers, {
    contractAddress: domainContractAddress,
    contract: leafContractInstance,
    privateStateId: "namespacePrivateState",
    initialPrivateState: { secretKey: "0".repeat(64) },
  });
}

// =========================================
//              QUERY COMMANDS
// =========================================

async function queryDomain(
  publicDataProvider: any,
  fullDomain: string,
  networkType?: string
) {
  logOrCollect(`Querying domain: ${fullDomain}`);
  
  const result = await getDomainProfile(fullDomain, { provider: publicDataProvider });
  const profile = handleResult(result, "Get domain profile");
  
  if (isJSONMode) {
    // Format data for JSON output
    const jsonData = {
      domain: profile.fullDomain,
      resolvedTarget: profile.resolvedTarget || null,
      info: profile.info || null,
      settings: profile.settings ? {
        coinColor: `0x${Buffer.from(profile.settings.coinColor).toString('hex')}`,
        costs: {
          short: profile.settings.costs.short.toString(),
          medium: profile.settings.costs.medium.toString(),
          long: profile.settings.costs.long.toString(),
        }
      } : null,
      fields: profile.fields.length > 0 ? Object.fromEntries(profile.fields) : {}
    };
    
    return createJSONResponse(true, "query", fullDomain, jsonData, undefined, networkType);
  } else {
    // Original logger output
    logger.info(`=== Domain Profile: ${profile.fullDomain} ===`);
    logger.info(`Resolved Target: ${profile.resolvedTarget || 'N/A'}`);
    
    if (profile.info) {
      logger.info(`Owner: ${profile.info.owner}`);
      logger.info(`Resolver: ${profile.info.resolver}`);
      if (profile.info.contractAddress) {
        logger.info(`Contract Address: ${profile.info.contractAddress}`);
      }
    }
    
    if (profile.settings) {
      logger.info(`Coin Color: 0x${Buffer.from(profile.settings.coinColor).toString('hex')}`);
      logger.info(`Domain Costs: short=${profile.settings.costs.short}, medium=${profile.settings.costs.medium}, long=${profile.settings.costs.long}`);
    }
    
    logger.info(`\n=== Domain Fields ===`);
    if (profile.fields.length > 0) {
      for (const [key, value] of profile.fields) {
        logger.info(`${key}: ${value}`);
      }
    } else {
      logger.info("No fields set");
    }
    
    return profile;
  }
}

async function resolveDomainCommand(
  publicDataProvider: any,
  fullDomain: string,
  networkType?: string
) {
  logOrCollect(`Resolving domain: ${fullDomain}`);
  
  const result = await resolveDomain(fullDomain, { provider: publicDataProvider });
  const target = handleResult(result, "Resolve domain");
  
  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      target: target
    };
    return createJSONResponse(true, "resolve", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`${fullDomain} → ${target}`);
    return target;
  }
}

async function getDomainInfo(
  publicDataProvider: any,
  fullDomain: string,
  networkType?: string
) {
  logOrCollect(`Getting domain info: ${fullDomain}`);
  
  const result = await getDomainInfo(fullDomain, { provider: publicDataProvider });
  const info = handleResult(result, "Get domain info");
  
  if (isJSONMode) {
    return createJSONResponse(true, "info", fullDomain, info, undefined, networkType);
  } else {
    logger.info(`Domain: ${fullDomain}`);
    logger.info(`Owner: ${info.owner}`);
    logger.info(`Resolver: ${info.resolver}`);
    if (info.contractAddress) {
      logger.info(`Contract Address: ${info.contractAddress}`);
    }
    return info;
  }
}

async function getDomainFieldsCommand(
  publicDataProvider: any,
  fullDomain: string,
  networkType?: string
) {
  logOrCollect(`Getting domain fields: ${fullDomain}`);
  
  const result = await getDomainFields(fullDomain, { provider: publicDataProvider });
  const fields = handleResult(result, "Get domain fields");

  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      fields: fields.length > 0 ? Object.fromEntries(fields) : {}
    };
    return createJSONResponse(true, "fields", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`=== Fields for ${fullDomain} ===`);
    if (fields.length > 0) {
      for (const [key, value] of fields) {
        logger.info(`${key}: ${value}`);
      }
    } else {
      logger.info("No fields set");
    }
    return fields;
  }
}

async function getDomainSettingsCommand(
  publicDataProvider: any,
  fullDomain: string,
  networkType?: string
) {
  logOrCollect(`Getting domain settings: ${fullDomain}`);
  
  const result = await getDomainSettings(fullDomain, { provider: publicDataProvider });
  const settings = handleResult(result, "Get domain settings");

  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      coinColor: `0x${Buffer.from(settings.coinColor).toString('hex')}`,
      costs: {
        short: settings.costs.short.toString(),
        medium: settings.costs.medium.toString(),
        long: settings.costs.long.toString(),
      }
    };
    return createJSONResponse(true, "settings", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`=== Settings for ${fullDomain} ===`);
    logger.info(`Coin Color: 0x${Buffer.from(settings.coinColor).toString('hex')}`);
    logger.info(`Domain Costs: short=${settings.costs.short}, medium=${settings.costs.medium}, long=${settings.costs.long}`);
    return settings;
  }
}

// =========================================
//              FIELD COMMANDS
// =========================================

async function insertField(
  providers: ContractProviders<typeof leafContractInstance>,
  fullDomain: string,
  key: string,
  value: string
) {
  logger.info(`Setting field ${key} = ${value} for domain: ${fullDomain}`);
  
  const result = await sdkInsertField(fullDomain, key, value, providers);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  
  logger.info(`Field updated. Tx: ${result.data.transactionId}`);
  return { public: { txId: result.data.transactionId } };
}

async function clearField(
  providers: ContractProviders<typeof leafContractInstance>,
  fullDomain: string,
  key: string,
  networkType?: string
) {
  logOrCollect(`Clearing field ${key} for domain: ${fullDomain}`);
  
  const result = await sdkClearField(fullDomain, key, providers);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  
  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      clearedField: key,
      transactionId: result.data.transactionId
    };
    return createJSONResponse(true, "clear-field", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`Field cleared. Tx: ${result.data.transactionId}`);
    return { public: { txId: result.data.transactionId } };
  }
}

async function clearAllFields(
  providers: ContractProviders<typeof leafContractInstance>,
  fullDomain: string,
  networkType?: string
) {
  logOrCollect(`Clearing all fields for domain: ${fullDomain}`);
  
  const result = await sdkClearAllFields(fullDomain, providers);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  
  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      operation: "clear_all_fields",
      transactionId: result.data.transactionId
    };
    return createJSONResponse(true, "clear-all-fields", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`All fields cleared. Tx: ${result.data.transactionId}`);
    return { public: { txId: result.data.transactionId } };
  }
}

async function addFields(
  providers: ContractProviders<typeof leafContractInstance>,
  fullDomain: string,
  fields: Array<[string, string]>,
  networkType?: string
) {
  logOrCollect(`Adding ${fields.length} fields to domain: ${fullDomain}`);
  
  if (fields.length > 10) {
    throw new Error("Maximum of 10 fields can be added at once");
  }
  
  const result = await sdkAddMultipleFields(fullDomain, fields, providers);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  
  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      fieldsAdded: Object.fromEntries(fields),
      transactionId: result.data.transactionId
    };
    return createJSONResponse(true, "add-fields", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`Fields added. Tx: ${result.data.transactionId}`);
    return { public: { txId: result.data.transactionId } };
  }
}

// =========================================
//            DOMAIN OPERATIONS
// =========================================

async function updateTarget(
  providers: ContractProviders<typeof leafContractInstance>,
  fullDomain: string,
  target: string,
  networkType?: string
) {
  logOrCollect(`Updating target for domain ${fullDomain} to: ${target}`);
  
  const result = await sdkUpdateDomainTarget(fullDomain, target, providers);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  
  const targetValue = parseTarget(target);
  
  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      newTarget: target,
      targetType: targetValue.tag === "Left" ? "wallet" : "contract",
      transactionId: result.data.transactionId
    };
    return createJSONResponse(true, "update-target", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`Target updated. Tx: ${result.data.transactionId}`);
    return { public: { txId: result.data.transactionId } };
  }
}

async function updateCost(
  providers: ContractProviders<typeof leafContractInstance>,
  fullDomain: string,
  cost: string,
  networkType?: string
) {
  logOrCollect(`Updating cost for domain ${fullDomain} to: ${cost}`);
  
  const result = await sdkUpdateDomainCost(fullDomain, BigInt(cost), providers);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  
  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      newCost: cost,
      transactionId: result.data.transactionId
    };
    return createJSONResponse(true, "update-cost", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`Cost updated. Tx: ${result.data.transactionId}`);
    return { public: { txId: result.data.transactionId } };
  }
}

async function updateColor(
  providers: ContractProviders<typeof leafContractInstance>,
  fullDomain: string,
  color: string,
  networkType?: string
) {
  logOrCollect(`Updating color for domain ${fullDomain} to: ${color}`);
  
  const colorBytes = new Uint8Array(Buffer.from(color.replace("0x", ""), "hex"));
  const result = await sdkUpdateDomainColor(fullDomain, colorBytes, providers);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  
  if (isJSONMode) {
    const jsonData = {
      domain: fullDomain,
      newColor: color.startsWith("0x") ? color : `0x${color}`,
      transactionId: result.data.transactionId
    };
    return createJSONResponse(true, "update-color", fullDomain, jsonData, undefined, networkType);
  } else {
    logger.info(`Color updated. Tx: ${result.data.transactionId}`);
    return { public: { txId: result.data.transactionId } };
  }
}

// =========================================
//            SUBDOMAIN OPERATIONS
// =========================================

async function registerSubdomain(
  providers: ContractProviders<typeof leafContractInstance>,
  parentDomain: string,
  subdomainName: string,
  owner?: string,
  networkType?: string
) {
  logOrCollect(`Registering subdomain ${subdomainName} under ${parentDomain}`);
  
  const parentContractAddress = await getDomainResolverAddress(providers.publicDataProvider, parentDomain);
  if (!parentContractAddress) {
    throw new Error("Could not find parent domain resolver contract");
  }
  
  // Get parent domain settings for the new contract
  const parentSettingsResult = await getDomainSettings(parentDomain, { provider: providers.publicDataProvider });
  const parentSettings = handleResult(parentSettingsResult, "Get parent domain settings");
  
  // Deploy new leaf contract for the subdomain
  const targetAddress = owner ? parseAddress(owner) : parseAddress(providers.walletProvider.coinPublicKey);
  
  const targetEither = {
    is_left: true,
    left: targetAddress,
    right: { bytes: new Uint8Array(32) },
  };
  
  const deployedContract = await deployContract(providers, {
    compiledContract: leafContractInstance,
    privateStateId: "namespacePrivateState",
    initialPrivateState: { secretKey: "0".repeat(64) },
    args: [
      // Parent domain
      { is_some: true, value: parentDomain },
      // Parent resolver address
      parseContractAddress(parentContractAddress),
      // Domain target
      targetEither,
      // Domain name
      { is_some: true, value: subdomainName },
      // Coin color (from parent)
      parentSettings.coinColor,
      // Per-tier costs (from parent)
      parentSettings.costs.short,
      parentSettings.costs.medium,
      parentSettings.costs.long,
      // Initial fields (empty)
      Array(10).fill({ is_some: false, value: ["", ""] }),
    ],
  });

  const newContractAddress = deployedContract.deployTxData.public.contractAddress;

  // Register the subdomain in the parent contract
  const ownerAddress = owner || providers.walletProvider.coinPublicKey;
  const registerResult = await sdkRegisterDomainFor(
    parentDomain,
    ownerAddress,
    subdomainName,
    newContractAddress,
    providers
  );
  
  if (!registerResult.success) {
    throw new Error(registerResult.error.message);
  }
  
  const returnData = {
    deployTx: deployedContract.deployTxData.public.txId, 
    registerTx: registerResult.data.transactionId, 
    contractAddress: newContractAddress
  };
  
  if (isJSONMode) {
    const jsonData = {
      parentDomain: parentDomain,
      subdomainName: subdomainName,
      fullDomain: `${subdomainName}.${parentDomain}`,
      owner: owner || providers.walletProvider.coinPublicKey,
      parentContractAddress: parentContractAddress,
      newContractAddress: newContractAddress,
      deployTransactionId: deployedContract.deployTxData.public.txId,
      registerTransactionId: registerResult.data.transactionId
    };
    return createJSONResponse(true, "register", `${subdomainName}.${parentDomain}`, jsonData, undefined, networkType);
  } else {
    logger.info(`Subdomain registered. Deploy Tx: ${deployedContract.deployTxData.public.txId}, Register Tx: ${registerResult.data.transactionId}`);
    logger.info(`New contract address: ${newContractAddress}`);
    return returnData;
  }
}

async function buySubdomain(
  providers: ContractProviders<typeof leafContractInstance>,
  parentDomain: string,
  subdomainName: string,
  owner?: string,
  paymentAmount?: string,
  networkType?: string
) {
  logOrCollect(`Buying subdomain ${subdomainName} under ${parentDomain}`);
  
  const parentContractAddress = await getDomainResolverAddress(providers.publicDataProvider, parentDomain);
  if (!parentContractAddress) {
    throw new Error("Could not find parent domain resolver contract");
  }
  
  // Get parent domain settings
  const parentSettingsResult = await getDomainSettings(parentDomain, { provider: providers.publicDataProvider });
  const parentSettings = handleResult(parentSettingsResult, "Get parent domain settings");
  
  // Deploy new leaf contract for the subdomain
  const targetAddress = owner ? parseAddress(owner) : parseAddress(providers.walletProvider.coinPublicKey);
  
  const targetEither = {
    is_left: true,
    left: targetAddress,
    right: { bytes: new Uint8Array(32) },
  };
  
  const deployedContract = await deployContract(providers, {
    compiledContract: leafContractInstance,
    privateStateId: "namespacePrivateState",
    initialPrivateState: { secretKey: "0".repeat(64) },
    args: [
      // Parent domain
      { is_some: true, value: parentDomain },
      // Parent resolver address
      parseContractAddress(parentContractAddress),
      // Domain target
      targetEither,
      // Domain name
      { is_some: true, value: subdomainName },
      // Coin color (from parent)
      parentSettings.coinColor,
      // Per-tier costs (from parent)
      parentSettings.costs.short,
      parentSettings.costs.medium,
      parentSettings.costs.long,
      // Initial fields (empty)
      Array(10).fill({ is_some: false, value: ["", ""] }),
    ],
  });

  const newContractAddress = deployedContract.deployTxData.public.contractAddress;

  // Buy the subdomain in the parent contract
  const ownerAddress = owner || providers.walletProvider.coinPublicKey;
  const payment = paymentAmount ? BigInt(paymentAmount) : parentSettings.costs.short;
  
  const buyResult = await sdkBuyDomainFor(
    parentDomain,
    ownerAddress,
    subdomainName,
    newContractAddress,
    payment,
    providers
  );
  
  if (!buyResult.success) {
    throw new Error(buyResult.error.message);
  }
  
  const returnData = {
    deployTx: deployedContract.deployTxData.public.txId, 
    buyTx: buyResult.data.transactionId, 
    contractAddress: newContractAddress
  };
  
  if (isJSONMode) {
    const jsonData = {
      parentDomain: parentDomain,
      subdomainName: subdomainName,
      fullDomain: `${subdomainName}.${parentDomain}`,
      owner: owner || providers.walletProvider.coinPublicKey,
      parentContractAddress: parentContractAddress,
      newContractAddress: newContractAddress,
      paymentAmount: payment.toString(),
      deployTransactionId: deployedContract.deployTxData.public.txId,
      buyTransactionId: buyResult.data.transactionId
    };
    return createJSONResponse(true, "buy", `${subdomainName}.${parentDomain}`, jsonData, undefined, networkType);
  } else {
    logger.info(`Subdomain purchased. Deploy Tx: ${deployedContract.deployTxData.public.txId}, Buy Tx: ${buyResult.data.transactionId}`);
    logger.info(`New contract address: ${newContractAddress}`);
    return returnData;
  }
}

// Usage function
function showUsage() {
  console.log(`
Midnight Name Service - Domain-Centric CLI Tool

Usage:
  bun run contract.ts <network> <domain> <command> [args...]

Networks:
  standalone    Use local standalone network
  testnet      Use remote testnet

Query Commands:
  query                                Query domain profile (all info)
  resolve                              Resolve domain to target address
  info                                 Get domain ownership info
  fields                               List all domain fields
  settings                             Get domain cost and color settings

Field Management:
  insert-field <key> <value>           Add/update a field
  clear-field <key>                    Remove a field
  clear-all-fields                     Clear all fields
  add-fields <key1:value1,key2:value2> Add multiple fields (max 10)

Domain Operations:
  update-target <address>              Update what the domain points to
  update-cost <amount>                 Update subdomain cost
  update-color <hex>                   Update accepted token type

Subdomain Operations:
  register <subdomain> [owner]         Register new subdomain (free for owner)
  buy <subdomain> [owner] [payment]    Buy new subdomain (requires payment)

Special Cases:
  # Buy domain with implicit subdomain name
  buy                                  Buy domain using domain name as subdomain
  register                             Register domain using domain name as subdomain

Environment Variables:
  SEED          BIP39 mnemonic or 64-character hex seed (required)

Examples:
  export SEED="word1 word2 ... word12"
  
  # Query operations
  bun run contract.ts testnet some.domain.night query
  bun run contract.ts testnet some.domain.night resolve
  bun run contract.ts testnet some.domain.night fields
  
  # Field management
  bun run contract.ts testnet some.domain.night insert-field avatar https://picsum.photos/400/550
  bun run contract.ts testnet some.domain.night clear-all-fields
  bun run contract.ts testnet some.domain.night add-fields "name:John,bio:Web3 Developer"
  
  # Domain operations
  bun run contract.ts testnet some.domain.night update-target mn_...
  bun run contract.ts testnet some.domain.night update-cost 1000
  
  # Subdomain operations
  bun run contract.ts testnet domain.night register sub
  bun run contract.ts testnet domain.night buy newsub
  
  # Auto-create domain
  bun run contract.ts testnet another.domain.night buy
  bun run contract.ts testnet another.domain.night register
`);
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  try {
    if (args.length < 3) {
      if (isJSONMode) {
        outputJSON(createJSONResponse(false, "unknown", undefined, undefined, "Insufficient arguments. Expected: <network> <domain> <command> [args...]"));
        process.exit(1);
      }
      showUsage();
      process.exit(1);
    }
    
    const networkType = args[0];
    const fullDomain = args[1];
    const command = args[2];
    const commandArgs = args.slice(3);
    
    if (!["testnet", "standalone"].includes(networkType)) {
      if (isJSONMode) {
        outputJSON(createJSONResponse(false, command, fullDomain, undefined, "Invalid network type. Use 'testnet' or 'standalone'", networkType));
        process.exit(1);
      }
      logger.error("Invalid network type. Use 'testnet' or 'standalone'");
      showUsage();
      process.exit(1);
    }
    
    const parsed = parseDomainName(fullDomain);
    if (!parsed.isValid) {
      if (isJSONMode) {
        outputJSON(createJSONResponse(false, command, fullDomain, undefined, `Invalid domain format: ${fullDomain}. Expected format like "domain.night" or "sub.domain.night"`, networkType));
        process.exit(1);
      }
      logger.error(`Invalid domain format: ${fullDomain}. Expected format like "domain.night" or "sub.domain.night"`);
      process.exit(1);
    }
    
    logOrCollect(`Starting ${command} on ${networkType} network for domain: ${fullDomain}`);
  
  // Set network ID
  if (networkType === "testnet") {
    setNetworkId(NetworkId.TestNet);
  } else {
    // For standalone, we'll set it in the config
    // setNetworkId will be called by the config
  }
  
  // Check if this is a read-only command
  if (isReadOnlyCommand(command)) {
    logger.info("Read-only command detected - skipping wallet initialization");
    
    // Create just a PublicDataProvider for read operations
    let publicDataProvider: any;
    if (networkType === "testnet") {
      publicDataProvider = indexerPublicDataProvider(
        "https://indexer.testnet-02.midnight.network/api/v1/graphql",
        "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws"
      );
    } else {
      // For standalone, we need to detect the ports first
      const config = new StandaloneConfig();
      await config.detectRunningContainerPorts();
      publicDataProvider = indexerPublicDataProvider(
        config.indexer,
        config.indexerWS
      );
    }
    
    // Execute read-only command
    let result: any;
    switch (command) {
      case "query":
        result = await queryDomain(publicDataProvider, fullDomain, networkType);
        break;
        
      case "resolve":
        result = await resolveDomainCommand(publicDataProvider, fullDomain, networkType);
        break;
        
      case "info":
        result = await getDomainInfo(publicDataProvider, fullDomain, networkType);
        break;
        
      case "fields":
        result = await getDomainFieldsCommand(publicDataProvider, fullDomain, networkType);
        break;
        
      case "settings":
        result = await getDomainSettingsCommand(publicDataProvider, fullDomain, networkType);
        break;
        
      default:
        if (isJSONMode) {
          outputJSON(createJSONResponse(false, command, fullDomain, undefined, `Unknown read command: ${command}`, networkType));
          process.exit(1);
        }
        logger.error(`Unknown read command: ${command}`);
        showUsage();
        process.exit(1);
    }
    
    // Output result for JSON mode
    if (isJSONMode && result) {
      outputJSON(result);
    } else if (!isJSONMode) {
      logger.info(`Read command ${command} completed successfully`);
    }
    return;
  }
  
  // For write commands, proceed with full wallet initialization
  logOrCollect("Write command detected - initializing wallet");
  
  // Configure network
  let config: Config;
  if (networkType === "testnet") {
    config = new TestnetConfig();
  } else {
    config = new StandaloneConfig();
    await (config as StandaloneConfig).detectRunningContainerPorts();
  }
  
  let wallet: (Wallet & Resource) | null = null;
  
  try {
    // Get seed from environment
    const seed = await getSeedFromEnv();
    logOrCollect("Using seed from SEED environment variable");
    
    // Build wallet
    wallet = await buildWalletAndWaitForFunds(config, seed);
    
    // Configure providers
    const providers = await configureProviders(wallet, config);
    
    // Execute write command
    let writeResult: any;
    switch (command) {
      // Field management
      case "insert-field":
        if (commandArgs.length < 2) {
          if (isJSONMode) {
            outputJSON(createJSONResponse(false, command, fullDomain, undefined, "insert-field requires <key> <value>", networkType));
            process.exit(1);
          }
          logger.error("insert-field requires <key> <value>");
          process.exit(1);
        }
        await insertField(providers, fullDomain, commandArgs[0], commandArgs[1]);
        break;
        
      case "clear-field":
        if (commandArgs.length < 1) {
          if (isJSONMode) {
            outputJSON(createJSONResponse(false, command, fullDomain, undefined, "clear-field requires <key>", networkType));
            process.exit(1);
          }
          logger.error("clear-field requires <key>");
          process.exit(1);
        }
        writeResult = await clearField(providers, fullDomain, commandArgs[0], networkType);
        break;
        
      case "clear-all-fields":
        writeResult = await clearAllFields(providers, fullDomain, networkType);
        break;
        
      case "add-fields":
        if (commandArgs.length < 1) {
          if (isJSONMode) {
            outputJSON(createJSONResponse(false, command, fullDomain, undefined, "add-fields requires <key1:value1,key2:value2,...>", networkType));
            process.exit(1);
          }
          logger.error("add-fields requires <key1:value1,key2:value2,...>");
          process.exit(1);
        }
        {
          const fieldPairs = commandArgs[0].split(',').map(pair => {
            const [key, value] = pair.split(':');
            return [key.trim(), value.trim()] as [string, string];
          });
          writeResult = await addFields(providers, fullDomain, fieldPairs, networkType);
        }
        break;
        
      // Domain operations
      case "update-target":
        if (commandArgs.length < 1) {
          if (isJSONMode) {
            outputJSON(createJSONResponse(false, command, fullDomain, undefined, "update-target requires <address>", networkType));
            process.exit(1);
          }
          logger.error("update-target requires <address>");
          process.exit(1);
        }
        writeResult = await updateTarget(providers, fullDomain, commandArgs[0], networkType);
        break;
        
      case "update-cost":
        if (commandArgs.length < 1) {
          if (isJSONMode) {
            outputJSON(createJSONResponse(false, command, fullDomain, undefined, "update-cost requires <amount>", networkType));
            process.exit(1);
          }
          logger.error("update-cost requires <amount>");
          process.exit(1);
        }
        writeResult = await updateCost(providers, fullDomain, commandArgs[0], networkType);
        break;
        
      case "update-color":
        if (commandArgs.length < 1) {
          if (isJSONMode) {
            outputJSON(createJSONResponse(false, command, fullDomain, undefined, "update-color requires <hex>", networkType));
            process.exit(1);
          }
          logger.error("update-color requires <hex>");
          process.exit(1);
        }
        writeResult = await updateColor(providers, fullDomain, commandArgs[0], networkType);
        break;
        
      // Subdomain operations
      case "register":
        if (commandArgs.length === 0) {
          // Auto-register: use domain name as subdomain
          writeResult = await registerSubdomain(providers, parsed.parentDomain, parsed.domainName, commandArgs[1], networkType);
        } else {
          // Register specified subdomain
          writeResult = await registerSubdomain(providers, fullDomain, commandArgs[0], commandArgs[1], networkType);
        }
        break;
        
      case "buy":
        if (commandArgs.length === 0) {
          // Auto-buy: use domain name as subdomain
          writeResult = await buySubdomain(providers, parsed.parentDomain, parsed.domainName, commandArgs[1], commandArgs[2], networkType);
        } else {
          // Buy specified subdomain
          writeResult = await buySubdomain(providers, fullDomain, commandArgs[0], commandArgs[1], commandArgs[2], networkType);
        }
        break;
        
      default:
        if (isJSONMode) {
          outputJSON(createJSONResponse(false, command, fullDomain, undefined, `Unknown command: ${command}`, networkType));
          process.exit(1);
        }
        logger.error(`Unknown command: ${command}`);
        showUsage();
        process.exit(1);
    }
    
    // Output result for JSON mode
    if (isJSONMode && writeResult) {
      outputJSON(writeResult);
    } else if (!isJSONMode) {
      logger.info(`Command ${command} completed successfully`);
    }
    
  } catch (error) {
    if (isJSONMode) {
      outputJSON(createJSONResponse(false, command, fullDomain, undefined, error instanceof Error ? error.message : String(error), networkType));
      process.exit(1);
    }
    logger.error(`Command failed: ${error instanceof Error ? error.message : String(error)}`, error);
    throw error;
  } finally {
    if (wallet) {
      await wallet.close();
      logOrCollect("Wallet closed");
    }
  }
  
  } catch (error) {
    if (isJSONMode) {
      outputJSON(createJSONResponse(false, "main", undefined, undefined, error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
    logger.error(`Main execution failed: ${error instanceof Error ? error.message : String(error)}`, error);
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    if (isJSONMode) {
      outputJSON(createJSONResponse(false, "main", undefined, undefined, error instanceof Error ? error.message : String(error)));
    } else {
      console.error(error);
    }
    process.exit(1);
  });
}
import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { ShieldedCoinPublicKey } from "@midnight-ntwrk/wallet-sdk-address-format";
import { ledger, type DomainData } from "@midnames/ns";
import { formatContractAddress, bytesToHex } from "./utils/address.js";
import { normalizeDomain, parseFullDomain, DEFAULT_TLD, isTLD, domainToKey, keyToDomain } from "./utils/domain.js";
import type { DomainInfo, DomainSettings, DomainProfileData } from "./types.js";
import { Result, success, failure, wrapAsync, chain } from "./results.js";
import {
  NetworkError,
  ContractNotFoundError,
  DomainNotFoundError,
  InvalidDomainError,
  ProviderError,
} from "./errors.js";
import { getDefaultProvider, getNetworkConfig, NETWORK_REGISTRY } from "./provider.js";

export const TESTNET_TLD_ADDRESS = NETWORK_REGISTRY.preprod.tldAddress;
export const PREVIEW_TLD_ADDRESS = NETWORK_REGISTRY.preview.tldAddress;

function getDefaultTldAddress(): string {
  const currentNetwork = getNetworkId();
  return getNetworkConfig(currentNetwork).tldAddress;
}

function getTargetFromLedger(
  contractLedger: ReturnType<typeof ledger>
): string {
  const target = contractLedger.DOMAIN_TARGET;
  if (target.is_left) {
    const coinPublicKey = new ShieldedCoinPublicKey(
      Buffer.from(target.left.bytes)
    );
    return ShieldedCoinPublicKey.codec
      .encode(getNetworkId() as any, coinPublicKey)
      .asString();
  } else {
    return formatContractAddress(target.right.bytes);
  }
}

export async function queryContractStateSafely(
  publicDataProvider: PublicDataProvider,
  contractAddress: string
): Promise<Result<any>> {
  return wrapAsync(async () => {
    const contractState =
      await publicDataProvider.queryContractState(contractAddress);
    if (contractState == null) {
      throw new ContractNotFoundError(contractAddress, undefined);
    }
    return contractState;
  });
}

async function traverseDomainHierarchy(
  publicDataProvider: PublicDataProvider,
  fullDomain: string,
  returnFinalTarget: boolean = false
): Promise<Result<string>> {
  try {
    const tldAddress = getDefaultTldAddress();
    const domainParts = fullDomain.split(".");
    const traversalParts = domainParts.slice(0, -1).reverse();

    let currentResolver = tldAddress;

    // If we're resolving the TLD itself and want the target
    if (traversalParts.length === 0) {
      if (returnFinalTarget) {
        const contractStateResult = await queryContractStateSafely(
          publicDataProvider,
          currentResolver
        );
        if (!contractStateResult.success)
          return failure(contractStateResult.error);
        const contractLedger = ledger(contractStateResult.data.data);
        return success(getTargetFromLedger(contractLedger));
      }
      return success(tldAddress);
    }

    // Traverse the domain hierarchy
    for (const part of traversalParts) {
      const contractStateResult = await queryContractStateSafely(
        publicDataProvider,
        currentResolver
      );
      if (!contractStateResult.success) {
        return failure(contractStateResult.error);
      }
      const contractLedger = ledger(contractStateResult.data.data);
      if (!contractLedger.domains.member(domainToKey(part).key)) {
        return failure(new DomainNotFoundError(`${part} in ${fullDomain}`));
      }
      const domainData = contractLedger.domains.lookup(domainToKey(part).key);
      const resolverBytes = domainData.resolver.bytes;
      // Use raw hex for queryContractState (no 0200 prefix)
      currentResolver = bytesToHex(resolverBytes);
    }

    // Return either the final resolver address or the target it points to
    if (returnFinalTarget) {
      const finalContractStateResult = await queryContractStateSafely(
        publicDataProvider,
        currentResolver
      );
      if (!finalContractStateResult.success)
        return failure(finalContractStateResult.error);
      const finalLedger = ledger(finalContractStateResult.data.data);
      return success(getTargetFromLedger(finalLedger));
    }

    return success(currentResolver);
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to traverse domain hierarchy: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    );
  }
}

async function getResolverAddress(
  publicDataProvider: PublicDataProvider,
  fullDomain: string
): Promise<Result<string>> {
  return traverseDomainHierarchy(publicDataProvider, fullDomain, false);
}

export async function resolveDomain(
  domain: string,
  options: { provider?: PublicDataProvider; tldAddress?: string } = {}
): Promise<Result<string>> {
  // Simple validation
  const normalized = normalizeDomain(domain);
  if (!normalized.endsWith(`.${DEFAULT_TLD}`)) {
    return failure(
      new InvalidDomainError(domain, "Domain must end with .night", undefined)
    );
  }

  // Use the simple wrapper
  return wrapAsync(async () => {
    const result = await traverseDomainHierarchy(
      options.provider || getDefaultProvider(),
      normalized,
      true
    );
    if (!result.success) {
      throw result.error;
    }
    return result.data;
  });
}

/** Looks up a subdomain's info (owner, resolver) within a specific parent contract. */
async function getDomainInfoInContract(
  contractAddress: string,
  domainName: string,
  options: { provider?: PublicDataProvider } = {}
): Promise<Result<DomainInfo>> {
  const publicDataProvider = options.provider || getDefaultProvider();
  try {
    const contractStateResult = await queryContractStateSafely(
      publicDataProvider,
      contractAddress
    );
    if (!contractStateResult.success) return failure(contractStateResult.error);
    const contractLedger = ledger(contractStateResult.data.data);
    if (!contractLedger.domains.member(domainToKey(domainName).key)) {
      return failure(new DomainNotFoundError(domainName));
    }
    const domainData = contractLedger.domains.lookup(domainToKey(domainName).key);
    const ownerCoinPublicKey = new ShieldedCoinPublicKey(
      Buffer.from(domainData.owner.bytes)
    );
    const ownerAddress = ShieldedCoinPublicKey.codec
      .encode(getNetworkId() as any, ownerCoinPublicKey)
      .asString();
    return success({
      owner: ownerAddress,
      resolver: formatContractAddress(domainData.resolver.bytes),
    });
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to get domain info: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    );
  }
}

export async function getDomainInfo(
  fullDomain: string,
  options: { provider?: PublicDataProvider } = {}
): Promise<Result<DomainInfo>> {
  const publicDataProvider = options.provider || getDefaultProvider();
  try {
    const normalizedDomain = normalizeDomain(fullDomain);
    const parsed = parseFullDomain(normalizedDomain);
    if (!parsed.isValid) {
      return failure(
        new InvalidDomainError(fullDomain, "Invalid domain format")
      );
    }
    const parentContractAddressResult = await getResolverAddress(
      publicDataProvider,
      parsed.parentDomainPath
    );
    if (!parentContractAddressResult.success)
      return failure(parentContractAddressResult.error);
    const infoResult = await getDomainInfoInContract(
      parentContractAddressResult.data,
      parsed.domainName,
      { provider: publicDataProvider }
    );
    if (!infoResult.success) return failure(infoResult.error);
    return success({
      ...infoResult.data,
      contractAddress: parentContractAddressResult.data,
    });
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to get domain info by resolving: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    );
  }
}

async function readContractLedger(
  publicDataProvider: PublicDataProvider,
  resolverAddress: string
): Promise<Result<ReturnType<typeof ledger>>> {
  const rawAddress = resolverAddress.startsWith('0200')
    ? resolverAddress.slice(4)
    : resolverAddress;
  const contractStateResult = await queryContractStateSafely(
    publicDataProvider,
    rawAddress
  );
  if (!contractStateResult.success) return failure(contractStateResult.error);
  return success(ledger(contractStateResult.data.data));
}

export async function getDomainFields(
  fullDomain: string,
  options: { provider?: PublicDataProvider } = {}
): Promise<Result<Map<string, string>>> {
  const publicDataProvider = options.provider || getDefaultProvider();
  try {
    const normalized = normalizeDomain(fullDomain);
    const infoResult = await getDomainInfo(normalized, { provider: publicDataProvider });
    if (!infoResult.success) return failure(infoResult.error);
    const ledgerResult = await readContractLedger(publicDataProvider, infoResult.data.resolver);
    if (!ledgerResult.success) return failure(ledgerResult.error);
    const fields: Map<string, string> = new Map();
    for (const [key, value] of ledgerResult.data.fields) fields.set(key, value);
    return success(fields);
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to get domain fields: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    );
  }
}

export async function getDomainSettings(
  fullDomain: string,
  options: { provider?: PublicDataProvider } = {}
): Promise<Result<DomainSettings>> {
  const publicDataProvider = options.provider || getDefaultProvider();
  try {
    const normalized = normalizeDomain(fullDomain, false);

    // Special case: TLD itself — read settings directly from TLD contract
    if (isTLD(normalized)) {
      const tldAddress = getDefaultTldAddress();
      const ledgerResult = await readContractLedger(publicDataProvider, tldAddress);
      if (!ledgerResult.success) return failure(ledgerResult.error);
      return success({
        coinColor: ledgerResult.data.COIN_COLOR,
        costs: {
          short: ledgerResult.data.COST_SHORT,
          medium: ledgerResult.data.COST_MED,
          long: ledgerResult.data.COST_LONG,
        },
      });
    }

    // Normal case: subdomain — resolve via getDomainInfo
    const normalizedFull = normalizeDomain(fullDomain);
    const infoResult = await getDomainInfo(normalizedFull, { provider: publicDataProvider });
    if (!infoResult.success) return failure(infoResult.error);
    const ledgerResult = await readContractLedger(publicDataProvider, infoResult.data.resolver);
    if (!ledgerResult.success) return failure(ledgerResult.error);
    return success({
      coinColor: ledgerResult.data.COIN_COLOR,
      costs: {
        short: ledgerResult.data.COST_SHORT,
        medium: ledgerResult.data.COST_MED,
        long: ledgerResult.data.COST_LONG,
      },
    });
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to get domain settings: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    );
  }
}

export async function getDomainProfile(
  fullDomain: string,
  options: { provider?: PublicDataProvider } = {}
): Promise<Result<DomainProfileData>> {
  const publicDataProvider = options.provider || getDefaultProvider();
  try {
    const normalized = normalizeDomain(fullDomain);
    const [resolvedTargetResult, infoResult] = await Promise.all([
      resolveDomain(normalized, { provider: publicDataProvider }),
      getDomainInfo(normalized, { provider: publicDataProvider }),
    ]);

    const resolvedTarget = resolvedTargetResult.success
      ? resolvedTargetResult.data
      : null;
    const info = infoResult.success ? infoResult.data : null;

    if (info && info.resolver) {
      const ledgerResult = await readContractLedger(publicDataProvider, info.resolver);
      if (ledgerResult.success) {
        const fields: Map<string, string> = new Map();
        for (const [key, value] of ledgerResult.data.fields) fields.set(key, value);
        const settings: DomainSettings = {
          coinColor: ledgerResult.data.COIN_COLOR,
          costs: {
            short: ledgerResult.data.COST_SHORT,
            medium: ledgerResult.data.COST_MED,
            long: ledgerResult.data.COST_LONG,
          },
        };
        return success({
          fullDomain: normalized,
          resolvedTarget,
          info,
          fields,
          settings,
        });
      }
    }
    return success({
      fullDomain: normalized,
      resolvedTarget,
      info,
      fields: new Map(),
      settings: null,
    });
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to get domain profile: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    );
  }
}

export async function getSubdomains(
  fullDomain: string,
  options: { provider?: PublicDataProvider } = {}
): Promise<Result<Map<string, DomainData>>> {
  const publicDataProvider = options.provider || getDefaultProvider();
  try {
    const normalized = normalizeDomain(fullDomain);
    const infoResult = await getDomainInfo(normalized, { provider: publicDataProvider });
    if (!infoResult.success) return failure(infoResult.error);
    const ledgerResult = await readContractLedger(publicDataProvider, infoResult.data.resolver);
    if (!ledgerResult.success) return failure(ledgerResult.error);
    const subdomains: Map<string, DomainData> = new Map();
    for (const [name, data] of ledgerResult.data.domains) {
      subdomains.set(keyToDomain(name), data);
    }
    return success(subdomains);
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to get subdomains: ${error instanceof Error ? error.message : String(error)}`,
        error
      )
    );
  }
}

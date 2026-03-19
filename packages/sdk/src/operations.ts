import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import {
  findDeployedContract,
  type ContractProviders,
} from "@midnight-ntwrk/midnight-js-contracts";
import {
  ShieldedCoinPublicKey,
  MidnightBech32m,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { isWalletAddress } from "./utils/address.js";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

import { Leaf } from "@midnames/ns";
import { MANAGED_DIR } from "@midnames/ns/managed-dir";
import type { Result } from "./results.js";
import { success, failure } from "./results.js";
import { NetworkError, InvalidDomainError } from "./errors.js";
import { normalizeDomain, parseFullDomain, domainToKey } from "./utils/domain.js";
import { getDomainInfo } from "./core.js";

function validateDomain(domain: string): Result<string> {
  const normalized = normalizeDomain(domain);
  const parsed = parseFullDomain(normalized);
  if (!parsed.isValid) {
    return failure(new InvalidDomainError(domain, "Invalid domain format"));
  }
  return success(normalized);
}

// Contract types and instances

export const leafContractInstance = CompiledContract.make(
  "leaf-contract",
  Leaf.Contract,
).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(MANAGED_DIR),
);

async function joinLeafContract(
  providers: ContractProviders<Leaf.Contract>,
  contractAddress: string,
) {
  return await findDeployedContract(providers, {
    contractAddress,
    compiledContract: leafContractInstance,
    privateStateId: "namespacePrivateState",
    initialPrivateState: { phantom: false },
  });
}

// --- Shared helpers ---

async function withLeafContract<T>(
  domain: string,
  providers: ContractProviders<Leaf.Contract>,
  label: string,
  fn: (contract: Awaited<ReturnType<typeof joinLeafContract>>, domainInfo: { resolver: string }) => Promise<T>,
): Promise<Result<T>> {
  const validated = validateDomain(domain);
  if (!validated.success) return failure(validated.error);
  try {
    const domainInfoResult = await getDomainInfo(validated.data, {
      provider: providers.publicDataProvider,
    });
    if (!domainInfoResult.success) {
      return failure(domainInfoResult.error);
    }

    const contractAddress = domainInfoResult.data.resolver;
    const contract = await joinLeafContract(providers, contractAddress);
    const result = await fn(contract, domainInfoResult.data);

    return success(result);
  } catch (error) {
    return failure(
      new NetworkError(
        `Failed to ${label}: ${error instanceof Error ? error.message : String(error)}`,
        error,
      ),
    );
  }
}

function txId(result: { public: { txId: string } }) {
  return { transactionId: result.public.txId };
}

export function buildKvs(
  fields: Array<[string, string]>,
): Array<{ is_some: boolean; value: [string, string] }> {
  return Array.from({ length: 10 }, (_, i) => ({
    is_some: i < fields.length,
    value: i < fields.length ? fields[i] : ["", ""],
  }));
}

function parseAddressToBytes(address: string): { bytes: Uint8Array } {
  if (isWalletAddress(address)) {
    const bech32Parsed = MidnightBech32m.parse(address);
    const coinPublicKey = ShieldedCoinPublicKey.codec.decode(
      getNetworkId(),
      bech32Parsed,
    );
    return { bytes: new Uint8Array(coinPublicKey.data) };
  } else {
    let hexString = address;
    if (address.startsWith("0200")) {
      hexString = address.slice(4);
    }
    const bytes = new Uint8Array(Buffer.from(hexString, "hex"));
    return { bytes: bytes.length === 32 ? bytes : bytes.subarray(-32) };
  }
}

function formatTargetForContract(address: string) {
  const parsed = parseAddressToBytes(address);
  const isLeft = isWalletAddress(address);
  return {
    is_left: isLeft,
    left: isLeft ? parsed : { bytes: new Uint8Array(32) },
    right: isLeft ? { bytes: new Uint8Array(32) } : parsed,
  };
}

// --- Domain operations ---

export async function insertField(
  domain: string,
  key: string,
  value: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(domain, providers, "insert field", async (contract) =>
    txId(await contract.callTx.insert_field(key, value)),
  );
}

export async function clearField(
  domain: string,
  key: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(domain, providers, "clear field", async (contract) =>
    txId(await contract.callTx.clear_field(key)),
  );
}

export async function clearAllFields(
  domain: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(domain, providers, "clear all fields", async (contract) =>
    txId(await contract.callTx.clear_all_fields()),
  );
}

export async function addMultipleFields(
  domain: string,
  fields: Array<[string, string]>,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  if (fields.length === 0) {
    return failure(new NetworkError("No fields provided"));
  }
  if (fields.length > 10) {
    return failure(new NetworkError("Maximum of 10 fields can be added at once"));
  }
  return withLeafContract(domain, providers, "add multiple fields", async (contract) =>
    txId(await contract.callTx.add_multiple_fields(buildKvs(fields))),
  );
}

export async function updateDomainTarget(
  domain: string,
  targetAddress: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(domain, providers, "update domain target", async (contract) =>
    txId(await contract.callTx.update_domain_target(formatTargetForContract(targetAddress))),
  );
}

export async function updateDomainColor(
  domain: string,
  color: Uint8Array,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  if (color.length !== 32) {
    return failure(new NetworkError("Color must be exactly 32 bytes"));
  }
  return withLeafContract(domain, providers, "update domain color", async (contract) =>
    txId(await contract.callTx.update_color(color)),
  );
}

export async function updateDomainCosts(
  domain: string,
  costs: { short: bigint; medium: bigint; long: bigint },
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  if (costs.short < BigInt(0) || costs.medium < BigInt(0) || costs.long < BigInt(0)) {
    return failure(new NetworkError("Costs must be non-negative"));
  }
  return withLeafContract(domain, providers, "update domain costs", async (contract) =>
    txId(await contract.callTx.update_costs(costs.short, costs.medium, costs.long)),
  );
}

export async function transferDomainOwnership(
  parentDomain: string,
  subdomainName: string,
  newOwnerAddress: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(parentDomain, providers, "transfer domain ownership", async (contract) =>
    txId(await contract.callTx.transfer_domain(
      domainToKey(subdomainName).key,
      parseAddressToBytes(newOwnerAddress),
    )),
  );
}

export async function setDomainResolver(
  parentDomain: string,
  subdomainName: string,
  resolverAddress: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(parentDomain, providers, "set domain resolver", async (contract) =>
    txId(await contract.callTx.set_resolver(
      domainToKey(subdomainName).key,
      parseAddressToBytes(resolverAddress),
    )),
  );
}

export async function registerDomainFor(
  parentDomain: string,
  ownerAddress: string,
  subdomainName: string,
  resolverAddress: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(parentDomain, providers, "register domain", async (contract) => {
    const { key, len } = domainToKey(subdomainName);
    return txId(await contract.callTx.register_domain_for(
      parseAddressToBytes(ownerAddress),
      key,
      len,
      parseAddressToBytes(resolverAddress),
    ));
  });
}

export async function buyDomainFor(
  parentDomain: string,
  ownerAddress: string,
  subdomainName: string,
  resolverAddress: string,
  _paymentAmount: bigint,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(parentDomain, providers, "buy domain", async (contract) => {
    const { key, len } = domainToKey(subdomainName);
    return txId(await contract.callTx.register_domain_for(
      parseAddressToBytes(ownerAddress),
      key,
      len,
      parseAddressToBytes(resolverAddress),
    ));
  });
}

export async function changeDomainOwner(
  domain: string,
  newOwnerAddress: string,
  providers: ContractProviders<Leaf.Contract>,
): Promise<Result<{ transactionId: string }>> {
  return withLeafContract(domain, providers, "change domain owner", async (contract) =>
    txId(await contract.callTx.change_owner(parseAddressToBytes(newOwnerAddress))),
  );
}

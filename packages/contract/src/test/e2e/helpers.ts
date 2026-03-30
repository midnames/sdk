import { nativeToken } from "@midnight-ntwrk/ledger-v8";
import { createHash } from "node:crypto";
import type { DNSPrivateState } from "../../witnesses.js";
import {
  createUnprovenCallTx,
  deployContract,
  type DeployedContract,
} from "@midnight-ntwrk/midnight-js-contracts";
import { CompiledContract } from "@midnight-ntwrk/compact-js";
import * as Leaf from "../../managed/leaf/contract/index.js";
import { witnesses } from "../../witnesses.js";
import { domainToKey } from "../../utils.js";
import { AddressType, type Ledger, ledger } from "../../managed/leaf/contract/index.js";

import * as path from "node:path";
import { Buffer } from "buffer";
import type { TestContext } from "./setup.js";

// ─── Contract Instance ──────────────────────────────────────────────────────

const ZK_CONFIG_PATH = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "managed",
  "leaf",
);

const leafContractInstance = CompiledContract.make(
  "leaf-contract",
  Leaf.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(ZK_CONFIG_PATH),
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function getNativeTokenColor(): Uint8Array {
  return new Uint8Array(
    Buffer.from(nativeToken().raw.toString().replace("0x", ""), "hex"),
  );
}

export async function waitForIndexer(ms = 7_000): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// ─── Deploy ──────────────────────────────────────────────────────────────────

export interface DeployOpts {
  parentDomain: string | null;
  parentResolverAddress: string;
  ownerAddress: Uint8Array;
  domain: string | null;
  buyEnabled?: boolean;
  fields?: Array<[string, string]>;
}

export async function deployLeafContract(
  ctx: TestContext,
  opts: DeployOpts,
): Promise<DeployedContract<any>> {
  const {
    parentDomain,
    parentResolverAddress,
    ownerAddress,
    domain,
    buyEnabled = true,
    fields = [],
  } = opts;

  const kvs: Array<{ is_some: boolean; value: [string, string] }> = [];
  for (const [key, value] of fields.slice(0, 10)) {
    kvs.push({ is_some: true, value: [key, value] });
  }
  while (kvs.length < 10) {
    kvs.push({ is_some: false, value: ["", ""] });
  }

  const deployed = await deployContract(ctx.providers, {
    compiledContract: leafContractInstance as any,
    privateStateId: "namespacePrivateState",
    initialPrivateState: { secretKey: getSecretKey(ctx) } as DNSPrivateState,
    args: [
      parentDomain
        ? { is_some: true, value: domainToKey(parentDomain).key }
        : { is_some: false, value: new Uint8Array(32) },
      parseContractAddress(parentResolverAddress),
      [getOwnerCoinPublicKey(ctx), AddressType.ZswapCPKAddr],
      domain
        ? { is_some: true, value: domainToKey(domain).key }
        : { is_some: false, value: new Uint8Array(32) },
      getNativeTokenColor(),
      100n, // COST_SHORT
      10n, // COST_MED
      1n, // COST_LONG
      { is_some: false, value: "" }, // DEFAULT_FIELD
      buyEnabled,
      { bytes: ownerAddress },
      kvs,
    ],
  });

  console.log(
    `[e2e] Deployed ${domain || "TLD"} at: ${deployed.deployTxData.public.contractAddress}`,
  );
  return deployed;
}

// ─── Circuit Calls ───────────────────────────────────────────────────────────

export async function callCircuit(
  ctx: TestContext,
  contractAddress: string,
  circuitId: string,
  args: any[],
): Promise<{ txId: string }> {
  console.log(`[e2e] Calling circuit: ${circuitId}`);

  // Ensure the private state provider knows this contract address
  // and has the correct secret key for witness resolution
  ctx.providers.privateStateProvider.setContractAddress(contractAddress);
  await ctx.providers.privateStateProvider.set(
    "namespacePrivateState",
    { secretKey: getSecretKey(ctx) } as DNSPrivateState,
  );

  const unprovenCallTxData = await createUnprovenCallTx(ctx.providers, {
    compiledContract: leafContractInstance as any,
    circuitId,
    contractAddress,
    args,
    privateStateId: "namespacePrivateState",
  });

  const unprovenTx = unprovenCallTxData.private.unprovenTx;
  const provedTx = await ctx.providers.proofProvider.proveTx(unprovenTx);
  const finalizedTx = await ctx.providers.walletProvider.balanceTx(provedTx);
  const txId = await ctx.providers.midnightProvider.submitTx(finalizedTx);

  console.log(`[e2e] ${circuitId} tx: ${txId}`);
  return { txId };
}

// ─── Query ───────────────────────────────────────────────────────────────────

export async function queryLedgerState(
  ctx: TestContext,
  contractAddress: string,
): Promise<Ledger> {
  const contractState =
    await ctx.providers.publicDataProvider.queryContractState(contractAddress);
  if (!contractState) {
    throw new Error(`Contract ${contractAddress} not found in indexer`);
  }
  return ledger((contractState as any).data);
}

// ─── Key helpers ────────────────────────────────────────────────────────────

export function getSecretKey(ctx: TestContext): Uint8Array {
  const pk = getOwnerCoinPublicKey(ctx);
  return new Uint8Array(createHash("sha256").update(pk).digest());
}

export async function getDerivedPublicKey(ctx: TestContext, contractAddress: string): Promise<Uint8Array> {
  const state = await queryLedgerState(ctx, contractAddress);
  return state.DOMAIN_OWNER[0];
}

// ─── Domain helpers ──────────────────────────────────────────────────────────

export function getOwnerCoinPublicKey(ctx: TestContext): Uint8Array {
  const pk = ctx.walletContext.shieldedSecretKeys.coinPublicKey;
  const raw = (pk as any).raw;
  if (raw) return new Uint8Array(raw).length === 32 ? new Uint8Array(raw) : new Uint8Array(raw).subarray(-32);
  return new Uint8Array(Buffer.from(pk.toString().replace("0x", ""), "hex")).subarray(-32);
}

export function getOwnerUserAddress(ctx: TestContext): Uint8Array {
  const addr = ctx.walletContext.unshieldedKeystore.getAddress();
  const raw = (addr as any).raw;
  if (raw) return new Uint8Array(raw).length === 32 ? new Uint8Array(raw) : new Uint8Array(raw).subarray(-32);
  return new Uint8Array(Buffer.from(addr.toString().replace("0x", ""), "hex")).subarray(-32);
}

export { domainToKey } from "../../utils.js";

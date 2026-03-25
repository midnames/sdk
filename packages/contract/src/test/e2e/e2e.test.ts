import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupTestEnvironment,
  teardownTestEnvironment,
  waitForSync,
  type TestContext,
} from "./setup.js";
import {
  deployLeafContract,
  callCircuit,
  queryLedgerState,
  waitForIndexer,
  getOwnerCoinPublicKey,
  parseContractAddress,
  domainToKey,
  computeCommitment,
} from "./helpers.js";
import type { DeployedContract } from "@midnight-ntwrk/midnight-js-contracts";

// ─── Shared state across all tests ──────────────────────────────────────────

let ctx: TestContext;
let tldContract: DeployedContract<any>;
let tldAddress: string;
let ownerCoinPubKey: Uint8Array;

const ZERO_ADDR =
  "0000000000000000000000000000000000000000000000000000000000000000";

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeAll(async () => {
  ctx = await setupTestEnvironment();
  ownerCoinPubKey = getOwnerCoinPublicKey(ctx);

  // Deploy TLD contract
  console.log("[e2e] Deploying TLD contract...");
  tldContract = await deployLeafContract(ctx, {
    parentDomain: null,
    parentResolverAddress: ZERO_ADDR,
    targetCoinPublicKey: ownerCoinPubKey,
    domain: null,
    buyEnabled: true,
  });
  tldAddress = tldContract.deployTxData.public.contractAddress;

  // Wait for indexer to pick up the deployment
  await waitForIndexer();
  await waitForSync(ctx.walletContext.wallet);
}, 180_000);

afterAll(async () => {
  if (ctx) {
    await teardownTestEnvironment(ctx);
  }
}, 60_000);

// ─── Helper ──────────────────────────────────────────────────────────────────

async function syncAndWait(): Promise<void> {
  await waitForIndexer();
  await waitForSync(ctx.walletContext.wallet);
}

// ═══════════════════════════════════════════════════════════════════════════════
//                              TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("TLD deployment & initialization", () => {
  it("TLD contract has a valid address", () => {
    expect(tldAddress).toBeDefined();
    expect(tldAddress.length).toBeGreaterThan(0);
  });

  it("TLD ledger state matches constructor params", async () => {
    const state = await queryLedgerState(ctx, tldAddress);
    expect(state.COST_SHORT).toBe(100n);
    expect(state.COST_MED).toBe(10n);
    expect(state.COST_LONG).toBe(1n);
    expect(state.BUY_ENABLED).toBe(true);
    expect(state.domains.isEmpty()).toBe(true);
  });
});

describe("register_domain_for (owner-only, free)", () => {
  let childContract: DeployedContract<any>;
  let childAddress: string;
  const domainName = "testreg";

  it("registers a subdomain and deploys child contract", async () => {
    // Deploy child contract first
    childContract = await deployLeafContract(ctx, {
      parentDomain: domainName,
      parentResolverAddress: tldAddress,
      targetCoinPublicKey: ownerCoinPubKey,
      domain: domainName,
    });
    childAddress = childContract.deployTxData.public.contractAddress;
    expect(childAddress).toBeDefined();

    await syncAndWait();

    // Register in TLD
    const { key, len } = domainToKey(domainName);
    await callCircuit(ctx, tldAddress, "register_domain_for", [
      { bytes: ownerCoinPubKey },
      key,
      len,
      parseContractAddress(childAddress),
    ]);

    await syncAndWait();
  });

  it("domain exists in TLD's domains map", async () => {
    const state = await queryLedgerState(ctx, tldAddress);
    const { key } = domainToKey(domainName);
    expect(state.domains.member(key)).toBe(true);
  });

  it("domain data has correct owner and resolver", async () => {
    const state = await queryLedgerState(ctx, tldAddress);
    const { key } = domainToKey(domainName);
    const data = state.domains.lookup(key);
    expect(data.resolver).toEqual(parseContractAddress(childAddress));
  });
});

describe("buy_domain_for (commit-reveal)", () => {
  let childContract: DeployedContract<any>;
  let childAddress: string;
  const domainName = "testbuy";
  const rand = 12345n;

  it("commits and buys a domain successfully", async () => {
    // Deploy child contract
    childContract = await deployLeafContract(ctx, {
      parentDomain: domainName,
      parentResolverAddress: tldAddress,
      targetCoinPublicKey: ownerCoinPubKey,
      domain: domainName,
    });
    childAddress = childContract.deployTxData.public.contractAddress;

    await syncAndWait();

    // Step 1: Commit
    const { key } = domainToKey(domainName);
    const owner = { bytes: ownerCoinPubKey };
    const commitment = computeCommitment(key, owner, rand);

    await callCircuit(ctx, tldAddress, "commit_domain", [commitment]);
    await syncAndWait();

    // Step 2: Buy (reveal)
    const { len } = domainToKey(domainName);
    await callCircuit(ctx, tldAddress, "buy_domain_for", [
      owner,
      key,
      len,
      parseContractAddress(childAddress),
      rand,
    ]);

    await syncAndWait();
  });

  it("domain is registered in TLD after buy", async () => {
    const state = await queryLedgerState(ctx, tldAddress);
    const { key } = domainToKey(domainName);
    expect(state.domains.member(key)).toBe(true);
  });

  it("commitment is consumed after buy", async () => {
    const state = await queryLedgerState(ctx, tldAddress);
    expect(state.commitments.isEmpty()).toBe(true);
  });
});

describe("character validation (on-chain)", () => {
  it("accepts valid lowercase domain via register_domain_for", async () => {
    const domainName = "valid";
    const { key, len } = domainToKey(domainName);
    const dummyResolver = parseContractAddress(ZERO_ADDR);

    await expect(
      callCircuit(ctx, tldAddress, "register_domain_for", [
        { bytes: ownerCoinPubKey },
        key,
        len,
        dummyResolver,
      ]),
    ).resolves.toBeDefined();

    await syncAndWait();
  });

  it("rejects uppercase domain via register_domain_for", async () => {
    // Build a key with uppercase 'A' (0x41)
    const key = new Uint8Array(32).fill(255);
    key[0] = 0x41; // 'A'
    const dummyResolver = parseContractAddress(ZERO_ADDR);

    await expect(
      callCircuit(ctx, tldAddress, "register_domain_for", [
        { bytes: ownerCoinPubKey },
        key,
        1n,
        dummyResolver,
      ]),
    ).rejects.toThrow();
  });
});

describe("fields management", () => {
  // Use the child contract from the register_domain_for test
  // We need a contract where we're the owner to manage fields

  let fieldsContract: DeployedContract<any>;
  let fieldsAddress: string;

  beforeAll(async () => {
    fieldsContract = await deployLeafContract(ctx, {
      parentDomain: "fieldstest",
      parentResolverAddress: tldAddress,
      targetCoinPublicKey: ownerCoinPubKey,
      domain: "fieldstest",
    });
    fieldsAddress = fieldsContract.deployTxData.public.contractAddress;
    await syncAndWait();
  }, 120_000);

  it("insert_field adds a field", async () => {
    await callCircuit(ctx, fieldsAddress, "insert_field", ["name", "Alice"]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, fieldsAddress);
    expect(state.fields.member("name")).toBe(true);
    expect(state.fields.lookup("name")).toBe("Alice");
  });

  it("clear_field removes a field", async () => {
    await callCircuit(ctx, fieldsAddress, "clear_field", ["name"]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, fieldsAddress);
    expect(state.fields.member("name")).toBe(false);
  });

  it("add_multiple_fields adds several fields at once", async () => {
    const kvs = [
      { is_some: true, value: ["bio", "Developer"] },
      { is_some: true, value: ["twitter", "@alice"] },
      { is_some: false, value: ["", ""] },
      { is_some: false, value: ["", ""] },
      { is_some: false, value: ["", ""] },
      { is_some: false, value: ["", ""] },
      { is_some: false, value: ["", ""] },
      { is_some: false, value: ["", ""] },
      { is_some: false, value: ["", ""] },
      { is_some: false, value: ["", ""] },
    ];
    await callCircuit(ctx, fieldsAddress, "add_multiple_fields", [kvs]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, fieldsAddress);
    expect(state.fields.member("bio")).toBe(true);
    expect(state.fields.member("twitter")).toBe(true);
  });

  it("clear_all_fields removes all fields", async () => {
    await callCircuit(ctx, fieldsAddress, "clear_all_fields", []);
    await syncAndWait();

    const state = await queryLedgerState(ctx, fieldsAddress);
    expect(state.fields.isEmpty()).toBe(true);
  });
});

describe("domain management", () => {
  const domainName = "mgmt";
  let parentAddr: string;

  beforeAll(async () => {
    // Register a domain we can manage
    const { key, len } = domainToKey(domainName);
    const resolver = parseContractAddress(ZERO_ADDR);

    await callCircuit(ctx, tldAddress, "register_domain_for", [
      { bytes: ownerCoinPubKey },
      key,
      len,
      resolver,
    ]);
    await syncAndWait();
    parentAddr = tldAddress;
  }, 120_000);

  it("set_resolver updates resolver for existing domain", async () => {
    const { key } = domainToKey(domainName);
    const newResolver = { bytes: new Uint8Array(32).fill(0xab) };

    await callCircuit(ctx, parentAddr, "set_resolver", [key, newResolver]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, parentAddr);
    expect(state.domains.lookup(key).resolver).toEqual(newResolver);
  });

  it("transfer_domain changes owner", async () => {
    const { key } = domainToKey(domainName);
    const newOwner = { bytes: new Uint8Array(32).fill(0x01) };

    await callCircuit(ctx, parentAddr, "transfer_domain", [key, newOwner]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, parentAddr);
    expect(state.domains.lookup(key).owner).toEqual(newOwner);
  });
});

describe("owner operations", () => {
  let ownedContract: DeployedContract<any>;
  let ownedAddress: string;

  beforeAll(async () => {
    ownedContract = await deployLeafContract(ctx, {
      parentDomain: "ownops",
      parentResolverAddress: tldAddress,
      targetCoinPublicKey: ownerCoinPubKey,
      domain: "ownops",
    });
    ownedAddress = ownedContract.deployTxData.public.contractAddress;
    await syncAndWait();
  }, 120_000);

  it("update_costs changes cost tiers", async () => {
    await callCircuit(ctx, ownedAddress, "update_costs", [200n, 100n, 50n]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, ownedAddress);
    expect(state.COST_SHORT).toBe(200n);
    expect(state.COST_MED).toBe(100n);
    expect(state.COST_LONG).toBe(50n);
  });

  it("update_domain_target changes DOMAIN_TARGET", async () => {
    const newTarget = {
      is_left: true,
      left: { bytes: new Uint8Array(32).fill(0xcc) },
      right: {
        is_left: true,
        left: { bytes: new Uint8Array(32) },
        right: { bytes: new Uint8Array(32) },
      },
    };
    await callCircuit(ctx, ownedAddress, "update_domain_target", [newTarget]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, ownedAddress);
    expect(state.DOMAIN_TARGET.is_left).toBe(true);
  });

  it("update_color changes COIN_COLOR", async () => {
    const newColor = new Uint8Array(32).fill(0xdd);
    await callCircuit(ctx, ownedAddress, "update_color", [newColor]);
    await syncAndWait();

    const state = await queryLedgerState(ctx, ownedAddress);
    expect(state.COIN_COLOR).toEqual(newColor);
  });
});

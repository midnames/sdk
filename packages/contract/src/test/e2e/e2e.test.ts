import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupTestEnvironment,
  setupAdditionalWallet,
  teardownTestEnvironment,
  waitForSync,
  ATTACKER_MNEMONIC,
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

describe("buy_domain_for (paid purchase)", () => {
  let childContract: DeployedContract<any>;
  let childAddress: string;
  const domainName = "testbuy";

  it("buys a domain successfully", async () => {
    // Deploy child contract
    childContract = await deployLeafContract(ctx, {
      parentDomain: domainName,
      parentResolverAddress: tldAddress,
      targetCoinPublicKey: ownerCoinPubKey,
      domain: domainName,
    });
    childAddress = childContract.deployTxData.public.contractAddress;

    await syncAndWait();

    // Buy domain
    const { key, len } = domainToKey(domainName);
    await callCircuit(ctx, tldAddress, "buy_domain_for", [
      { bytes: ownerCoinPubKey },
      key,
      len,
      parseContractAddress(childAddress),
    ]);

    await syncAndWait();
  });

  it("domain is registered in TLD after buy", async () => {
    const state = await queryLedgerState(ctx, tldAddress);
    const { key } = domainToKey(domainName);
    expect(state.domains.member(key)).toBe(true);
  });
});

describe("fields management", () => {
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

// ═══════════════════════════════════════════════════════════════════════════════
//                         ADVERSARIAL TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe("adversarial — unauthorized wallet", () => {
  let attackerCtx: TestContext;
  let attackerPubKey: Uint8Array;
  let targetAddress: string;

  beforeAll(async () => {
    // Fund and initialize attacker wallet
    attackerCtx = await setupAdditionalWallet(
      ctx.networkConfig,
      ATTACKER_MNEMONIC,
      "attacker",
    );
    attackerPubKey = getOwnerCoinPublicKey(attackerCtx);

    // Deploy a contract owned by the legitimate owner for the attacker to target
    const contract = await deployLeafContract(ctx, {
      parentDomain: "adversarial",
      parentResolverAddress: tldAddress,
      targetCoinPublicKey: ownerCoinPubKey,
      domain: "adversarial",
    });
    targetAddress = contract.deployTxData.public.contractAddress;
    await syncAndWait();

    // Register a domain so we can test domain-level ownership checks
    const { key, len } = domainToKey("owned");
    await callCircuit(ctx, targetAddress, "register_domain_for", [
      { bytes: ownerCoinPubKey },
      key,
      len,
      parseContractAddress(ZERO_ADDR),
    ]);
    await syncAndWait();
  }, 300_000);

  afterAll(async () => {
    if (attackerCtx) {
      try { await attackerCtx.walletContext.wallet.stop(); } catch { /* ignore */ }
    }
  }, 60_000);

  // ─── Contract-owner checks (DOMAIN_OWNER == ownPublicKey()) ──────────────

  it("rejects register_domain_for from non-owner", async () => {
    const { key, len } = domainToKey("stolen");
    await expect(
      callCircuit(attackerCtx, targetAddress, "register_domain_for", [
        { bytes: attackerPubKey },
        key,
        len,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects change_owner from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "change_owner", [
        { bytes: attackerPubKey },
      ]),
    ).rejects.toThrow();
  });

  it("rejects update_costs from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "update_costs", [0n, 0n, 0n]),
    ).rejects.toThrow();
  });

  it("rejects update_color from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "update_color", [
        new Uint8Array(32).fill(0xff),
      ]),
    ).rejects.toThrow();
  });

  it("rejects update_default_field from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "update_default_field", [
        { is_some: true, value: "hacked" },
      ]),
    ).rejects.toThrow();
  });

  it("rejects insert_field from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "insert_field", [
        "evil",
        "payload",
      ]),
    ).rejects.toThrow();
  });

  it("rejects clear_all_fields from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "clear_all_fields", []),
    ).rejects.toThrow();
  });

  it("rejects update_domain_target from non-owner", async () => {
    const newTarget = {
      is_left: true,
      left: { bytes: new Uint8Array(32).fill(0xee) },
      right: {
        is_left: true,
        left: { bytes: new Uint8Array(32) },
        right: { bytes: new Uint8Array(32) },
      },
    };
    await expect(
      callCircuit(attackerCtx, targetAddress, "update_domain_target", [
        newTarget,
      ]),
    ).rejects.toThrow();
  });

  it("rejects update_target_and_fields from non-owner", async () => {
    const newTarget = {
      is_left: true,
      left: { bytes: new Uint8Array(32).fill(0xee) },
      right: {
        is_left: true,
        left: { bytes: new Uint8Array(32) },
        right: { bytes: new Uint8Array(32) },
      },
    };
    const kvs = Array(10).fill({ is_some: false, value: ["", ""] });
    kvs[0] = { is_some: true, value: ["evil", "data"] };
    await expect(
      callCircuit(attackerCtx, targetAddress, "update_target_and_fields", [
        newTarget,
        kvs,
      ]),
    ).rejects.toThrow();
  });

  // ─── Domain-owner checks (current_data.owner == ownPublicKey()) ──────────

  it("rejects set_resolver from non-domain-owner", async () => {
    const { key } = domainToKey("owned");
    const newResolver = { bytes: new Uint8Array(32).fill(0xbb) };
    await expect(
      callCircuit(attackerCtx, targetAddress, "set_resolver", [
        key,
        newResolver,
      ]),
    ).rejects.toThrow();
  });

  it("rejects transfer_domain from non-domain-owner", async () => {
    const { key } = domainToKey("owned");
    await expect(
      callCircuit(attackerCtx, targetAddress, "transfer_domain", [
        key,
        { bytes: attackerPubKey },
      ]),
    ).rejects.toThrow();
  });

  // ─── Verify state was not mutated by any attacker attempt ─────────────────

  it("contract state is unchanged after all attacker attempts", async () => {
    const state = await queryLedgerState(ctx, targetAddress);
    // Owner should still be the original
    expect(state.DOMAIN_OWNER).toEqual({ bytes: ownerCoinPubKey });
    // "owned" domain should still belong to the original owner
    const { key } = domainToKey("owned");
    expect(state.domains.lookup(key).owner).toEqual({ bytes: ownerCoinPubKey });
    // No evil fields were inserted
    expect(state.fields.member("evil")).toBe(false);
  });
});

describe("adversarial — buy_domain_for disabled", () => {
  let disabledBuyAddress: string;

  beforeAll(async () => {
    const contract = await deployLeafContract(ctx, {
      parentDomain: "nobuy",
      parentResolverAddress: tldAddress,
      targetCoinPublicKey: ownerCoinPubKey,
      domain: "nobuy",
      buyEnabled: false,
    });
    disabledBuyAddress = contract.deployTxData.public.contractAddress;
    await syncAndWait();
  }, 120_000);

  it("rejects buy_domain_for when BUY_ENABLED is false", async () => {
    const { key, len } = domainToKey("attempt");
    await expect(
      callCircuit(ctx, disabledBuyAddress, "buy_domain_for", [
        { bytes: ownerCoinPubKey },
        key,
        len,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("ledger still has no domains after rejected buy", async () => {
    const state = await queryLedgerState(ctx, disabledBuyAddress);
    expect(state.domains.isEmpty()).toBe(true);
    expect(state.BUY_ENABLED).toBe(false);
  });
});

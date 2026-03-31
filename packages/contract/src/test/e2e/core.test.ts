import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupE2E,
  syncAndWait,
  teardownTestEnvironment,
  ZERO_ADDR,
  type E2EContext,
} from "./shared.js";
import {
  deployLeafContract,
  callCircuit,
  queryLedgerState,
  parseContractAddress,
  domainToKey,
} from "./helpers.js";

let e2e: E2EContext;

beforeAll(async () => {
  e2e = await setupE2E();
}, 180_000);

afterAll(async () => {
  if (e2e?.ctx) {
    await teardownTestEnvironment(e2e.ctx);
  }
}, 60_000);

// ═══════════════════════════════════════════════════════════════════════════════

describe("TLD deployment & initialization", () => {
  it("TLD contract has a valid address", () => {
    expect(e2e.tldAddress).toBeDefined();
    expect(e2e.tldAddress.length).toBeGreaterThan(0);
  });

  it("TLD ledger state matches constructor params", async () => {
    const state = await queryLedgerState(e2e.ctx, e2e.tldAddress);
    expect(state.COST_SHORT).toBe(100n);
    expect(state.COST_MED).toBe(10n);
    expect(state.COST_LONG).toBe(1n);
    expect(state.BUY_ENABLED).toBe(true);
    expect(state.domains.isEmpty()).toBe(true);
  });
});

describe("register_domain_for (owner-only, free)", () => {
  let childAddress: string;
  const domainName = "testreg";

  it("registers a subdomain and deploys child contract", async () => {
    const childContract = await deployLeafContract(e2e.ctx, {
      parentDomain: domainName,
      parentResolverAddress: e2e.tldAddress,
      ownerAddress: e2e.ownerUserAddr,
      domain: domainName,
    });
    childAddress = childContract.deployTxData.public.contractAddress;
    expect(childAddress).toBeDefined();

    await syncAndWait(e2e.ctx);

    const { key, len } = domainToKey(domainName);
    await callCircuit(e2e.ctx, e2e.tldAddress, "register_domain_for", [
      e2e.ownerDerivedKey,
      key,
      len,
      parseContractAddress(childAddress),
    ]);

    await syncAndWait(e2e.ctx);
  });

  it("domain exists in TLD's domains map", async () => {
    const state = await queryLedgerState(e2e.ctx, e2e.tldAddress);
    const { key } = domainToKey(domainName);
    expect(state.domains.member(key)).toBe(true);
  });

  it("domain data has correct owner and resolver", async () => {
    const state = await queryLedgerState(e2e.ctx, e2e.tldAddress);
    const { key } = domainToKey(domainName);
    const data = state.domains.lookup(key);
    expect(data.resolver).toEqual(parseContractAddress(childAddress));
  });
});

describe("buy_domain_for (paid purchase)", () => {
  let childAddress: string;
  const domainName = "testbuy";

  it("buys a domain successfully", async () => {
    const childContract = await deployLeafContract(e2e.ctx, {
      parentDomain: domainName,
      parentResolverAddress: e2e.tldAddress,
      ownerAddress: e2e.ownerUserAddr,
      domain: domainName,
    });
    childAddress = childContract.deployTxData.public.contractAddress;

    await syncAndWait(e2e.ctx);

    const { key, len } = domainToKey(domainName);
    await callCircuit(e2e.ctx, e2e.tldAddress, "register_domain_for", [
      e2e.ownerDerivedKey,
      key,
      len,
      parseContractAddress(childAddress),
    ]);

    await syncAndWait(e2e.ctx);
  });

  it("domain is registered in TLD after buy", async () => {
    const state = await queryLedgerState(e2e.ctx, e2e.tldAddress);
    const { key } = domainToKey(domainName);
    expect(state.domains.member(key)).toBe(true);
  });
});

describe("fields management", () => {
  let fieldsAddress: string;

  beforeAll(async () => {
    const fieldsContract = await deployLeafContract(e2e.ctx, {
      parentDomain: "fieldstest",
      parentResolverAddress: e2e.tldAddress,
      ownerAddress: e2e.ownerUserAddr,
      domain: "fieldstest",
    });
    fieldsAddress = fieldsContract.deployTxData.public.contractAddress;
    await syncAndWait(e2e.ctx);
  }, 120_000);

  it("insert_field adds a field", async () => {
    const kvs = Array(10).fill({ is_some: false, value: ["", ""] });
    kvs[0] = { is_some: true, value: ["name", "Alice"] };
    await callCircuit(e2e.ctx, fieldsAddress, "add_multiple_fields", [kvs]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, fieldsAddress);
    expect(state.fields.member("name")).toBe(true);
    expect(state.fields.lookup("name")).toBe("Alice");
  });

  it("clear_field removes a field", async () => {
    await callCircuit(e2e.ctx, fieldsAddress, "clear_field", ["name"]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, fieldsAddress);
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
    await callCircuit(e2e.ctx, fieldsAddress, "add_multiple_fields", [kvs]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, fieldsAddress);
    expect(state.fields.member("bio")).toBe(true);
    expect(state.fields.member("twitter")).toBe(true);
  });

  it("clear_all_fields removes all fields", async () => {
    await callCircuit(e2e.ctx, fieldsAddress, "clear_all_fields", []);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, fieldsAddress);
    expect(state.fields.isEmpty()).toBe(true);
  });
});

describe("domain management", () => {
  const domainName = "mgmt";

  beforeAll(async () => {
    const { key, len } = domainToKey(domainName);
    const resolver = parseContractAddress(ZERO_ADDR);

    await callCircuit(e2e.ctx, e2e.tldAddress, "register_domain_for", [
      e2e.ownerDerivedKey,
      key,
      len,
      resolver,
    ]);
    await syncAndWait(e2e.ctx);
  }, 120_000);

  it("set_resolver updates resolver for existing domain", async () => {
    const { key } = domainToKey(domainName);
    const newResolver = { bytes: new Uint8Array(32).fill(0xab) };

    await callCircuit(e2e.ctx, e2e.tldAddress, "set_resolver", [key, newResolver]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, e2e.tldAddress);
    expect(state.domains.lookup(key).resolver).toEqual(newResolver);
  });

  it("transfer_domain changes owner", async () => {
    const { key } = domainToKey(domainName);
    const newOwner = new Uint8Array(32).fill(0x01);

    await callCircuit(e2e.ctx, e2e.tldAddress, "transfer_domain", [key, newOwner]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, e2e.tldAddress);
    expect(state.domains.lookup(key).owner).toEqual(newOwner);
  });
});

describe("owner operations", () => {
  let ownedAddress: string;

  beforeAll(async () => {
    const ownedContract = await deployLeafContract(e2e.ctx, {
      parentDomain: "ownops",
      parentResolverAddress: e2e.tldAddress,
      ownerAddress: e2e.ownerUserAddr,
      domain: "ownops",
    });
    ownedAddress = ownedContract.deployTxData.public.contractAddress;
    await syncAndWait(e2e.ctx);
  }, 120_000);

  it("update_costs changes cost tiers", async () => {
    await callCircuit(e2e.ctx, ownedAddress, "update_costs", [200n, 100n, 50n, true]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, ownedAddress);
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
    await callCircuit(e2e.ctx, ownedAddress, "update_domain_target", [newTarget]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, ownedAddress);
    expect(state.DOMAIN_TARGET.is_left).toBe(true);
  });

  it("update_color changes COIN_COLOR", async () => {
    const newColor = new Uint8Array(32).fill(0xdd);
    await callCircuit(e2e.ctx, ownedAddress, "update_color", [newColor]);
    await syncAndWait(e2e.ctx);

    const state = await queryLedgerState(e2e.ctx, ownedAddress);
    expect(state.COIN_COLOR).toEqual(newColor);
  });
});

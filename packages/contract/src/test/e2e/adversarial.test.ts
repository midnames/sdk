import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupAdditionalWallet,
  waitForSync,
  ATTACKER_MNEMONIC,
  type TestContext,
} from "./setup.js";
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
  getOwnerCoinPublicKey,
  getDerivedPublicKey,
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

describe("adversarial — unauthorized wallet", () => {
  let attackerCtx: TestContext;
  let attackerPubKey: Uint8Array;
  let targetAddress: string;
  let ownerDerivedKeyForTarget: Uint8Array;

  beforeAll(async () => {
    attackerCtx = await setupAdditionalWallet(
      e2e.ctx.networkConfig,
      ATTACKER_MNEMONIC,
      "attacker",
    );
    attackerPubKey = getOwnerCoinPublicKey(attackerCtx);

    const contract = await deployLeafContract(e2e.ctx, {
      parentDomain: "adversarial",
      parentResolverAddress: e2e.tldAddress,
      ownerAddress: e2e.ownerUserAddr,
      domain: "adversarial",
    });
    targetAddress = contract.deployTxData.public.contractAddress;
    await syncAndWait(e2e.ctx);

    ownerDerivedKeyForTarget = await getDerivedPublicKey(e2e.ctx, targetAddress);

    const { key, len } = domainToKey("owned");
    await callCircuit(e2e.ctx, targetAddress, "register_domain_for", [
      ownerDerivedKeyForTarget,
      key,
      len,
      parseContractAddress(ZERO_ADDR),
    ]);
    await syncAndWait(e2e.ctx);
  }, 300_000);

  afterAll(async () => {
    if (attackerCtx) {
      try { await attackerCtx.walletContext.wallet.stop(); } catch { /* ignore */ }
    }
  }, 60_000);

  // ─── Contract-owner checks ────────────────────────────────────────────────

  it("rejects register_domain_for from non-owner", async () => {
    const { key, len } = domainToKey("stolen");
    await expect(
      callCircuit(attackerCtx, targetAddress, "register_domain_for", [
        attackerPubKey,
        key,
        len,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects change_owner from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "change_owner", [
        attackerPubKey,
        { bytes: new Uint8Array(32).fill(0xff) },
      ]),
    ).rejects.toThrow();
  });

  it("rejects update_costs from non-owner", async () => {
    await expect(
      callCircuit(attackerCtx, targetAddress, "update_costs", [0n, 0n, 0n, true]),
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

  it("rejects add_multiple_fields from non-owner", async () => {
    const kvs = Array(10).fill({ is_some: false, value: ["", ""] });
    kvs[0] = { is_some: true, value: ["evil", "payload"] };
    await expect(
      callCircuit(attackerCtx, targetAddress, "add_multiple_fields", [kvs]),
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

  // ─── Domain-owner checks ──────────────────────────────────────────────────

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
        attackerPubKey,
      ]),
    ).rejects.toThrow();
  });

  // ─── Verify state unchanged ───────────────────────────────────────────────

  it("contract state is unchanged after all attacker attempts", async () => {
    const state = await queryLedgerState(e2e.ctx, targetAddress);
    expect(state.DOMAIN_OWNER[0]).toEqual(ownerDerivedKeyForTarget);
    const { key } = domainToKey("owned");
    expect(state.domains.lookup(key).owner).toEqual(ownerDerivedKeyForTarget);
    expect(state.fields.member("evil")).toBe(false);
  });
});

describe("adversarial — register_domain_for disabled", () => {
  let disabledBuyAddress: string;
  let buyerCtx: TestContext;

  beforeAll(async () => {
    buyerCtx = await setupAdditionalWallet(
      e2e.ctx.networkConfig,
      ATTACKER_MNEMONIC,
      "buyer-nobuy",
    );

    const contract = await deployLeafContract(e2e.ctx, {
      parentDomain: "nobuy",
      parentResolverAddress: e2e.tldAddress,
      ownerAddress: e2e.ownerUserAddr,
      domain: "nobuy",
      buyEnabled: false,
    });
    disabledBuyAddress = contract.deployTxData.public.contractAddress;
    await syncAndWait(e2e.ctx);
  }, 300_000);

  afterAll(async () => {
    if (buyerCtx) {
      try { await buyerCtx.walletContext.wallet.stop(); } catch { /* ignore */ }
    }
  }, 60_000);

  it("rejects register_domain_for from non-owner when BUY_ENABLED is false", async () => {
    const { key, len } = domainToKey("attempt");
    await expect(
      callCircuit(buyerCtx, disabledBuyAddress, "register_domain_for", [
        getOwnerCoinPublicKey(buyerCtx),
        key,
        len,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("ledger still has no domains after rejected buy", async () => {
    const state = await queryLedgerState(e2e.ctx, disabledBuyAddress);
    expect(state.domains.isEmpty()).toBe(true);
    expect(state.BUY_ENABLED).toBe(false);
  });
});


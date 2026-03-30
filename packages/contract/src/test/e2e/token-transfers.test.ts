import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupAdditionalWallet,
  getUnshieldedBalance,
  waitForBalanceChange,
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

describe("buy_domain_for — token transfers", () => {
  let buyerCtx: TestContext;
  let buyerPubKey: Uint8Array;
  let shopAddress: string;

  beforeAll(async () => {
    buyerCtx = await setupAdditionalWallet(
      e2e.ctx.networkConfig,
      ATTACKER_MNEMONIC,
      "buyer",
    );
    buyerPubKey = getOwnerCoinPublicKey(buyerCtx);

    const contract = await deployLeafContract(e2e.ctx, {
      parentDomain: "shop",
      parentResolverAddress: e2e.tldAddress,
      ownerAddress: e2e.ownerUserAddr,
      domain: "shop",
      buyEnabled: true,
    });
    shopAddress = contract.deployTxData.public.contractAddress;
    await syncAndWait(e2e.ctx);
  }, 300_000);

  afterAll(async () => {
    if (buyerCtx) {
      try { await buyerCtx.walletContext.wallet.stop(); } catch { /* ignore */ }
    }
  }, 60_000);

  it("buyer's balance decreases after purchasing a domain (5+ chars, cost=1)", async () => {
    const buyerBefore = await getUnshieldedBalance(buyerCtx.walletContext.wallet);

    const { key, len } = domainToKey("longtx");
    await callCircuit(buyerCtx, shopAddress, "buy_domain_for", [
      buyerPubKey,
      key,
      len,
      parseContractAddress(ZERO_ADDR),
    ]);

    // Wait until the buyer's balance actually changes
    const buyerAfter = await waitForBalanceChange(
      buyerCtx.walletContext.wallet,
      buyerBefore,
    );

    // Buyer paid at least COST_LONG (1n) plus tx fees
    expect(buyerBefore - buyerAfter).toBeGreaterThanOrEqual(1n);
  });

  it("owner receives payment for a short domain (≤3 chars, cost=100)", async () => {
    const ownerBefore = await getUnshieldedBalance(e2e.ctx.walletContext.wallet);
    const buyerBefore = await getUnshieldedBalance(buyerCtx.walletContext.wallet);

    const { key, len } = domainToKey("abc");
    await callCircuit(buyerCtx, shopAddress, "buy_domain_for", [
      buyerPubKey,
      key,
      len,
      parseContractAddress(ZERO_ADDR),
    ]);

    // Wait for both wallets to reflect the transfer
    const [ownerAfter, buyerAfter] = await Promise.all([
      waitForBalanceChange(e2e.ctx.walletContext.wallet, ownerBefore),
      waitForBalanceChange(buyerCtx.walletContext.wallet, buyerBefore),
    ]);

    // Owner should have received COST_SHORT (100n)
    expect(ownerAfter - ownerBefore).toBeGreaterThanOrEqual(100n);
    // Buyer should have paid at least COST_SHORT (100n) plus fees
    expect(buyerBefore - buyerAfter).toBeGreaterThanOrEqual(100n);
  });

  it("owner receives payment for a medium domain (4 chars, cost=10)", async () => {
    const ownerBefore = await getUnshieldedBalance(e2e.ctx.walletContext.wallet);
    const buyerBefore = await getUnshieldedBalance(buyerCtx.walletContext.wallet);

    const { key, len } = domainToKey("four");
    await callCircuit(buyerCtx, shopAddress, "buy_domain_for", [
      buyerPubKey,
      key,
      len,
      parseContractAddress(ZERO_ADDR),
    ]);

    const [ownerAfter, buyerAfter] = await Promise.all([
      waitForBalanceChange(e2e.ctx.walletContext.wallet, ownerBefore),
      waitForBalanceChange(buyerCtx.walletContext.wallet, buyerBefore),
    ]);

    // Owner should have received COST_MED (10n)
    expect(ownerAfter - ownerBefore).toBeGreaterThanOrEqual(10n);
    // Buyer should have paid at least COST_MED (10n) plus fees
    expect(buyerBefore - buyerAfter).toBeGreaterThanOrEqual(10n);
  });

  it("domain is correctly registered to the buyer after purchase", async () => {
    const state = await queryLedgerState(e2e.ctx, shopAddress);

    for (const name of ["longtx", "abc", "four"]) {
      const { key } = domainToKey(name);
      expect(state.domains.member(key)).toBe(true);
      expect(state.domains.lookup(key).owner).toEqual(buyerPubKey);
    }
  });
});

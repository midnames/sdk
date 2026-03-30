import {
  setupTestEnvironment,
  teardownTestEnvironment,
  waitForSync,
  type TestContext,
} from "./setup.js";
import {
  deployLeafContract,
  waitForIndexer,
  getDerivedPublicKey,
  getOwnerUserAddress,
} from "./helpers.js";

export const ZERO_ADDR =
  "0000000000000000000000000000000000000000000000000000000000000000";

export interface E2EContext {
  ctx: TestContext;
  tldAddress: string;
  ownerDerivedKey: Uint8Array;
  ownerUserAddr: Uint8Array;
}

export async function setupE2E(): Promise<E2EContext> {
  const ctx = await setupTestEnvironment();
  const ownerUserAddr = getOwnerUserAddress(ctx);

  console.log("[e2e] Deploying TLD contract...");
  const tldContract = await deployLeafContract(ctx, {
    parentDomain: null,
    parentResolverAddress: ZERO_ADDR,
    ownerAddress: ownerUserAddr,
    domain: null,
    buyEnabled: true,
  });
  const tldAddress = tldContract.deployTxData.public.contractAddress;

  await waitForIndexer();
  await waitForSync(ctx.walletContext.wallet);

  const ownerDerivedKey = await getDerivedPublicKey(ctx, tldAddress);

  return { ctx, tldAddress, ownerDerivedKey, ownerUserAddr };
}

export async function syncAndWait(ctx: TestContext): Promise<void> {
  await waitForIndexer();
  await waitForSync(ctx.walletContext.wallet);
}

export { teardownTestEnvironment };

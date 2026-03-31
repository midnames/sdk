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
  getDerivedPublicKey,
  parseContractAddress,
} from "./helpers.js";

let e2e: E2EContext;
let testContractAddress: string;
let ownerDerivedKeyForTest: Uint8Array;

beforeAll(async () => {
  e2e = await setupE2E();

  const contract = await deployLeafContract(e2e.ctx, {
    parentDomain: "stringtest",
    parentResolverAddress: e2e.tldAddress,
    ownerAddress: e2e.ownerUserAddr,
    domain: "stringtest",
  });
  testContractAddress = contract.deployTxData.public.contractAddress;
  await syncAndWait(e2e.ctx);

  ownerDerivedKeyForTest = await getDerivedPublicKey(e2e.ctx, testContractAddress);
}, 180_000);

afterAll(async () => {
  if (e2e?.ctx) {
    await teardownTestEnvironment(e2e.ctx);
  }
}, 60_000);

// ═══════════════════════════════════════════  npx vitest run --config vitest.e2e.config.ts src/test/e2e/string-validation.test.ts
// Helper to create a domain key with proper padding
// ═══════════════════════════════════════════════════════════════════════════════

function createDomainKey(bytes: number[]): Uint8Array {
  const key = new Uint8Array(32).fill(255);
  for (let i = 0; i < bytes.length; i++) {
    key[i] = bytes[i];
  }
  return key;
}

function stringToBytes(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Valid domain names (positive cases)
// ═══════════════════════════════════════════════════════════════════════════════

describe("string validation — valid domains", () => {
  it("accepts hyphen in middle (te-st)", async () => {
    const name = "te-st";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).resolves.toBeDefined();
    await syncAndWait(e2e.ctx);
  });

  it("accepts all numeric domain (123)", async () => {
    const name = "123";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).resolves.toBeDefined();
    await syncAndWait(e2e.ctx);
  });

  it("accepts mixed alphanumeric (test123)", async () => {
    const name = "test123";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).resolves.toBeDefined();
    await syncAndWait(e2e.ctx);
  });

  it("accepts single character domain (a)", async () => {
    const name = "a";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).resolves.toBeDefined();
    await syncAndWait(e2e.ctx);
  });

  it("accepts maximum length domain (32 chars)", async () => {
    const name = "a".repeat(32);
    const key = new Uint8Array(32).fill(0x61); // all 'a', no padding needed
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        32n,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).resolves.toBeDefined();
    await syncAndWait(e2e.ctx);
  });

  it("accepts multiple hyphens in middle (a-b-c)", async () => {
    const name = "a-b-c";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).resolves.toBeDefined();
    await syncAndWait(e2e.ctx);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Invalid character tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("string validation — invalid characters", () => {
  it("rejects uppercase letters (ALICE)", async () => {
    const name = "ALICE";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects mixed case (Alice)", async () => {
    const name = "Alice";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects special character (!)", async () => {
    const name = "test!";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects at symbol (@)", async () => {
    const name = "a@b";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects space character", async () => {
    const name = "te st";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects underscore (_)", async () => {
    const name = "te_st";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects dot (.)", async () => {
    const name = "te.st";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects hash (#)", async () => {
    const name = "test#1";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unicode and non-ASCII tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("string validation — unicode rejection", () => {
  it("rejects accented character (e with acute)", async () => {
    // 'é' is 0xC3 0xA9 in UTF-8
    const bytes = [0x74, 0x65, 0xc3, 0xa9, 0x73, 0x74]; // "tést" in UTF-8
    const key = createDomainKey(bytes);
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(bytes.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects emoji", async () => {
    // Fire emoji is 0xF0 0x9F 0x94 0xA5 in UTF-8
    const bytes = [0xf0, 0x9f, 0x94, 0xa5];
    const key = createDomainKey(bytes);
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(bytes.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects high-byte characters (0x80+)", async () => {
    const bytes = [0x74, 0x65, 0x80, 0x73, 0x74]; // "te\x80st"
    const key = createDomainKey(bytes);
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(bytes.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Hyphen position tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("string validation — hyphen positioning", () => {
  it("rejects hyphen at start (-test)", async () => {
    const name = "-test";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects hyphen at end (test-)", async () => {
    const name = "test-";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects all hyphens (---)", async () => {
    const name = "---";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects single hyphen only (-)", async () => {
    const name = "-";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects hyphen at both ends (-test-)", async () => {
    const name = "-test-";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Length boundary tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("string validation — length boundaries", () => {
  it("rejects empty domain (len=0)", async () => {
    const key = new Uint8Array(32).fill(255);
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        0n,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects len > 32", async () => {
    const key = new Uint8Array(32).fill(0x61);
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        33n,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Padding validation tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("string validation — padding", () => {
  it("rejects non-0xFF byte in padding region", async () => {
    // "ab" with invalid padding (0x00 instead of 0xFF at position 2)
    const key = new Uint8Array(32).fill(255);
    key[0] = 0x61; // 'a'
    key[1] = 0x62; // 'b'
    key[2] = 0x00; // should be 0xFF
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        2n,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects partial invalid padding", async () => {
    // "test" with one invalid padding byte in the middle of padding
    const key = new Uint8Array(32).fill(255);
    key[0] = 0x74; // 't'
    key[1] = 0x65; // 'e'
    key[2] = 0x73; // 's'
    key[3] = 0x74; // 't'
    key[10] = 0x00; // invalid padding byte
    await expect(
      callCircuit(e2e.ctx, testContractAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        4n,
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buy_domain_for validation (same rules apply)
// ═══════════════════════════════════════════════════════════════════════════════

describe("string validation — buy_domain_for", () => {
  it("rejects uppercase in buy_domain_for", async () => {
    const name = "BUYTEST";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, e2e.tldAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects hyphen at start in buy_domain_for", async () => {
    const name = "-buytest";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, e2e.tldAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });

  it("rejects special chars in buy_domain_for", async () => {
    const name = "buy@test";
    const key = createDomainKey(stringToBytes(name));
    await expect(
      callCircuit(e2e.ctx, e2e.tldAddress, "register_domain_for", [
        ownerDerivedKeyForTest,
        key,
        BigInt(name.length),
        parseContractAddress(ZERO_ADDR),
      ]),
    ).rejects.toThrow();
  });
});

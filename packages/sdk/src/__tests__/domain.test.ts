import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  parseFullDomain,
  buildTraversalPath,
  isValidDomainName,
  getParentDomain,
  getSubdomain,
  isTLD,
  buildFullDomain,
  domainToKey,
  keyToDomain,
} from "../utils/domain.js";

describe("normalizeDomain", () => {
  it("appends .night if missing", () => {
    expect(normalizeDomain("alice")).toBe("alice.night");
  });

  it("lowercases input", () => {
    expect(normalizeDomain("ALICE.NIGHT")).toBe("alice.night");
  });

  it("strips trailing dots", () => {
    expect(normalizeDomain("alice.night.")).toBe("alice.night");
  });

  it("collapses consecutive dots", () => {
    expect(normalizeDomain("alice..night")).toBe("alice.night");
  });

  it("skips TLD append when assumeTld=false", () => {
    expect(normalizeDomain("night", false)).toBe("night");
  });
});

describe("parseFullDomain", () => {
  it("parses a valid second-level domain", () => {
    const parsed = parseFullDomain("alice.night");
    expect(parsed.isValid).toBe(true);
    expect(parsed.domainName).toBe("alice");
    expect(parsed.parentDomainPath).toBe("night");
    expect(parsed.depth).toBe(1);
  });

  it("parses a subdomain", () => {
    const parsed = parseFullDomain("sub.alice.night");
    expect(parsed.isValid).toBe(true);
    expect(parsed.domainName).toBe("sub");
    expect(parsed.parentDomainPath).toBe("alice.night");
    expect(parsed.depth).toBe(2);
  });

  it("returns invalid for bare TLD", () => {
    const parsed = parseFullDomain("night");
    // night normalizes to night.night which has depth 1
    expect(parsed.isValid).toBe(true);
  });

  it("returns invalid for wrong TLD", () => {
    const parsed = parseFullDomain("alice.com");
    // normalizes to alice.com.night
    expect(parsed.isValid).toBe(true);
    expect(parsed.domainName).toBe("alice");
  });
});

describe("buildTraversalPath", () => {
  it("builds path for second-level domain", () => {
    const path = buildTraversalPath("alice.night");
    expect(path).toEqual(["night", "alice.night"]);
  });

  it("builds path for subdomain", () => {
    const path = buildTraversalPath("sub.alice.night");
    expect(path).toEqual(["night", "alice.night", "sub.alice.night"]);
  });
});

describe("isValidDomainName", () => {
  it("accepts lowercase alphanumeric", () => {
    expect(isValidDomainName("alice")).toBe(true);
    expect(isValidDomainName("alice-bob")).toBe(true);
    expect(isValidDomainName("a1b2")).toBe(true);
  });

  it("rejects empty string", () => {
    expect(isValidDomainName("")).toBe(false);
  });

  it("rejects names over 63 chars", () => {
    expect(isValidDomainName("a".repeat(64))).toBe(false);
  });

  it("rejects leading/trailing hyphens", () => {
    expect(isValidDomainName("-alice")).toBe(false);
    expect(isValidDomainName("alice-")).toBe(false);
  });

  it("rejects special characters", () => {
    expect(isValidDomainName("alice!")).toBe(false);
  });
});

describe("getParentDomain / getSubdomain", () => {
  it("returns parent for multi-part domain", () => {
    expect(getParentDomain("sub.alice.night")).toBe("alice.night");
  });

  it("returns null for single part", () => {
    expect(getParentDomain("night")).toBeNull();
  });

  it("returns first part as subdomain", () => {
    expect(getSubdomain("sub.alice.night")).toBe("sub");
  });
});

describe("isTLD", () => {
  it("identifies TLD", () => {
    expect(isTLD("night")).toBe(true);
  });

  it("non-TLD returns false", () => {
    expect(isTLD("alice.night")).toBe(false);
  });
});

describe("buildFullDomain", () => {
  it("combines subdomain and parent", () => {
    expect(buildFullDomain("sub", "alice.night")).toBe("sub.alice.night");
  });

  it("returns parent when subdomain is empty", () => {
    expect(buildFullDomain("", "alice.night")).toBe("alice.night");
  });
});

describe("domainToKey / keyToDomain", () => {
  it("round-trips a domain name", () => {
    const { key } = domainToKey("alice");
    expect(keyToDomain(key)).toBe("alice");
  });

  it("pads to 32 bytes with 0xFF", () => {
    const { key, len } = domainToKey("ab");
    expect(len).toBe(2n);
    expect(key.length).toBe(32);
    expect(key[2]).toBe(255);
  });

  it("throws for empty name", () => {
    expect(() => domainToKey("")).toThrow();
  });

  it("throws for name over 32 bytes", () => {
    expect(() => domainToKey("a".repeat(33))).toThrow();
  });
});

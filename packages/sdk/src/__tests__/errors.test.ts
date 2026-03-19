import { describe, it, expect } from "vitest";
import {
  MidnamesError,
  NetworkError,
  ContractNotFoundError,
  DomainNotFoundError,
  InvalidDomainError,
  ProviderError,
} from "../errors.js";

describe("MidnamesError", () => {
  it("stores message, code, and details", () => {
    const err = new MidnamesError("boom", "TEST_CODE", { extra: 1 });
    expect(err.message).toBe("boom");
    expect(err.code).toBe("TEST_CODE");
    expect(err.details).toEqual({ extra: 1 });
    expect(err.name).toBe("MidnamesError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("NetworkError", () => {
  it("has NETWORK_ERROR code", () => {
    const err = new NetworkError("timeout");
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.name).toBe("NetworkError");
    expect(err).toBeInstanceOf(MidnamesError);
  });
});

describe("ContractNotFoundError", () => {
  it("includes contract address in message", () => {
    const err = new ContractNotFoundError("abc123");
    expect(err.message).toContain("abc123");
    expect(err.code).toBe("CONTRACT_NOT_FOUND");
  });
});

describe("DomainNotFoundError", () => {
  it("includes domain in message", () => {
    const err = new DomainNotFoundError("test.night");
    expect(err.message).toContain("test.night");
    expect(err.code).toBe("DOMAIN_NOT_FOUND");
  });
});

describe("InvalidDomainError", () => {
  it("includes domain and reason", () => {
    const err = new InvalidDomainError("bad!", "contains special chars");
    expect(err.message).toContain("bad!");
    expect(err.message).toContain("contains special chars");
    expect(err.code).toBe("INVALID_DOMAIN");
  });
});

describe("ProviderError", () => {
  it("has PROVIDER_ERROR code", () => {
    const err = new ProviderError("connection refused");
    expect(err.code).toBe("PROVIDER_ERROR");
    expect(err.name).toBe("ProviderError");
  });
});

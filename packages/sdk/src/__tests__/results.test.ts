import { describe, it, expect } from "vitest";
import {
  success,
  failure,
  match,
  map,
  flatMap,
  mapError,
  recover,
  wrapAsync,
  chain,
  combine,
} from "../results.js";
import { MidnamesError, NetworkError } from "../errors.js";

describe("success / failure", () => {
  it("success creates a success result", () => {
    const r = success(42);
    expect(r.success).toBe(true);
    expect(r.data).toBe(42);
  });

  it("failure creates a failure result", () => {
    const err = new MidnamesError("oops", "TEST");
    const r = failure(err);
    expect(r.success).toBe(false);
    expect(r.error).toBe(err);
  });
});

describe("match", () => {
  it("calls success branch on success", () => {
    const r = success("hello");
    const out = match(r, {
      success: (d) => d.toUpperCase(),
      error: () => "fail",
    });
    expect(out).toBe("HELLO");
  });

  it("calls error branch on failure", () => {
    const r = failure(new MidnamesError("err", "X"));
    const out = match(r, {
      success: () => "ok",
      error: (e) => e.code,
    });
    expect(out).toBe("X");
  });
});

describe("map", () => {
  it("transforms success value", () => {
    const r = map(success(3), (x) => x * 2);
    expect(r.success && r.data).toBe(6);
  });

  it("passes through failure", () => {
    const err = new MidnamesError("err", "X");
    const r = map(failure(err), () => 99);
    expect(!r.success && r.error).toBe(err);
  });
});

describe("flatMap", () => {
  it("chains successful results", () => {
    const r = flatMap(success(5), (x) => success(x + 1));
    expect(r.success && r.data).toBe(6);
  });

  it("short-circuits on failure", () => {
    const err = new MidnamesError("err", "X");
    const r = flatMap(failure(err), () => success(99));
    expect(!r.success && r.error).toBe(err);
  });
});

describe("mapError", () => {
  it("transforms error", () => {
    const r = mapError(failure(new MidnamesError("a", "A")), (e) => new NetworkError(e.message));
    expect(!r.success && r.error.code).toBe("NETWORK_ERROR");
  });

  it("passes through success", () => {
    const r = mapError(success(1), () => new NetworkError("x"));
    expect(r.success && r.data).toBe(1);
  });
});

describe("recover", () => {
  it("recovers from failure with fallback", () => {
    const r = recover(failure(new MidnamesError("err", "X")), () => 0);
    expect(r.success && r.data).toBe(0);
  });

  it("passes through success", () => {
    const r = recover(success(42), () => 0);
    expect(r.success && r.data).toBe(42);
  });
});

describe("wrapAsync", () => {
  it("wraps resolved promise as success", async () => {
    const r = await wrapAsync(async () => 42);
    expect(r.success && r.data).toBe(42);
  });

  it("wraps MidnamesError as failure", async () => {
    const err = new NetworkError("down");
    const r = await wrapAsync(async () => { throw err; });
    expect(!r.success && r.error).toBe(err);
  });

  it("wraps unknown error as UNKNOWN_ERROR", async () => {
    const r = await wrapAsync(async () => { throw "string error"; });
    expect(!r.success && r.error.code).toBe("UNKNOWN_ERROR");
    expect(!r.success && r.error.message).toBe("string error");
  });
});

describe("chain", () => {
  it("supports fluent API", () => {
    const result = chain(success(10))
      .map((x) => x * 2)
      .map((x) => x + 1)
      .unwrap();
    expect(result.success && result.data).toBe(21);
  });
});

describe("combine", () => {
  it("combines multiple successes", () => {
    const r = combine([success(1), success(2), success(3)] as const);
    expect(r.success && r.data).toEqual([1, 2, 3]);
  });

  it("returns first failure", () => {
    const err = new MidnamesError("fail", "X");
    const r = combine([success(1), failure(err), success(3)] as const);
    expect(!r.success && r.error).toBe(err);
  });
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  mode: "node",
  test: {
    deps: {
      interopDefault: true,
    },
    globals: true,
    environment: "node",
    testTimeout: 300_000,
    hookTimeout: 180_000,
    include: ["src/test/e2e/**/*.test.ts"],
    sequence: { concurrent: false },
    root: ".",
  },
  resolve: {
    extensions: [".ts", ".js"],
    conditions: ["import", "node", "default"],
  },
});

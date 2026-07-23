import type { BatchDeployConfig } from "./batch-config";

// Deploys only the "night" TLD root resolver on preview — no child domains.
// Costs mirror the live mainnet/preprod TLDs; coinColor is omitted so it
// defaults to preview's native token.
export const config: BatchDeployConfig = {
  network: "preview",
  tld: "night",
  defaults: {
    costs: { short: 600n, medium: 140n, long: 10n },
    buyEnabled: true,
  },
  domains: [],
};

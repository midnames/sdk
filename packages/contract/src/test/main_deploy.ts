import type { BatchDeployConfig, DomainEntry } from "./batch-config";

const PLACEHOLDER_FIELDS: [string, string][] = [["name", "Placeholder"]];
const MAINNET_COIN_COLOR = "7f396d0fc83653a58ac9085f4b96698615e8ff510b3eb4e386725725c976c9fe";
const COSTS = { short: 600n, medium: 140n, long: 10n };

const domain = (name: string): DomainEntry => {
  return {
    domain: name.split(".")[0],
    fields: PLACEHOLDER_FIELDS,
    settings: {
      buyEnabled: false,
    },
  };
};

export const config: BatchDeployConfig = {
  network: "mainnet",
  tld: "night",
  defaults: {
    coinColor:
      MAINNET_COIN_COLOR,
    costs: COSTS,
    buyEnabled: true,
  },
  domains: [],
};

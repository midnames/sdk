import type { BatchDeployConfig, DomainEntry } from "./batch-config";

const PLACEHOLDER_FIELDS: [string, string][] = [["name", "Placeholder"]];
const MAINNET_COIN_COLOR = "0000000000000000000000000000000000000000000000000000000000000000";
const COSTS = { short: 100n, medium: 10n, long: 1n };

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
  tldContractAddress: "<PASTE_TLD_CONTRACT_ADDRESS_HERE>",
  defaults: {
    coinColor: MAINNET_COIN_COLOR,
    costs: COSTS,
    buyEnabled: true,
  },
  domains: [
    domain("mnf.night"),
    domain("night.night"),
    domain("foundation.night"),
    domain("midnightfoundation.night"),
    domain("network.night"),
    domain("mid.night"),
    domain("devrel.night"),
    domain("devex.night"),
    domain("devsofmid.night"),
    domain("docs.night"),
    domain("shielded.night"),
    domain("unshielded.night"),
    domain("dust.night"),
    domain("passport.night"),
    domain("nightstream.night"),
    domain("starstream.night"),
    domain("fno.night"),
    domain("charles.night"),
    domain("ch.night"),
    domain("hoskinson.night"),
    domain("charles-hoskinson.night"),
    domain("charles_hoskinson.night"),
    domain("aliit.night"),
    domain("fahmi.night"),
    domain("jenna.night"),
    domain("ben.night"),
    domain("karmel.night"),
    domain("lauren.night"),
    domain("lolocoding.night"),
    domain("mustache.night"),
    domain("dev.night"),
    domain("nightforce.night"),
    domain("iog.night"),
    domain("io.night"),
    domain("lace.night"),
    domain("agent.night"),
    domain("midnightcity.night"),
    domain("mf.night"),
    domain("scott.night"),
    domain("seba.night"),
    domain("sydney.night"),
    domain("jack.night"),
  ],
};

import type { BatchDeployConfig } from "./batch-config";

export const config: BatchDeployConfig = {
  network: "preprod",
  tld: "night",
  domains: [
    {
      domain: "testdeploy1",
      fields: [["name", "Test Domain 1"]],
    },
    {
      domain: "testdeploy2",
      fields: [["name", "Test Domain 2"]],
    },
    {
      domain: "testdeploy3",
      fields: [["name", "Test Domain 3"]],
    },
  ],
};

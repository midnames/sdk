export interface DomainEntry {
  domain: string; // e.g. "foo", "doc.foo", "sub.doc.foo"
  fields: [string, string][]; // max 10 key-value pairs
}

export interface BatchDeployConfig {
  network: "preview" | "preprod" | "standalone";
  tld?: string; // defaults to "night"
  tldContractAddress?: string; // join existing TLD instead of deploying
  walletSeed?: string; // hex seed override
  existingContracts?: Record<string, string>; // pre-existing parent domains -> address
  domains: DomainEntry[];
}

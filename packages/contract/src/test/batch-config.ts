export interface DomainCosts {
  short: bigint;  // ≤3 chars
  medium: bigint; // 4 chars
  long: bigint;   // 5+ chars
}

export interface DomainSettings {
  coinColor?: string;    // hex string (64 chars) — defaults to native token
  costs?: DomainCosts;   // defaults to { short: 100n, medium: 10n, long: 1n }
  buyEnabled?: boolean;  // defaults to true
}

export interface DomainEntry {
  domain: string; // e.g. "foo", "doc.foo", "sub.doc.foo"
  fields: [string, string][]; // max 10 key-value pairs
  settings?: DomainSettings; // per-domain overrides
}

export interface BatchDeployConfig {
  network: "preview" | "preprod" | "mainnet" | "standalone";
  tld?: string; // defaults to "night"
  tldContractAddress?: string; // join existing TLD instead of deploying
  walletSeed?: string; // hex seed override
  existingContracts?: Record<string, string>; // pre-existing parent domains -> address
  defaults?: DomainSettings; // global defaults for all domains
  domains: DomainEntry[];
}

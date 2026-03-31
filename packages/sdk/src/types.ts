export type { DomainData } from "@midnames/ns";

export type DomainTarget =
  | { type: 'contract'; address: string }
  | { type: 'shielded'; address: string }
  | { type: 'unshielded'; address: string };

export interface DomainInfo {
  owner: string;
  resolver: string;
  contractAddress?: string;
}

export interface DomainSettings {
  coinColor: Uint8Array;
  costs: {
    short: bigint;   // ≤3 chars
    medium: bigint;  // 4 chars
    long: bigint;    // 5+ chars
  };
  buyEnabled: boolean;
}

export interface DomainProfileData {
  fullDomain: string;
  resolvedTarget: DomainTarget | null;
  info: DomainInfo | null;
  fields: Map<string, string>;
  settings: DomainSettings | null;
}
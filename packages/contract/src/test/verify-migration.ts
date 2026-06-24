import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { Buffer } from "buffer";
import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";

import { Leaf } from "../../dist";
import { keyToDomain } from "../utils.js";

/**
 * Phase 4 — read-only verification that the migration was faithful.
 *
 * Re-reads the new TLD and every migrated resolver from the indexer and diffs
 * owner / target / fields / default-field against the Phase-0 snapshot. No wallet.
 *
 * Usage:
 *   bun run src/test/verify-migration.ts <snapshot.json> [manifest.json] [tldAddress]
 */

interface SnapshotDomain {
  fullDomain: string;
  label: string;
  owner_public_key: string;
  owner_address: string;
  target: string;
  target_type: "contract" | "shielded" | "unshielded";
  default_field: string | null;
  fields: Record<string, string>;
}
interface Snapshot {
  stats: { network: string; tld: string };
  root: SnapshotDomain;
  domains: SnapshotDomain[];
}
interface Manifest {
  network: string;
  tldAddress?: string;
  domains: Record<string, { resolver: string; owner: string }>;
}

const INDEXER: Record<string, { url: string; ws: string }> = {
  preprod: {
    url: "https://indexer.preprod.midnight.network/api/v3/graphql",
    ws: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
  },
  preview: {
    url: "https://indexer.preview.midnight.network/api/v3/graphql",
    ws: "wss://indexer.preview.midnight.network/api/v3/graphql/ws",
  },
  mainnet: {
    url: "https://midnight-proxy-mainnet-indexer.faculerena.workers.dev/api/v3/graphql",
    ws: "wss://midnight-proxy-mainnet-indexer.faculerena.workers.dev/api/v3/graphql/ws",
  },
};

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function targetOf(L: any): { type: string; bytes: string } {
  const t = L.DOMAIN_TARGET;
  if (t.is_left) return { type: "contract", bytes: hex(t.left.bytes) };
  const inner = t.right;
  return inner.is_left
    ? { type: "shielded", bytes: hex(inner.left.bytes) }
    : { type: "unshielded", bytes: hex(inner.right.bytes) };
}

function fieldsOf(L: any): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of L.fields) out[String(k)] = String(v);
  return out;
}

function diffDomain(d: SnapshotDomain, resolverLedger: any): string[] {
  const problems: string[] = [];
  const owner = hex(resolverLedger.DOMAIN_OWNER[0]);
  const ownerAddr = hex(resolverLedger.DOMAIN_OWNER[1].bytes);
  if (owner !== d.owner_public_key) problems.push(`owner ${owner.slice(0, 12)}… ≠ ${d.owner_public_key.slice(0, 12)}…`);
  if (ownerAddr !== d.owner_address) problems.push(`owner_address mismatch`);

  const tgt = targetOf(resolverLedger);
  if (tgt.type !== d.target_type || tgt.bytes !== d.target) {
    problems.push(`target ${tgt.type}:${tgt.bytes.slice(0, 12)}… ≠ ${d.target_type}:${d.target.slice(0, 12)}…`);
  }

  const def = resolverLedger.DEFAULT_FIELD.is_some ? String(resolverLedger.DEFAULT_FIELD.value) : null;
  if (def !== d.default_field) problems.push(`default_field ${def} ≠ ${d.default_field}`);

  const got = fieldsOf(resolverLedger);
  const expKeys = Object.keys(d.fields).sort();
  const gotKeys = Object.keys(got).sort();
  if (expKeys.join(",") !== gotKeys.join(",")) {
    problems.push(`field keys [${gotKeys}] ≠ [${expKeys}]`);
  } else {
    for (const k of expKeys) if (got[k] !== d.fields[k]) problems.push(`field "${k}" value mismatch`);
  }
  return problems;
}

async function main() {
  const snapshotPath = process.argv[2];
  if (!snapshotPath) {
    console.error("Usage: bun run src/test/verify-migration.ts <snapshot.json> [manifest.json] [tldAddress]");
    process.exit(1);
  }
  const snapshot: Snapshot = JSON.parse(fs.readFileSync(path.resolve(snapshotPath), "utf-8"));
  // Verify against the network it was actually deployed to (DEPLOY_NETWORK), not the snapshot's source.
  const targetNetwork = process.env.DEPLOY_NETWORK ?? snapshot.stats.network;
  const manifestPath =
    process.argv[3] ?? path.resolve(snapshotPath).replace(/(-snapshot)?\.json$/, "-migration-manifest.json");
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const tldAddress = process.argv[4] ?? manifest.tldAddress;
  if (!tldAddress) throw new Error("No TLD address (manifest.tldAddress or argv[4])");

  const net = INDEXER[targetNetwork];
  if (!net) throw new Error(`No indexer for network ${targetNetwork}`);
  setNetworkId(targetNetwork as any);
  const provider = indexerPublicDataProvider(net.url, net.ws);

  // Read the TLD registry.
  const tldState = await provider.queryContractState(tldAddress);
  if (!tldState) throw new Error(`TLD not found at ${tldAddress}`);
  const tldLedger = Leaf.ledger(tldState.data);
  const registry = new Map<string, { owner: string; resolver: string }>();
  for (const [key, data] of tldLedger.domains) {
    registry.set(keyToDomain(key), { owner: hex(data.owner), resolver: hex(data.resolver.bytes) });
  }

  const toVerify = snapshot.domains.filter((d) => d.owner_public_key !== snapshot.root.owner_public_key);
  console.log(`Verifying ${toVerify.length} migrated domains against TLD ${tldAddress}\n`);

  let pass = 0;
  const failures: string[] = [];
  for (const d of toVerify) {
    const reg = registry.get(d.label);
    if (!reg) {
      failures.push(`${d.fullDomain}: NOT registered in TLD`);
      continue;
    }
    const problems: string[] = [];
    if (reg.owner !== d.owner_public_key) problems.push(`TLD registry owner mismatch`);

    const resolverState = await provider.queryContractState(reg.resolver);
    if (!resolverState) {
      problems.push(`resolver ${reg.resolver.slice(0, 12)}… not found`);
    } else {
      problems.push(...diffDomain(d, Leaf.ledger(resolverState.data)));
    }

    if (problems.length === 0) {
      pass++;
      console.log(`  ✓ ${d.fullDomain}`);
    } else {
      failures.push(`${d.fullDomain}: ${problems.join("; ")}`);
      console.log(`  ✗ ${d.fullDomain} — ${problems.join("; ")}`);
    }
  }

  console.log(`\n${pass}/${toVerify.length} verified.`);
  if (failures.length) {
    console.log(`\n${failures.length} FAILURES:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("All migrated domains match the snapshot. ✓");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

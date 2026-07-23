import type { PublicDataProvider } from "@midnight-ntwrk/midnight-js-types";
import {
  type NetworkId,
  setNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";

export interface NetworkConfig {
  indexerUrl: string;
  indexerWsUrl: string;
  tldAddress: string;
}

export const NETWORK_REGISTRY: Record<string, NetworkConfig> = {
  preview: {
    indexerUrl: "https://indexer.preview.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.preview.midnight.network/api/v3/graphql/ws",
    tldAddress: "e2655a6d554d5d3ceb03dfbee517ad4186d6c287c5e638a29258320dde3e0ba7",
  },
  preprod: {
    indexerUrl: "https://indexer.preprod.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.preprod.midnight.network/api/v3/graphql/ws",
    tldAddress: "43b500cadaa57d174d82cd6fd596002e33e3e680d7cf8bd7ba3383f62ceb0749",
  },
  mainnet: {
    indexerUrl: "https://indexer.mainnet.midnight.network/api/v3/graphql",
    indexerWsUrl: "wss://indexer.mainnet.midnight.network/api/v3/graphql/ws",
    tldAddress: "0167c9ad2f166e717dd7b4a72606bf5cbba2fd462d5e1ca95e2d0452af288638",
  },
};

export interface ProviderConfig {
  indexerUrl?: string;
  indexerWsUrl?: string;
  networkId?: string;
}

export function getNetworkConfig(networkId: string): NetworkConfig {
  const config = NETWORK_REGISTRY[networkId];
  if (!config) {
    throw new Error(
      `Unknown network "${networkId}". Known networks: ${Object.keys(NETWORK_REGISTRY).join(", ")}. Use createDefaultProvider() with explicit URLs for custom networks.`
    );
  }
  return config;
}

let defaultProvider: PublicDataProvider | null = null;

export function getDefaultProvider(networkId: string = "mainnet"): PublicDataProvider {
  if (!defaultProvider) {
    const net = getNetworkConfig(networkId);
    setNetworkId(networkId as any);
    defaultProvider = indexerPublicDataProvider(net.indexerUrl, net.indexerWsUrl) as PublicDataProvider;
  }
  return defaultProvider!;
}

export function setDefaultProvider(provider: PublicDataProvider): void {
  defaultProvider = provider;
}

export function createDefaultProvider(
  config: ProviderConfig = {}
): PublicDataProvider {
  const networkId = config.networkId ?? "mainnet";
  const knownConfig = NETWORK_REGISTRY[networkId];

  const indexerUrl = config.indexerUrl ?? knownConfig?.indexerUrl;
  const indexerWsUrl = config.indexerWsUrl ?? knownConfig?.indexerWsUrl;

  if (!indexerUrl || !indexerWsUrl) {
    throw new Error(
      `No indexer URLs for network "${networkId}". Provide indexerUrl and indexerWsUrl explicitly.`
    );
  }

  setNetworkId(networkId as any);
  return indexerPublicDataProvider(indexerUrl, indexerWsUrl) as PublicDataProvider;
}

import { MidnightBech32m, ShieldedCoinPublicKey, ShieldedAddress, ShieldedEncryptionPublicKey } from "@midnight-ntwrk/wallet-sdk-address-format";
import { getNetworkId } from "@midnight-ntwrk/midnight-js-network-id";

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function formatContractAddress(bytes: Uint8Array): string {
  return '0200' + bytesToHex(bytes);
}

export function deriveShieldedAddress(coinPublicKeyAddress: string, encryptionPublicKey: string): string | null {
  try {
    const cpkParsed = MidnightBech32m.parse(coinPublicKeyAddress);
    if (cpkParsed.type !== 'shield-cpk') return null;
    const coinPublicKey = ShieldedCoinPublicKey.codec.decode(getNetworkId(), cpkParsed);
    const epkParsed = MidnightBech32m.parse(encryptionPublicKey);
    if (epkParsed.type !== 'shield-epk') return null;
    const encPubKey = ShieldedEncryptionPublicKey.codec.decode(getNetworkId(), epkParsed);
    const shieldedAddress = new ShieldedAddress(coinPublicKey, encPubKey);
    return ShieldedAddress.codec.encode(getNetworkId() as any, shieldedAddress).asString();
  } catch {
    return null;
  }
}

export function isWalletAddress(address: string): boolean {
  return address.startsWith('mn_');
}


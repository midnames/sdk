export function domainToKey(name: string): { key: Uint8Array; len: bigint } {
  const bytes = new TextEncoder().encode(name);
  if (bytes.length === 0 || bytes.length > 32)
    throw new Error(`Domain name must be 1-32 bytes, got ${bytes.length}`);
  const key = new Uint8Array(32).fill(255);
  key.set(bytes);
  return { key, len: BigInt(bytes.length) };
}

export function keyToDomain(key: Uint8Array): string {
  let len = 32;
  for (let i = 0; i < 32; i++) {
    if (key[i] === 255) { len = i; break; }
  }
  return new TextDecoder().decode(key.subarray(0, len));
}

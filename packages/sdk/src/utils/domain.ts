export const DEFAULT_TLD = 'night';

export function normalizeDomain(input: string, assumeTld: boolean = true): string {
  const trimmedInput = input.trim().toLowerCase();
  const cleaned = trimmedInput.replace(/\.+/g, '.').replace(/\.$/, '');
  if (!assumeTld) return cleaned;
  if (cleaned.endsWith(`.${DEFAULT_TLD}`)) return cleaned;
  return `${cleaned}.${DEFAULT_TLD}`;
}

export interface ParsedDomain {
  isValid: boolean;
  domainName: string;
  parentDomainPath: string;
  fullDomain: string;
  depth: number;
}

export function parseFullDomain(fullDomain: string, tld: string = DEFAULT_TLD): ParsedDomain {
  const normalized = normalizeDomain(fullDomain);
  const parts = normalized.split('.')
  if (parts[parts.length - 1] !== tld || parts.length < 2) {
    return { isValid: false, domainName: '', parentDomainPath: '', fullDomain: normalized, depth: 0 };
  }
  const domainName = parts[0];
  const parentDomainPath = parts.slice(1).join('.');
  return { isValid: true, domainName, parentDomainPath, fullDomain: normalized, depth: parts.length - 1 };
}

export function buildTraversalPath(fullDomain: string, tld: string = DEFAULT_TLD): string[] {
  const parsed = parseFullDomain(fullDomain, tld);
  if (!parsed.isValid) return [];
  const path = [tld];
  if (parsed.depth === 0) return path;
  const parts = parsed.fullDomain.split('.');
  for (let i = parts.length - 2; i >= 0; i--) {
    path.push(parts.slice(i).join('.'));
  }
  return path;
}

export function isValidDomainName(domainName: string): boolean {
  if (!domainName || domainName.length === 0 || domainName.length > 32) return false;
  const regex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
  return regex.test(domainName.toLowerCase());
}

export function getParentDomain(fullDomain: string): string | null {
  const parts = fullDomain.split('.');
  if (parts.length <= 1) return null;
  return parts.slice(1).join('.');
}

export function getSubdomain(fullDomain: string): string {
  const parts = fullDomain.split('.');
  return parts[0] || '';
}

export function isTLD(domain: string, tld: string = DEFAULT_TLD): boolean {
  return normalizeDomain(domain, false) === tld;
}

export function buildFullDomain(subdomain: string, parent: string): string {
  if (!subdomain) return parent;
  return `${subdomain}.${parent}`;
}

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


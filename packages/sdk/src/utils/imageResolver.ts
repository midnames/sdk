/**
 * Image resolution utilities for midnames-sdk
 * Handles IPFS URLs and converts them to accessible HTTP(S) gateway URLs
 */
const DEFAULT_IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://4everland.io/ipfs",
  "https://dweb.link/ipfs",
];

/**
 * Validates if a string is a valid IPFS CID
 * @param cid - The string to validate
 * @returns true if valid CID, false otherwise
 */
function isValidIPFSCid(cid: string): boolean {
  if (!cid || cid.length < 10) return false;
  
  // Basic CIDv0 (Qm...) and CIDv1 (b...) validation
  const cidv0Regex = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
  const cidv1Regex = /^b[A-Za-z2-7]{58}$/;
  
  return cidv0Regex.test(cid) || cidv1Regex.test(cid);
}

/**
 * Resolves an IPFS CID to an accessible gateway URL
 * Tests multiple gateways concurrently and returns the first working one
 * @param cid - The IPFS CID to resolve
 * @returns Promise resolving to gateway URL
 */
async function resolveIPFS(cid: string): Promise<string> {
  const controllers = DEFAULT_IPFS_GATEWAYS.map(() => new AbortController());

  // Race all gateways — first successful response wins
  const racePromise = new Promise<string>((resolve, reject) => {
    let pending = DEFAULT_IPFS_GATEWAYS.length;

    DEFAULT_IPFS_GATEWAYS.forEach(async (gateway, i) => {
      const timeoutId = setTimeout(() => controllers[i].abort(), 3000);
      try {
        const res = await fetch(`${gateway}/${cid}`, {
          method: "HEAD",
          signal: controllers[i].signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          controllers.forEach((c) => c.abort());
          resolve(`${gateway}/${cid}`);
          return;
        }
      } catch {
        clearTimeout(timeoutId);
      }
      if (--pending === 0) reject();
    });
  });

  try {
    return await racePromise;
  } catch {
    return `${DEFAULT_IPFS_GATEWAYS[0]}/${cid}`;
  }
}

/**
 * Resolves a URL to an accessible HTTP(S) URL
 * Handles IPFS URLs (ipfs://... and bare CIDs) by converting to gateway URLs
 * Returns HTTP(S) URLs as-is
 * @param url - The URL to resolve
 * @returns Promise resolving to accessible URL
 */
export async function resolveImageUrl(url: string): Promise<string> {
  if (!url || !url.trim()) {
    return "";
  }

  const trimmedUrl = url.trim();

  // Return HTTP(S) URLs as-is
  if (/^https?:\/\//i.test(trimmedUrl)) {
    return trimmedUrl;
  }

  // Handle IPFS protocol URLs
  if (trimmedUrl.startsWith("ipfs://")) {
    const cid = trimmedUrl.replace("ipfs://", "");
    return resolveIPFS(cid);
  }

  // Handle bare IPFS CIDs
  if (isValidIPFSCid(trimmedUrl)) {
    return resolveIPFS(trimmedUrl);
  }

  // For other protocols or invalid formats, return as-is
  return trimmedUrl;
}
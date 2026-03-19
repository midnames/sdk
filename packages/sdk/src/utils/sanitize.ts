const ALLOWED_PROTOCOLS = /^(https?:\/\/|ipfs:\/\/|data:image\/)/i;

/**
 * Sanitizes a URL to prevent javascript: and other dangerous protocols.
 * Returns empty string for disallowed protocols.
 * Decodes URL-encoded characters before checking to prevent bypasses like java%73cript:
 */
export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  // Decode URL-encoded characters to catch bypasses like java%73cript:
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  // Relative URLs and protocol-relative are fine
  if (decoded.startsWith('/') || decoded.startsWith('./')) return trimmed;
  // Allow only safe protocols (check decoded version)
  if (ALLOWED_PROTOCOLS.test(decoded)) return trimmed;
  return '';
}

/**
 * Extract the trackable hostname from a tab URL.
 * Returns null for URLs that should not be tracked (chrome://, about:, extensions, etc.).
 * Only the hostname ever leaves the extension — never paths, queries, or fragments.
 */
export function domainFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const scheme = parsed.protocol;
  if (scheme !== "http:" && scheme !== "https:" && scheme !== "file:") return null;
  if (scheme === "file:") return "local files";
  let host = parsed.hostname.toLowerCase();
  if (!host) return null;
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

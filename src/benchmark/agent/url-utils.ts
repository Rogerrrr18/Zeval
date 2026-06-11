/**
 * @fileoverview URL helpers for Agent network tools and AutoFind discovery.
 */

/**
 * Unwrap search-engine redirect URLs (e.g. DuckDuckGo `uddg`) and normalize to absolute https.
 *
 * @param rawUrl Raw URL from HTML search results or candidate metadata.
 * @returns Direct target URL suitable for fetch().
 */
export function unwrapRedirectUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) return trimmed;

  const absolute = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;

  try {
    const parsed = new URL(absolute);
    if (parsed.hostname.includes("duckduckgo.com") && parsed.pathname.includes("/l/")) {
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return unwrapRedirectUrl(decodeURIComponent(uddg));
    }
  } catch {
    const uddgMatch = trimmed.match(/[?&]uddg=([^&]+)/i);
    if (uddgMatch?.[1]) return unwrapRedirectUrl(decodeURIComponent(uddgMatch[1]));
  }

  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (!/^https?:\/\//i.test(absolute) && /^[\w.-]+\.[a-z]{2,}/i.test(absolute)) {
    return `https://${absolute}`;
  }
  return absolute;
}

/**
 * Validate that a URL can be passed to fetch().
 *
 * @param url Candidate URL.
 * @returns True when URL has an http(s) scheme.
 */
export function isFetchableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Extract a HuggingFace dataset id (owner/name) from a datasets or resolve URL.
 *
 * @param url HuggingFace dataset or file URL.
 * @returns Dataset id such as `CAS-SIAT-XinHai/CPsyCoun`, or null when not parseable.
 */
export function extractHuggingFaceDatasetId(url: string): string | null {
  const match = url.match(/huggingface\.co\/datasets\/([^?#]+)/i);
  if (!match?.[1]) return null;
  const segments = match[1].split("/").filter(Boolean);
  const stopWords = new Set(["resolve", "tree", "blob", "main", "master"]);
  const datasetSegments: string[] = [];
  for (const segment of segments) {
    if (stopWords.has(segment)) break;
    datasetSegments.push(segment);
    if (datasetSegments.length >= 2) break;
  }
  if (datasetSegments.length < 2) return null;
  return datasetSegments.join("/");
}

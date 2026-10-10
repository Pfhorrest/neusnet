import type { ContentReference } from './content-reference.js';
import type { PostMetadata } from './post.js';

/**
 * Content identity confirmation (metadata.md §4.3): deciding whether two
 * metadata files refer to the *same content*, which is what allows ratings
 * of a third-party introduction to be aggregated with ratings of the
 * author's own version (ratings.md §2.5).
 *
 * Two references confirm identity only through evidence that can't be
 * silently changed after the fact: a matching immutable URI, a matching
 * hash, or identical inline text. A matching *mutable* URI (HTTPS, IPNS)
 * proves nothing on its own — the server can change what it serves.
 */

const BTIH = /[?&]xt=urn:btih:([^&]+)/i;

/**
 * A comparison key for references to immutable content, or `undefined` if
 * the URI is not a recognized immutable form (metadata.md §4.1). Unknown
 * schemes are deliberately treated as mutable: confirming identity from
 * them would mean trusting a scheme this implementation can't vouch for.
 */
function immutableKey(uri: string): string | undefined {
  if (/^ipfs:\/\//i.test(uri)) {
    const rest = uri.slice('ipfs://'.length);
    // CIDs are case-sensitive (CIDv0 is base58), so the remainder is kept as-is.
    return rest.length > 0 ? `ipfs:${rest}` : undefined;
  }
  if (/^magnet:/i.test(uri)) {
    // The same torrent can appear with different display names, trackers, or
    // parameter order, so identity is the infohash alone. (A hex and a base32
    // spelling of one infohash would not compare equal here; that normalization
    // is not implemented.)
    const infohash = BTIH.exec(uri)?.[1];
    return infohash !== undefined ? `btih:${infohash.toLowerCase()}` : undefined;
  }
  return undefined;
}

/**
 * Whether two individual content references confirm the same content.
 *
 * - `inline:` references match iff their `inline_content` is identical
 *   (compared exactly — JCS performs no Unicode normalization, so neither
 *   does this). Every inline reference shares the same `uri` string, so the
 *   URI itself can never be the evidence.
 * - Otherwise, two references match if they share an immutable URI, or
 *   carry the same `algorithm:hexdigest` hash (algorithm and digest
 *   compared case-insensitively; different algorithms never match).
 */
export function contentReferencesMatch(x: ContentReference, y: ContentReference): boolean {
  const xInline = x.uri === 'inline:';
  const yInline = y.uri === 'inline:';
  if (xInline || yInline) {
    return xInline && yInline && x.inline_content === y.inline_content;
  }

  if (x.hash !== undefined && y.hash !== undefined) {
    if (x.hash.toLowerCase() === y.hash.toLowerCase()) return true;
  }

  const xKey = immutableKey(x.uri);
  return xKey !== undefined && xKey === immutableKey(y.uri);
}

/**
 * Whether two metadata files confirm the same content: true if any
 * reference in one matches any reference in the other. A single match
 * suffices because a file's `content` references are mirrors of the same
 * content, not alternatives (metadata.md §4).
 */
export function contentIdentityMatches(a: PostMetadata, b: PostMetadata): boolean {
  return a.content.some((ra) => b.content.some((rb) => contentReferencesMatch(ra, rb)));
}

import { decodeNid1, isValidNid1 } from '../identity/keypair.js';
import { verifyObject } from '../identity/signing.js';
import type { PostMetadata } from './post.js';

/**
 * Decides whether a metadata file is **author-signed**: carries a signature
 * that verifies against the key its own `author` field identifies.
 *
 * Verification depends on the author's identity substrate (identity.md
 * §2.1, §4.1), which this library can only handle for native `nid1`
 * identities; callers using other substrates (AT Protocol DIDs, Nostr
 * keys...) supply their own check to {@link buildVersionHistory}.
 */
export type AuthorSignatureVerifier = (post: PostMetadata) => boolean;

/** The native verifier: `author` is a `nid1` identifier and `signature` verifies against its key. */
export function verifyNativeAuthorSignature(post: PostMetadata): boolean {
  if (post.signature === undefined || post.author === undefined) return false;
  if (!isValidNid1(post.author)) return false;
  return verifyObject(post, decodeNid1(post.author));
}

/**
 * The result of building a post's version history (metadata.md §5.2).
 * Every list holds version identifiers (the keys of the `known` map).
 */
export interface VersionHistory {
  /** The stable identifier the history was built for. */
  id: string;
  /** The version identifier the stable `id` currently resolves to. */
  currentVersionId: string;
  /**
   * The canonical author: the author of the first author-signed version
   * found walking back from the current one. Absent when no author-signed
   * version exists (the normal state of a bridged post whose author has
   * not joined neusnet), in which case `canonical` is empty.
   */
  canonicalAuthor?: string;
  /** The canonical version history, newest first. */
  canonical: string[];
  /** Author-signed versions of this post that the canonical chain skips over. */
  memoryHoled: string[];
  /** Files naming the canonical author but signed by someone else. */
  thirdPartyIntroductions: string[];
  /** Files naming the canonical author that carry no signature. */
  unsignedCopies: string[];
  /** Files claiming this id while naming a different author, or none. */
  falseClaimants: string[];
  /** Version identifiers the walk needed but that are not in `known` — fetch these to extend the history. */
  missing: string[];
}

export interface BuildVersionHistoryInput {
  /** The post's stable identifier. */
  id: string;
  /** What the stable identifier currently resolves to (resolution itself is the hosting layer's job). */
  currentVersionId: string;
  /**
   * Every metadata file the client knows of, keyed by version identifier —
   * the canonical chain, but also whatever else has turned up (typically
   * via rating records or gossip): skipped versions, introductions, rival
   * claims. Files claiming other ids are ignored.
   */
  known: ReadonlyMap<string, PostMetadata>;
  /** Defaults to {@link verifyNativeAuthorSignature}. */
  isAuthorSigned?: AuthorSignatureVerifier;
}

interface WalkEntry {
  versionId: string;
  post: PostMetadata;
  authorSigned: boolean;
}

function newestFirst(entries: { versionId: string; post: PostMetadata }[]): string[] {
  return [...entries]
    .sort((a, b) => b.post.timestamp - a.post.timestamp || (a.versionId < b.versionId ? -1 : 1))
    .map((e) => e.versionId);
}

/**
 * Build the canonical version history of a post, and categorize every
 * other known file claiming its stable identifier (metadata.md §5.2).
 *
 * The caller is responsible for having validated each file's shape
 * ({@link validatePostMetadata}) and, for files it intends to treat as
 * third-party introductions, for having checked the introducer's
 * signature: a file's `signature` doesn't say who made it, so this
 * function can distinguish "signed by the author" from "signed by someone
 * else" but cannot tell a genuine introduction from a garbage signature.
 *
 * @throws If `currentVersionId` resolves to a file claiming a different
 *   id — the pointer and the file disagree, which is a caller error (or
 *   a hostile pointer) rather than a history to report.
 */
export function buildVersionHistory(input: BuildVersionHistoryInput): VersionHistory {
  const { id, currentVersionId, known } = input;
  const isAuthorSigned = input.isAuthorSigned ?? verifyNativeAuthorSignature;

  const empty: VersionHistory = {
    id,
    currentVersionId,
    canonical: [],
    memoryHoled: [],
    thirdPartyIntroductions: [],
    unsignedCopies: [],
    falseClaimants: [],
    missing: [],
  };

  const current = known.get(currentVersionId);
  if (current === undefined) {
    return { ...empty, missing: [currentVersionId] };
  }
  if (current.id !== id) {
    throw new Error(
      `buildVersionHistory: current version ${JSON.stringify(currentVersionId)} claims id ` +
        `${JSON.stringify(current.id)}, not ${JSON.stringify(id)}`,
    );
  }

  // Walk `previous` links back from the current version, through every file
  // that claims this id — including ones that aren't author-signed, so a
  // stray copy in the middle doesn't truncate the author's own history. The
  // walk ends at an unknown file (reported as missing), a file claiming a
  // different id (not part of this post; its links aren't followed), or a
  // repeat (a cycle: impossible with content-addressed identifiers, but
  // data from the network can claim anything).
  const missing: string[] = [];
  const walk: WalkEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = currentVersionId;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const post = known.get(cursor);
    if (post === undefined) {
      missing.push(cursor);
      break;
    }
    if (post.id !== id) break;
    walk.push({ versionId: cursor, post, authorSigned: isAuthorSigned(post) });
    cursor = post.previous;
  }

  const canonicalAuthor = walk.find((entry) => entry.authorSigned)?.post.author;
  const canonical =
    canonicalAuthor === undefined
      ? []
      : walk
          .filter((entry) => entry.authorSigned && entry.post.author === canonicalAuthor)
          .map((entry) => entry.versionId);
  const canonicalSet = new Set(canonical);
  const authorSignedByVersion = new Map(walk.map((entry) => [entry.versionId, entry.authorSigned]));

  // With no canonical chain, the current version is the anchor everything
  // else is compared against, not an anomaly itself.
  const anchorOnly = canonical.length === 0;
  const claimedAuthor = canonicalAuthor ?? current.author;

  const memoryHoled: { versionId: string; post: PostMetadata }[] = [];
  const thirdPartyIntroductions: { versionId: string; post: PostMetadata }[] = [];
  const unsignedCopies: { versionId: string; post: PostMetadata }[] = [];
  const falseClaimants: { versionId: string; post: PostMetadata }[] = [];

  for (const [versionId, post] of known) {
    if (post.id !== id || canonicalSet.has(versionId)) continue;
    if (anchorOnly && versionId === currentVersionId) continue;

    const entry = { versionId, post };
    const sameAuthor = claimedAuthor !== undefined && post.author === claimedAuthor;
    if (!sameAuthor) {
      falseClaimants.push(entry);
    } else if (authorSignedByVersion.get(versionId) ?? isAuthorSigned(post)) {
      memoryHoled.push(entry);
    } else if (post.signature !== undefined) {
      thirdPartyIntroductions.push(entry);
    } else {
      unsignedCopies.push(entry);
    }
  }

  return {
    id,
    currentVersionId,
    ...(canonicalAuthor !== undefined ? { canonicalAuthor } : {}),
    canonical,
    memoryHoled: newestFirst(memoryHoled),
    thirdPartyIntroductions: newestFirst(thirdPartyIntroductions),
    unsignedCopies: newestFirst(unsignedCopies),
    falseClaimants: newestFirst(falseClaimants),
    missing,
  };
}

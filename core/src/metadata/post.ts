import { decodeNid1, isValidNid1 } from '../identity/keypair.js';
import { signObject, verifyObject } from '../identity/signing.js';
import { isValidTag, normalizeTag } from '../ratings/tags.js';
import { validateContentReference, type ContentReference } from './content-reference.js';

/** A post metadata file (metadata.md §3). */
export interface PostMetadata {
  neusnet_version: 1;
  type: 'post';
  id: string;
  author?: string;
  subject?: string;
  summary?: string;
  tags: string[];
  content: ContentReference[];
  parents?: string[];
  previous?: string;
  timestamp: number;
  signature?: string;
}

/**
 * Thrown by {@link validatePostMetadata} when `neusnet_version` is present
 * and is a number, but is not `1`. Distinguished from other validation
 * failures so callers can implement metadata.md §3's guidance verbatim:
 * "Clients encountering an unrecognized version number should treat the
 * file as opaque and not attempt to interpret it" — i.e. skip silently,
 * rather than treating it the same as a malformed file.
 */
export class UnrecognizedVersionError extends Error {
  constructor(version: unknown) {
    super(`validatePostMetadata: unrecognized neusnet_version ${JSON.stringify(version)}`);
    this.name = 'UnrecognizedVersionError';
  }
}

function fail(message: string): never {
  throw new Error(`validatePostMetadata: ${message}`);
}

/**
 * Validate and return a post metadata object per metadata.md §3.
 *
 * Performs shape/type validation only — it does not check `signature`
 * against any key (see {@link computeTrustLevel} for that) and does not
 * construct or check canonical version history (metadata.md §5.2, which
 * operates over a *collection* of versions, not a single object).
 *
 * @throws {UnrecognizedVersionError} If `neusnet_version` is a number
 *   other than `1`.
 * @throws {Error} For any other validation failure.
 */
export function validatePostMetadata(value: unknown): PostMetadata {
  if (typeof value !== 'object' || value === null) {
    fail(`expected an object, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;

  if (typeof obj.neusnet_version !== 'number') {
    fail(
      `"neusnet_version" is required and must be a number, got ${JSON.stringify(obj.neusnet_version)}`,
    );
  }
  if (obj.neusnet_version !== 1) {
    throw new UnrecognizedVersionError(obj.neusnet_version);
  }

  if (obj.type !== 'post') {
    fail(`"type" must be "post", got ${JSON.stringify(obj.type)}`);
  }

  if (typeof obj.id !== 'string' || obj.id.length === 0) {
    fail('"id" is required and must be a non-empty string');
  }

  if (obj.author !== undefined && (typeof obj.author !== 'string' || obj.author.length === 0)) {
    fail(`"author" must be a non-empty string when present, got ${JSON.stringify(obj.author)}`);
  }

  if (obj.subject !== undefined && typeof obj.subject !== 'string') {
    fail(`"subject" must be a string when present, got ${JSON.stringify(obj.subject)}`);
  }

  if (obj.summary !== undefined && typeof obj.summary !== 'string') {
    fail(`"summary" must be a string when present, got ${JSON.stringify(obj.summary)}`);
  }

  if (!Array.isArray(obj.tags)) {
    fail(`"tags" is required and must be an array, got ${JSON.stringify(obj.tags)}`);
  }
  for (const tag of obj.tags) {
    if (typeof tag !== 'string' || !isValidTag(tag) || normalizeTag(tag) !== tag) {
      fail(
        `every entry in "tags" must already be in normalized form (ratings.md §6) — ${JSON.stringify(tag)} is not`,
      );
    }
  }

  if (!Array.isArray(obj.content) || obj.content.length === 0) {
    fail('"content" is required and must be a non-empty array');
  }
  const content = obj.content.map((entry) => validateContentReference(entry));

  let parents: string[] | undefined;
  if (obj.parents !== undefined) {
    if (!Array.isArray(obj.parents)) {
      fail(`"parents" must be an array when present, got ${JSON.stringify(obj.parents)}`);
    }
    for (const parent of obj.parents) {
      if (typeof parent !== 'string' || parent.length === 0) {
        fail(`every entry in "parents" must be a non-empty string, got ${JSON.stringify(parent)}`);
      }
    }
    parents = obj.parents as string[];
  }

  if (obj.previous !== undefined && typeof obj.previous !== 'string') {
    fail(`"previous" must be a string when present, got ${JSON.stringify(obj.previous)}`);
  }

  if (typeof obj.timestamp !== 'number' || !Number.isInteger(obj.timestamp)) {
    fail(`"timestamp" is required and must be an integer, got ${JSON.stringify(obj.timestamp)}`);
  }

  if (obj.signature !== undefined) {
    if (typeof obj.signature !== 'string') {
      fail(`"signature" must be a string when present, got ${JSON.stringify(obj.signature)}`);
    }
    if (obj.author === undefined) {
      fail(
        '"author" is required whenever "signature" is present (metadata.md §3: author "may be omitted only for unsigned bridged posts")',
      );
    }
  }

  const result: PostMetadata = {
    neusnet_version: 1,
    type: 'post',
    id: obj.id,
    tags: obj.tags as string[],
    content,
    timestamp: obj.timestamp,
  };
  if (obj.author !== undefined) result.author = obj.author;
  if (obj.subject !== undefined) result.subject = obj.subject;
  if (obj.summary !== undefined) result.summary = obj.summary;
  if (parents !== undefined) result.parents = parents;
  if (obj.previous !== undefined) result.previous = obj.previous;
  if (obj.signature !== undefined) result.signature = obj.signature;
  return result;
}

/**
 * Check whether a value is a valid post metadata object, without
 * throwing. Note that an {@link UnrecognizedVersionError} is also
 * swallowed here, returning `false` — callers that need to distinguish
 * "unrecognized version, treat as opaque" from "genuinely malformed"
 * should call {@link validatePostMetadata} directly in a try/catch
 * instead of using this guard.
 */
export function isValidPostMetadata(value: unknown): value is PostMetadata {
  try {
    validatePostMetadata(value);
    return true;
  } catch {
    return false;
  }
}

/** Input to {@link createPostMetadata} — the fields a caller supplies. */
export interface CreatePostMetadataInput {
  /**
   * The post's stable identifier. metadata.md §2 specifies the *form* and
   * properties a stable identifier must have, but not a minting
   * procedure for a brand-new post — unlike a user's identity document
   * (identity.md §5.3, deterministic from the user's keypair), there is
   * no protocol-specified way to derive a fresh post's `id` from its
   * other fields. This library therefore requires the caller to supply
   * one already minted (e.g. an IPNS name the hosting layer generated).
   */
  id: string;
  author: string;
  subject?: string;
  summary?: string;
  tags?: string[];
  content: ContentReference[];
  parents?: string[];
  previous?: string;
  /**
   * Unix timestamp (seconds). Required and never defaulted to the
   * current time internally — this keeps post construction a pure,
   * deterministic function; the caller decides what "now" means.
   */
  timestamp: number;
}

/**
 * Construct and sign a post metadata file per metadata.md §3 and
 * identity.md §4.
 *
 * The result is guaranteed to pass {@link validatePostMetadata} — this
 * function validates the assembled object (before signing) using the
 * same rules, so it cannot silently produce an invalid signed post.
 */
export function createPostMetadata(
  input: CreatePostMetadataInput,
  secretKey: Uint8Array,
): PostMetadata & { signature: string } {
  const unsigned: Record<string, unknown> = {
    neusnet_version: 1,
    type: 'post',
    id: input.id,
    author: input.author,
    tags: input.tags ?? [],
    content: input.content,
    timestamp: input.timestamp,
  };
  if (input.subject !== undefined) unsigned.subject = input.subject;
  if (input.summary !== undefined) unsigned.summary = input.summary;
  if (input.parents !== undefined) unsigned.parents = input.parents;
  if (input.previous !== undefined) unsigned.previous = input.previous;

  // Validate before signing so a malformed input can never produce a
  // validly-signed-but-spec-invalid object.
  validatePostMetadata(unsigned);

  const signed = signObject(unsigned, secretKey);
  return validatePostMetadata(signed) as PostMetadata & { signature: string };
}

/** A post's trust level, per metadata.md §6.1. */
export type TrustLevel = 'author-verified' | 'third-party-attested' | 'unverified';

/**
 * Determine a post's trust level per metadata.md §6.1.
 *
 * `signerPublicKey` is the public key the caller believes actually
 * produced `post.signature` — in practice, whatever key was associated
 * with wherever this metadata file was retrieved from (an identity's
 * known IPNS address, an introducer's declared key, etc.). This function
 * verifies that the key genuinely produced the signature before using it
 * to classify the post; it does not trust the caller's claim blindly.
 *
 * @throws If `post.signature` is present but `signerPublicKey` is
 *   omitted, or is supplied but does not actually verify against
 *   `post.signature` — either is a caller error (wrong key resolved) or
 *   a tampered post, and is deliberately not conflated with the distinct
 *   "unverified" status (which means *no* signature field at all).
 */
export function computeTrustLevel(post: PostMetadata, signerPublicKey?: Uint8Array): TrustLevel {
  if (post.signature === undefined) {
    return 'unverified';
  }

  if (signerPublicKey === undefined) {
    throw new Error(
      'computeTrustLevel: post has a signature field, so a signerPublicKey is required to classify it (see doc comment)',
    );
  }

  if (!verifyObject(post, signerPublicKey)) {
    throw new Error(
      'computeTrustLevel: signerPublicKey does not match post.signature — this is not the same ' +
        'as "unverified" (no signature at all); either the wrong key was supplied, or the post has been tampered with',
    );
  }

  if (post.author !== undefined && isValidNid1(post.author)) {
    const authorKey = decodeNid1(post.author);
    if (bytesEqual(authorKey, signerPublicKey)) {
      return 'author-verified';
    }
  }

  return 'third-party-attested';
}

// The length check below is defensive good practice for a general-purpose
// byte-comparison helper, but is not reachable via computeTrustLevel's one
// call site in current usage: verifyObject would already have thrown on a
// wrong-length key before bytesEqual is ever reached. Left untested rather
// than artificially forced or removed.
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

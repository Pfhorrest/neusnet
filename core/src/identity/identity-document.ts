import { validateContentReference, type ContentReference } from '../metadata/content-reference.js';
import { NID1_PREFIX, encodeNid1, generateKeypair, isValidNid1 } from './keypair.js';
import {
  signObject,
  verifyNativeSignature,
  verifyObject,
  type SignatureVerifier,
} from './signing.js';

/** A link to the user's presence elsewhere on the web (identity.md §5.2, `links`). */
export interface ProfileLink {
  url: string;
  label?: string;
}

/**
 * A voluntary identity link record (identity.md §7). Its `signature` is the
 * linking identity's — the owner of the document it appears in — over the
 * JCS canonical form of `{ linked_id, timestamp }`.
 */
export interface IdentityLink {
  linked_id: string;
  timestamp: number;
  signature: string;
}

/** An identity document (identity.md §5.2). */
export interface IdentityDocument {
  neusnet_version: 1;
  type: 'identity';
  id: string;
  display_name?: string;
  bio?: string;
  avatar?: ContentReference;
  links?: ProfileLink[];
  status?: string;
  recovery_keys?: string[];
  recovery_threshold?: number;
  linked_ids?: IdentityLink[];
  aggregate_linked?: boolean;
  proxy?: boolean;
  operator?: string;
  timestamp: number;
  signature?: string;
}

export type { SignatureVerifier };

export interface VerifyOptions {
  /** Defaults to the native check: `signerId` is a `nid1` identifier and the signature verifies against its key. */
  verify?: SignatureVerifier;
}

function fail(message: string): never {
  throw new Error(`validateIdentityDocument: ${message}`);
}

/** A user identifier of any substrate: non-empty, and well-formed if it claims to be native. */
function userIdentifier(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${what} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  if (value.startsWith(NID1_PREFIX) && !isValidNid1(value)) {
    fail(`${what} looks like a nid1 identifier but is not a valid one: ${JSON.stringify(value)}`);
  }
  return value;
}

function isAbsoluteUrl(candidate: string): boolean {
  try {
    new URL(candidate);
    return true;
  } catch {
    return false;
  }
}

function optionalString(obj: Record<string, unknown>, field: string): string | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string')
    fail(`"${field}" must be a string when present, got ${JSON.stringify(value)}`);
  return value;
}

function optionalBoolean(obj: Record<string, unknown>, field: string): boolean | undefined {
  const value = obj[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean')
    fail(`"${field}" must be a boolean when present, got ${JSON.stringify(value)}`);
  return value;
}

function validateProfileLinks(value: unknown): ProfileLink[] {
  if (!Array.isArray(value)) fail('"links" must be an array when present');
  return value.map((entry: unknown): ProfileLink => {
    if (typeof entry !== 'object' || entry === null)
      fail('each entry in "links" must be an object');
    const link = entry as Record<string, unknown>;
    if (typeof link.url !== 'string' || !isAbsoluteUrl(link.url)) {
      fail(`each link needs "url" to be an absolute URL, got ${JSON.stringify(link.url)}`);
    }
    const label = optionalString(link, 'label');
    return label === undefined ? { url: link.url } : { url: link.url, label };
  });
}

function validateRecoveryKeys(value: unknown, ownId: string): string[] {
  if (!Array.isArray(value)) fail('"recovery_keys" must be an array when present');
  const seen = new Set<string>();
  for (const key of value) {
    if (typeof key !== 'string' || !isValidNid1(key)) {
      fail(`every recovery key must be a valid nid1 identifier, got ${JSON.stringify(key)}`);
    }
    if (key === ownId) {
      fail(
        'a recovery key must differ from the identity\u2019s own key — it would not be a separate fallback',
      );
    }
    // A key listed twice must not be able to count twice toward a threshold.
    if (seen.has(key)) fail(`recovery key ${JSON.stringify(key)} is listed more than once`);
    seen.add(key);
  }
  return value as string[];
}

function validateIdentityLinks(value: unknown, ownId: string): IdentityLink[] {
  if (!Array.isArray(value)) fail('"linked_ids" must be an array when present');
  const seen = new Set<string>();
  return value.map((entry: unknown): IdentityLink => {
    if (typeof entry !== 'object' || entry === null)
      fail('each entry in "linked_ids" must be an object');
    const link = entry as Record<string, unknown>;
    const linkedId = userIdentifier(link.linked_id, 'a link\u2019s "linked_id"');
    if (linkedId === ownId) fail('an identity cannot link to itself');
    if (seen.has(linkedId))
      fail(`"linked_ids" contains more than one record for ${JSON.stringify(linkedId)}`);
    seen.add(linkedId);
    if (typeof link.timestamp !== 'number' || !Number.isInteger(link.timestamp)) {
      fail('a link\u2019s "timestamp" must be an integer');
    }
    if (typeof link.signature !== 'string' || link.signature.length === 0) {
      fail('a link record must carry a "signature"');
    }
    return { linked_id: linkedId, timestamp: link.timestamp, signature: link.signature };
  });
}

/**
 * Validate and return an identity document per identity.md §5.2.
 *
 * Checks shape and internal consistency only. It does not check any
 * signature (see {@link verifyIdentityDocument}), and the link records in
 * `linked_ids` are shape-checked, not verified (see {@link verifyMutualLink}).
 */
export function validateIdentityDocument(value: unknown): IdentityDocument {
  if (typeof value !== 'object' || value === null) {
    fail(`expected an object, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;

  if (obj.neusnet_version !== 1)
    fail(`"neusnet_version" must be 1, got ${JSON.stringify(obj.neusnet_version)}`);
  if (obj.type !== 'identity') fail(`"type" must be "identity", got ${JSON.stringify(obj.type)}`);
  const id = userIdentifier(obj.id, '"id"');

  if (typeof obj.timestamp !== 'number' || !Number.isInteger(obj.timestamp)) {
    fail(`"timestamp" is required and must be an integer, got ${JSON.stringify(obj.timestamp)}`);
  }

  const result: IdentityDocument = {
    neusnet_version: 1,
    type: 'identity',
    id,
    timestamp: obj.timestamp,
  };

  const displayName = optionalString(obj, 'display_name');
  if (displayName !== undefined) result.display_name = displayName;
  const bio = optionalString(obj, 'bio');
  if (bio !== undefined) result.bio = bio;
  const status = optionalString(obj, 'status');
  if (status !== undefined) result.status = status;

  if (obj.avatar !== undefined) result.avatar = validateContentReference(obj.avatar);
  if (obj.links !== undefined) result.links = validateProfileLinks(obj.links);

  if (obj.recovery_keys !== undefined)
    result.recovery_keys = validateRecoveryKeys(obj.recovery_keys, id);
  if (obj.recovery_threshold !== undefined) {
    const threshold = obj.recovery_threshold;
    const keyCount = result.recovery_keys?.length ?? 0;
    // At least 1: a threshold of 0 would let a recovery rotation proceed on
    // no signatures at all. At most the key count: it could never be met.
    if (
      typeof threshold !== 'number' ||
      !Number.isInteger(threshold) ||
      threshold < 1 ||
      threshold > keyCount
    ) {
      fail(
        `"recovery_threshold" must be an integer from 1 to the number of recovery keys (${keyCount}), ` +
          `got ${JSON.stringify(threshold)}`,
      );
    }
    result.recovery_threshold = threshold;
  }

  if (obj.linked_ids !== undefined) result.linked_ids = validateIdentityLinks(obj.linked_ids, id);
  const aggregateLinked = optionalBoolean(obj, 'aggregate_linked');
  if (aggregateLinked !== undefined) result.aggregate_linked = aggregateLinked;

  const proxy = optionalBoolean(obj, 'proxy');
  if (proxy !== undefined) result.proxy = proxy;
  if (obj.operator !== undefined) {
    if (proxy !== true) fail('"operator" is only meaningful when "proxy" is true');
    const operator = userIdentifier(obj.operator, '"operator"');
    if (operator === id) fail('a proxy cannot be its own operator');
    result.operator = operator;
  } else if (proxy === true) {
    fail('"operator" is required when "proxy" is true');
  }

  if (obj.signature !== undefined) {
    if (typeof obj.signature !== 'string') fail('"signature" must be a string when present');
    result.signature = obj.signature;
  }

  return result;
}

/** Check whether a value is a valid identity document, without throwing. */
export function isValidIdentityDocument(value: unknown): value is IdentityDocument {
  try {
    validateIdentityDocument(value);
    return true;
  } catch {
    return false;
  }
}

/** Input to {@link createIdentityDocument}: every field a caller chooses. */
export interface CreateIdentityDocumentInput {
  id: string;
  display_name?: string;
  bio?: string;
  avatar?: ContentReference;
  links?: ProfileLink[];
  status?: string;
  recovery_keys?: string[];
  recovery_threshold?: number;
  linked_ids?: IdentityLink[];
  aggregate_linked?: boolean;
  proxy?: boolean;
  operator?: string;
  /** Unix timestamp (seconds); never defaulted — the caller decides what "now" is. */
  timestamp: number;
}

/**
 * Construct and sign an identity document with a native Ed25519 key.
 *
 * `input.id` must be the `nid1` identifier of `secretKey` itself — a
 * document signed by one key but naming another could never verify, so it
 * is refused rather than produced. (Documents for other identity
 * substrates are signed with that substrate's own scheme, not by this
 * function.) The result is guaranteed to pass {@link validateIdentityDocument}.
 */
export function createIdentityDocument(
  input: CreateIdentityDocumentInput,
  secretKey: Uint8Array,
): IdentityDocument & { signature: string } {
  const ownId = encodeNid1(generateKeypair(secretKey).publicKey);
  if (input.id !== ownId) {
    throw new Error(
      `createIdentityDocument: id ${JSON.stringify(input.id)} is not the identifier of the signing key (${ownId})`,
    );
  }
  const unsigned = {
    neusnet_version: 1,
    type: 'identity',
    ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
  };
  validateIdentityDocument(unsigned);
  return validateIdentityDocument(signObject(unsigned, secretKey)) as IdentityDocument & {
    signature: string;
  };
}

/**
 * Whether an identity document's signature verifies against the identity
 * it names (identity.md §5.2: `id` "must match the key used to produce the
 * `signature`"). False for an unsigned document.
 */
export function verifyIdentityDocument(doc: IdentityDocument, options?: VerifyOptions): boolean {
  if (doc.signature === undefined) return false;
  return (options?.verify ?? verifyNativeSignature)(doc, doc.id);
}

/**
 * Create a signed identity link record (identity.md §7), signed by the
 * linking identity's native key.
 */
export function createIdentityLink(
  input: { linked_id: string; timestamp: number },
  secretKey: Uint8Array,
): IdentityLink {
  userIdentifier(input.linked_id, '"linked_id"');
  if (!Number.isInteger(input.timestamp)) {
    throw new Error('createIdentityLink: "timestamp" must be an integer');
  }
  return signObject({ linked_id: input.linked_id, timestamp: input.timestamp }, secretKey);
}

/** Whether a link record verifies against the public key of the identity that made it. */
export function verifyIdentityLink(link: IdentityLink, linkerPublicKey: Uint8Array): boolean {
  return verifyObject(link, linkerPublicKey);
}

/**
 * Whether two identities are **mutually linked** (identity.md §7): each
 * document verifies, each declares a link to the other, and each of those
 * link records is signed by its own document's identity. A unilateral
 * declaration — or a link record signed by anyone but the document's
 * owner, even inside a validly signed document — does not count.
 */
export function verifyMutualLink(
  a: IdentityDocument,
  b: IdentityDocument,
  options?: VerifyOptions,
): boolean {
  if (a.id === b.id) return false;
  if (!verifyIdentityDocument(a, options) || !verifyIdentityDocument(b, options)) return false;
  const verify = options?.verify ?? verifyNativeSignature;
  const declares = (doc: IdentityDocument, otherId: string): boolean =>
    doc.linked_ids?.some((link) => link.linked_id === otherId && verify(link, doc.id)) ?? false;
  return declares(a, b.id) && declares(b, a.id);
}

import { NID1_PREFIX, encodeNid1, generateKeypair, isValidNid1 } from '../identity/keypair.js';
import { signObject, verifyNativeSignature, type SignatureVerifier } from '../identity/signing.js';

/** One pinned item in an endorsement list (hosting.md §8.1). */
export interface EndorsementEntry {
  id: string;
  version_id: string;
  pinned_at: number;
}

/** An endorsement list (hosting.md §8.1): a signed record of what a client has pinned. */
export interface EndorsementList {
  neusnet_version: 1;
  type: 'endorsement_list';
  owner: string;
  generated: number;
  entries: EndorsementEntry[];
  signature?: string;
}

function fail(message: string): never {
  throw new Error(`validateEndorsementList: ${message}`);
}

function identifier(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${what} must be a non-empty string, got ${JSON.stringify(value)}`);
  }
  if (value.startsWith(NID1_PREFIX) && !isValidNid1(value)) {
    fail(`${what} looks like a nid1 identifier but is not a valid one: ${JSON.stringify(value)}`);
  }
  return value;
}

function validateEntries(value: unknown, generated: number): EndorsementEntry[] {
  if (!Array.isArray(value)) fail('"entries" is required and must be an array');
  const seenVersionIds = new Set<string>();
  return value.map((entry: unknown): EndorsementEntry => {
    if (typeof entry !== 'object' || entry === null) fail('each entry must be an object');
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || e.id.length === 0) {
      fail(`each entry's "id" must be a non-empty string, got ${JSON.stringify(e.id)}`);
    }
    if (typeof e.version_id !== 'string' || e.version_id.length === 0) {
      fail(
        `each entry's "version_id" must be a non-empty string, got ${JSON.stringify(e.version_id)}`,
      );
    }
    if (seenVersionIds.has(e.version_id)) {
      fail(`"version_id" ${JSON.stringify(e.version_id)} is pinned by more than one entry`);
    }
    seenVersionIds.add(e.version_id);
    if (typeof e.pinned_at !== 'number' || !Number.isInteger(e.pinned_at)) {
      fail(`each entry's "pinned_at" must be an integer, got ${JSON.stringify(e.pinned_at)}`);
    }
    if (e.pinned_at > generated) {
      fail(
        `an entry's "pinned_at" (${e.pinned_at}) cannot be after the list's "generated" (${generated})`,
      );
    }
    return { id: e.id, version_id: e.version_id, pinned_at: e.pinned_at };
  });
}

/**
 * Validate and return an endorsement list per hosting.md §8.1.
 *
 * Duplicate `version_id` entries are rejected — pinning the same content
 * address twice is meaningless, the kind of redundant entry the spec
 * doesn't anticipate rather than one it permits. An entry's `pinned_at`
 * may not be later than the list's own `generated` timestamp: the list is
 * a snapshot of pinning state as of `generated`, so a later pin couldn't
 * have been reflected in it. Multiple entries sharing an `id` (several
 * pinned versions of one post) are fine and expected.
 */
export function validateEndorsementList(value: unknown): EndorsementList {
  if (typeof value !== 'object' || value === null) {
    fail(`expected an object, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;

  if (obj.neusnet_version !== 1)
    fail(`"neusnet_version" must be 1, got ${JSON.stringify(obj.neusnet_version)}`);
  if (obj.type !== 'endorsement_list')
    fail(`"type" must be "endorsement_list", got ${JSON.stringify(obj.type)}`);
  const owner = identifier(obj.owner, '"owner"');
  if (typeof obj.generated !== 'number' || !Number.isInteger(obj.generated)) {
    fail(`"generated" is required and must be an integer, got ${JSON.stringify(obj.generated)}`);
  }
  const entries = validateEntries(obj.entries, obj.generated);

  const result: EndorsementList = {
    neusnet_version: 1,
    type: 'endorsement_list',
    owner,
    generated: obj.generated,
    entries,
  };
  if (obj.signature !== undefined) {
    if (typeof obj.signature !== 'string') fail('"signature" must be a string when present');
    result.signature = obj.signature;
  }
  return result;
}

/** Check whether a value is a valid endorsement list, without throwing. */
export function isValidEndorsementList(value: unknown): value is EndorsementList {
  try {
    validateEndorsementList(value);
    return true;
  } catch {
    return false;
  }
}

/** Input to {@link createEndorsementList}. */
export interface CreateEndorsementListInput {
  owner: string;
  generated: number;
  entries: EndorsementEntry[];
}

/**
 * Construct and sign an endorsement list with a native Ed25519 key.
 *
 * `input.owner` must be the `nid1` identifier of `secretKey` itself — a
 * list signed by one key but naming another could never verify, so it is
 * refused rather than produced (same reasoning as
 * `createIdentityDocument`). The result is guaranteed to pass
 * {@link validateEndorsementList}.
 */
export function createEndorsementList(
  input: CreateEndorsementListInput,
  secretKey: Uint8Array,
): EndorsementList & { signature: string } {
  const ownId = encodeNid1(generateKeypair(secretKey).publicKey);
  if (input.owner !== ownId) {
    throw new Error(
      `createEndorsementList: owner ${JSON.stringify(input.owner)} is not the identifier of the signing key (${ownId})`,
    );
  }
  const unsigned = {
    neusnet_version: 1,
    type: 'endorsement_list',
    owner: input.owner,
    generated: input.generated,
    entries: input.entries,
  };
  validateEndorsementList(unsigned);
  return validateEndorsementList(signObject(unsigned, secretKey)) as EndorsementList & {
    signature: string;
  };
}

export interface VerifyEndorsementListOptions {
  /** Defaults to the native check: `owner` is a `nid1` identifier and the signature verifies against its key. */
  verify?: SignatureVerifier;
}

/** Whether an endorsement list's signature verifies against the identity it names. False for an unsigned list. */
export function verifyEndorsementList(
  list: EndorsementList,
  options?: VerifyEndorsementListOptions,
): boolean {
  if (list.signature === undefined) return false;
  return (options?.verify ?? verifyNativeSignature)(list, list.owner);
}

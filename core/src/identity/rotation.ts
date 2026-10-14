import { NID1_PREFIX, encodeNid1, generateKeypair, isValidNid1 } from './keypair.js';
import { signObject, verifyNativeSignature, type SignatureVerifier } from './signing.js';

/** Fields shared by both forms of key rotation declaration (identity.md §6.1–§6.2). */
interface RotationBase {
  neusnet_version: 1;
  type: 'key_rotation';
  old_id: string;
  new_id: string;
  timestamp: number;
  /** The new key's consent, over the same payload as every other signature. */
  new_signature: string;
}

/** A standard rotation: signed by both the old key and the new key (§6.1). */
export interface StandardRotation extends RotationBase {
  old_signature: string;
}

/** One recovery key's signature on a recovery rotation. */
export interface RecoverySignature {
  recovery_key: string;
  signature: string;
}

/** A recovery rotation: authorized by a quorum of registered recovery keys instead of the old key (§6.2). */
export interface RecoveryRotation extends RotationBase {
  recovery_signatures: RecoverySignature[];
}

export type KeyRotation = StandardRotation | RecoveryRotation;

/**
 * What every signature on a rotation covers: the declaration's identity
 * fields, and none of its signature fields. (`signObject` alone isn't
 * enough here — it excludes only a field named `signature`, and a rotation
 * carries `old_signature`, `new_signature`, and `recovery_signatures`.)
 */
interface RotationPayload {
  neusnet_version: 1;
  type: 'key_rotation';
  old_id: string;
  new_id: string;
  timestamp: number;
}

function payloadOf(rotation: {
  old_id: string;
  new_id: string;
  timestamp: number;
}): RotationPayload {
  return {
    neusnet_version: 1,
    type: 'key_rotation',
    old_id: rotation.old_id,
    new_id: rotation.new_id,
    timestamp: rotation.timestamp,
  };
}

function signPayload(payload: RotationPayload, secretKey: Uint8Array): string {
  return signObject(payload, secretKey).signature;
}

function fail(message: string): never {
  throw new Error(`validateKeyRotation: ${message}`);
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

function nonEmptyString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${what} must be a non-empty string`);
  }
  return value;
}

/**
 * Validate and return a key rotation declaration per identity.md §6.
 *
 * Checks shape only; whether the signatures hold is {@link verifyKeyRotation}.
 * A declaration must carry exactly one authorization form — `old_signature`
 * (standard) or `recovery_signatures` (recovery) — never both, since it
 * would be ambiguous which one the declaration stands on.
 */
export function validateKeyRotation(value: unknown): KeyRotation {
  if (typeof value !== 'object' || value === null) {
    fail(`expected an object, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;

  if (obj.neusnet_version !== 1)
    fail(`"neusnet_version" must be 1, got ${JSON.stringify(obj.neusnet_version)}`);
  if (obj.type !== 'key_rotation')
    fail(`"type" must be "key_rotation", got ${JSON.stringify(obj.type)}`);
  const oldId = identifier(obj.old_id, '"old_id"');
  const newId = identifier(obj.new_id, '"new_id"');
  if (oldId === newId) fail('a key cannot be rotated to itself');
  if (typeof obj.timestamp !== 'number' || !Number.isInteger(obj.timestamp)) {
    fail(`"timestamp" must be an integer, got ${JSON.stringify(obj.timestamp)}`);
  }
  const newSignature = nonEmptyString(obj.new_signature, '"new_signature"');

  const hasOld = obj.old_signature !== undefined;
  const hasRecovery = obj.recovery_signatures !== undefined;
  if (hasOld === hasRecovery) {
    fail(
      'a rotation must carry exactly one of "old_signature" (standard) or "recovery_signatures" (recovery)',
    );
  }

  const base = {
    neusnet_version: 1 as const,
    type: 'key_rotation' as const,
    old_id: oldId,
    new_id: newId,
    timestamp: obj.timestamp,
    new_signature: newSignature,
  };

  if (hasOld) {
    return { ...base, old_signature: nonEmptyString(obj.old_signature, '"old_signature"') };
  }

  if (!Array.isArray(obj.recovery_signatures) || obj.recovery_signatures.length === 0) {
    fail('"recovery_signatures" must be a non-empty array');
  }
  const recoverySignatures = obj.recovery_signatures.map((entry: unknown): RecoverySignature => {
    if (typeof entry !== 'object' || entry === null)
      fail('each recovery signature must be an object');
    const e = entry as Record<string, unknown>;
    if (typeof e.recovery_key !== 'string' || !isValidNid1(e.recovery_key)) {
      fail(`"recovery_key" must be a valid nid1 identifier, got ${JSON.stringify(e.recovery_key)}`);
    }
    return {
      recovery_key: e.recovery_key,
      signature: nonEmptyString(e.signature, 'a recovery "signature"'),
    };
  });
  return { ...base, recovery_signatures: recoverySignatures };
}

/** Check whether a value is a valid key rotation declaration, without throwing. */
export function isValidKeyRotation(value: unknown): value is KeyRotation {
  try {
    validateKeyRotation(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a standard rotation (identity.md §6.1) from the old key to the
 * new one, signed by both. The identifiers are derived from the keys, so
 * they cannot be mismatched.
 */
export function createStandardRotation(
  input: { timestamp: number },
  oldSecretKey: Uint8Array,
  newSecretKey: Uint8Array,
): StandardRotation {
  const payload = payloadOf({
    old_id: encodeNid1(generateKeypair(oldSecretKey).publicKey),
    new_id: encodeNid1(generateKeypair(newSecretKey).publicKey),
    timestamp: input.timestamp,
  });
  return validateKeyRotation({
    ...payload,
    old_signature: signPayload(payload, oldSecretKey),
    new_signature: signPayload(payload, newSecretKey),
  }) as StandardRotation;
}

/**
 * Create a recovery rotation (identity.md §6.2) for `old_id` — whose key
 * is, by assumption, lost — signed by the given recovery keys and by the
 * new key. Whether enough of them were registered, and enough signed, is
 * decided by {@link verifyKeyRotation} against the identity's registered
 * recovery set.
 */
export function createRecoveryRotation(
  input: { old_id: string; timestamp: number },
  recoverySecretKeys: readonly Uint8Array[],
  newSecretKey: Uint8Array,
): RecoveryRotation {
  const payload = payloadOf({
    old_id: input.old_id,
    new_id: encodeNid1(generateKeypair(newSecretKey).publicKey),
    timestamp: input.timestamp,
  });
  return validateKeyRotation({
    ...payload,
    recovery_signatures: recoverySecretKeys.map((secretKey) => ({
      recovery_key: encodeNid1(generateKeypair(secretKey).publicKey),
      signature: signPayload(payload, secretKey),
    })),
    new_signature: signPayload(payload, newSecretKey),
  }) as RecoveryRotation;
}

export interface VerifyKeyRotationOptions {
  /**
   * The recovery keys, and threshold, authorized to rotate `old_id` — taken
   * from whichever identity document the caller treats as authoritative for
   * it. Required to verify a recovery rotation. Which document that is, is
   * a real question (identity.md §8): a compromised primary key can publish
   * a document naming recovery keys of its own, so this library takes the
   * answer as an input rather than assuming one.
   */
  recovery?: { keys: readonly string[]; threshold?: number };
  /** Signature check for the old and new identities of a *standard* rotation, if they aren't native (default: native `nid1`). */
  verify?: SignatureVerifier;
}

/**
 * Whether a rotation declaration is properly authorized (identity.md §6.1–§6.2).
 *
 * - **Standard:** both the old key and the new key signed.
 * - **Recovery:** the new key signed, and at least `threshold` of the
 *   *distinct* registered recovery keys signed.
 *
 * Recovery signatures are counted, not required: an entry from a key that
 * isn't registered, or whose signature doesn't verify, is ignored rather
 * than invalidating the declaration (`recovery_signatures` lies outside
 * what the signatures cover, so a relay could append entries), and a key
 * counts once however many times it appears (or one key listed twice
 * would satisfy a threshold of 2).
 */
export function verifyKeyRotation(
  rotation: KeyRotation,
  options?: VerifyKeyRotationOptions,
): boolean {
  const verify = options?.verify ?? verifyNativeSignature;
  const payload = payloadOf(rotation);
  const holds = (signature: string, signerId: string, check: SignatureVerifier): boolean =>
    check({ ...payload, signature }, signerId);

  if (!holds(rotation.new_signature, rotation.new_id, verify)) return false;

  if ('old_signature' in rotation) {
    return holds(rotation.old_signature, rotation.old_id, verify);
  }

  const recovery = options?.recovery;
  if (recovery === undefined) return false;
  const threshold = recovery.threshold ?? 1;
  if (!Number.isInteger(threshold) || threshold < 1) return false;

  const registered = new Set(recovery.keys);
  const counted = new Set<string>();
  for (const { recovery_key, signature } of rotation.recovery_signatures) {
    if (registered.has(recovery_key) && holds(signature, recovery_key, verifyNativeSignature)) {
      counted.add(recovery_key);
    }
  }
  return counted.size >= threshold;
}

export type SuccessorResult =
  | { status: 'none' }
  | { status: 'rotated'; newId: string; declaration: KeyRotation }
  | { status: 'contested'; candidates: string[] };

/**
 * Find the successor of `oldId` among a set of rotation declarations,
 * **which the caller must already have verified** ({@link verifyKeyRotation}).
 *
 * If every declaration for `oldId` names the same new identity — however
 * many there are, and however each was authorized — that is its successor
 * (the earliest declaration is reported). If valid declarations name
 * *different* successors, the identity is **contested**: a compromised key
 * can always issue a rotation of its own, and nothing in the protocol
 * says which of two competing rotations is right, so this reports the fork
 * and leaves the policy to the client (identity.md §8).
 */
export function resolveSuccessor(
  oldId: string,
  verifiedRotations: readonly KeyRotation[],
): SuccessorResult {
  const relevant = verifiedRotations.filter((r) => r.old_id === oldId);
  const newIds = [...new Set(relevant.map((r) => r.new_id))].sort();
  if (newIds.length === 0) return { status: 'none' };
  if (newIds.length > 1) return { status: 'contested', candidates: newIds };
  // Safe: `relevant` is non-empty here (`newIds` had exactly one entry).
  const earliest = [...relevant].sort((a, b) => a.timestamp - b.timestamp)[0]!;
  return { status: 'rotated', newId: earliest.new_id, declaration: earliest };
}

export interface IdentityChain {
  /** The identity the chain currently ends at: the last one reached without ambiguity. */
  currentId: string;
  /** Every identity on the way, starting with the one asked about. */
  chain: string[];
  /** Set if the chain stopped because `at` has competing successors. */
  contested?: { at: string; candidates: string[] };
  /** Set if the chain stopped because it looped back on itself. */
  cyclic?: true;
}

/**
 * Follow rotations from `startId` as far as they unambiguously go. As with
 * {@link resolveSuccessor}, the rotations must already be verified.
 */
export function resolveIdentityChain(
  startId: string,
  verifiedRotations: readonly KeyRotation[],
): IdentityChain {
  const chain = [startId];
  let current = startId;
  for (;;) {
    const successor = resolveSuccessor(current, verifiedRotations);
    if (successor.status === 'none') return { currentId: current, chain };
    if (successor.status === 'contested') {
      return {
        currentId: current,
        chain,
        contested: { at: current, candidates: successor.candidates },
      };
    }
    if (chain.includes(successor.newId)) return { currentId: current, chain, cyclic: true };
    chain.push(successor.newId);
    current = successor.newId;
  }
}

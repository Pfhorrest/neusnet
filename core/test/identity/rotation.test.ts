import { describe, expect, it } from 'vitest';
import { encodeNid1, generateKeypair } from '../../src/identity/keypair.js';
import {
  createRecoveryRotation,
  createStandardRotation,
  isValidKeyRotation,
  resolveIdentityChain,
  resolveSuccessor,
  validateKeyRotation,
  verifyKeyRotation,
  type KeyRotation,
} from '../../src/identity/rotation.js';

const key = (n: number): ReturnType<typeof generateKeypair> =>
  generateKeypair(new Uint8Array(32).fill(n));
const OLD = key(61);
const NEW = key(62);
const NEWER = key(63);
const RECOVERY_1 = key(64);
const RECOVERY_2 = key(65);
const RECOVERY_3 = key(66);
const id = (kp: ReturnType<typeof generateKeypair>): string => encodeNid1(kp.publicKey);
const OLD_ID = id(OLD);
const NEW_ID = id(NEW);
const NEWER_ID = id(NEWER);
const R1 = id(RECOVERY_1);
const R2 = id(RECOVERY_2);
const R3 = id(RECOVERY_3);

const T = 1_700_000_000;

describe('createStandardRotation / validateKeyRotation (identity.md §6.1)', () => {
  it('derives both identifiers from the keys, so they cannot be mismatched', () => {
    const rotation = createStandardRotation({ timestamp: T }, OLD.secretKey, NEW.secretKey);
    expect(rotation.old_id).toBe(OLD_ID);
    expect(rotation.new_id).toBe(NEW_ID);
    expect(rotation.type).toBe('key_rotation');
    expect(rotation.neusnet_version).toBe(1);
  });

  it('produces a declaration that validates and verifies', () => {
    const rotation = createStandardRotation({ timestamp: T }, OLD.secretKey, NEW.secretKey);
    expect(() => validateKeyRotation(rotation)).not.toThrow();
    expect(verifyKeyRotation(rotation)).toBe(true);
  });

  it('refuses to rotate a key to itself', () => {
    expect(() => createStandardRotation({ timestamp: T }, OLD.secretKey, OLD.secretKey)).toThrow();
  });
});

describe('validateKeyRotation — shape', () => {
  const standard = createStandardRotation({ timestamp: T }, OLD.secretKey, NEW.secretKey);
  const recovery = createRecoveryRotation(
    { old_id: OLD_ID, timestamp: T },
    [RECOVERY_1.secretKey],
    NEW.secretKey,
  );

  it('accepts both forms of declaration', () => {
    expect(() => validateKeyRotation(standard)).not.toThrow();
    expect(() => validateKeyRotation(recovery)).not.toThrow();
  });

  it('rejects a declaration that carries both authorization forms (it would be ambiguous which applies)', () => {
    expect(() =>
      validateKeyRotation({ ...standard, recovery_signatures: recovery.recovery_signatures }),
    ).toThrow();
  });

  it('rejects a declaration that carries neither authorization form', () => {
    const { old_signature: _o, ...bare } = standard;
    expect(() => validateKeyRotation(bare)).toThrow();
  });

  it('rejects old_id equal to new_id', () => {
    expect(() => validateKeyRotation({ ...standard, new_id: standard.old_id })).toThrow();
  });

  it('rejects a wrong version, type, or non-integer timestamp', () => {
    expect(() => validateKeyRotation({ ...standard, neusnet_version: 2 })).toThrow();
    expect(() => validateKeyRotation({ ...standard, type: 'identity' })).toThrow();
    expect(() => validateKeyRotation({ ...standard, timestamp: 1.5 })).toThrow();
  });

  it('rejects missing or empty identifiers and a missing new_signature', () => {
    expect(() => validateKeyRotation({ ...standard, old_id: '' })).toThrow();
    expect(() => validateKeyRotation({ ...standard, new_id: undefined })).toThrow();
    expect(() => validateKeyRotation({ ...standard, new_signature: undefined })).toThrow();
    expect(() => validateKeyRotation({ ...standard, old_signature: 42 })).toThrow();
  });

  it('rejects a recovery declaration with an empty, malformed, or non-nid1 recovery_signatures entry', () => {
    expect(() => validateKeyRotation({ ...recovery, recovery_signatures: [] })).toThrow();
    expect(() =>
      validateKeyRotation({ ...recovery, recovery_signatures: [{ recovery_key: R1 }] }),
    ).toThrow();
    expect(() =>
      validateKeyRotation({
        ...recovery,
        recovery_signatures: [{ recovery_key: 'at://did:plc:x', signature: 'sig' }],
      }),
    ).toThrow();
    expect(() => validateKeyRotation({ ...recovery, recovery_signatures: 'nope' })).toThrow();
  });

  it('rejects an identifier that claims to be nid1 but is malformed', () => {
    expect(() => validateKeyRotation({ ...standard, old_id: 'nid1not-valid!!' })).toThrow();
  });

  it('rejects a recovery_signatures entry that is not an object', () => {
    expect(() => validateKeyRotation({ ...recovery, recovery_signatures: ['nope'] })).toThrow();
  });

  it('rejects null and non-object input', () => {
    expect(() => validateKeyRotation(null)).toThrow();
    expect(isValidKeyRotation('nope')).toBe(false);
    expect(isValidKeyRotation(standard)).toBe(true);
  });
});

describe('verifyKeyRotation — standard rotation', () => {
  const rotation = createStandardRotation({ timestamp: T }, OLD.secretKey, NEW.secretKey);

  it('requires BOTH signatures: whoever controls the new key also controlled the old one', () => {
    const forgedOld = createStandardRotation({ timestamp: T }, NEWER.secretKey, NEW.secretKey);
    // Swap in a declaration whose old_signature came from an unrelated key.
    expect(verifyKeyRotation({ ...rotation, old_signature: forgedOld.old_signature })).toBe(false);
    const forgedNew = createStandardRotation({ timestamp: T }, OLD.secretKey, NEWER.secretKey);
    expect(verifyKeyRotation({ ...rotation, new_signature: forgedNew.new_signature })).toBe(false);
  });

  it('does not verify if any signed field is altered', () => {
    expect(verifyKeyRotation({ ...rotation, new_id: NEWER_ID })).toBe(false);
    expect(verifyKeyRotation({ ...rotation, timestamp: T + 1 })).toBe(false);
  });

  it('cannot verify non-native identifiers with the native check alone', () => {
    const odd = { ...rotation, old_id: 'at://did:plc:old' };
    expect(verifyKeyRotation(odd)).toBe(false);
  });

  it('uses a caller-supplied verifier for other substrates', () => {
    const odd = { ...rotation, old_id: 'at://did:plc:old', new_id: 'at://did:plc:new' };
    expect(verifyKeyRotation(odd, { verify: () => true })).toBe(true);
    expect(verifyKeyRotation(odd, { verify: () => false })).toBe(false);
  });
});

describe('verifyKeyRotation — recovery rotation (identity.md §6.2)', () => {
  const recoveryKeys = [R1, R2, R3];
  const twoOfThree = createRecoveryRotation(
    { old_id: OLD_ID, timestamp: T },
    [RECOVERY_1.secretKey, RECOVERY_2.secretKey],
    NEW.secretKey,
  );

  it('verifies when enough registered recovery keys signed, and the new key consented', () => {
    expect(verifyKeyRotation(twoOfThree, { recovery: { keys: recoveryKeys, threshold: 2 } })).toBe(
      true,
    );
  });

  it('defaults the threshold to 1', () => {
    const one = createRecoveryRotation(
      { old_id: OLD_ID, timestamp: T },
      [RECOVERY_1.secretKey],
      NEW.secretKey,
    );
    expect(verifyKeyRotation(one, { recovery: { keys: recoveryKeys } })).toBe(true);
  });

  it('fails when fewer than the threshold signed', () => {
    expect(verifyKeyRotation(twoOfThree, { recovery: { keys: recoveryKeys, threshold: 3 } })).toBe(
      false,
    );
  });

  it('counts a recovery key at most once, however many times its signature is listed', () => {
    // One key's signature, repeated, must not reach a threshold of 2.
    const only = createRecoveryRotation(
      { old_id: OLD_ID, timestamp: T },
      [RECOVERY_1.secretKey],
      NEW.secretKey,
    );
    const padded: KeyRotation = {
      ...only,
      recovery_signatures: [...only.recovery_signatures, ...only.recovery_signatures],
    };
    expect(verifyKeyRotation(padded, { recovery: { keys: recoveryKeys, threshold: 2 } })).toBe(
      false,
    );
  });

  it('ignores signatures from keys that are not registered, without invalidating the declaration', () => {
    // recovery_signatures sits outside what the signatures cover, so anyone
    // relaying a declaration could append entries; they must not be able to
    // break it (or pad it).
    const withStranger = createRecoveryRotation(
      { old_id: OLD_ID, timestamp: T },
      [RECOVERY_1.secretKey, NEWER.secretKey],
      NEW.secretKey,
    );
    expect(
      verifyKeyRotation(withStranger, { recovery: { keys: recoveryKeys, threshold: 1 } }),
    ).toBe(true);
    // ...but the stranger's signature does not count toward a threshold of 2.
    expect(
      verifyKeyRotation(withStranger, { recovery: { keys: recoveryKeys, threshold: 2 } }),
    ).toBe(false);
  });

  it('ignores an entry whose signature is invalid, without invalidating the declaration', () => {
    const spoiled: KeyRotation = {
      ...twoOfThree,
      recovery_signatures: [
        ...twoOfThree.recovery_signatures,
        { recovery_key: R3, signature: twoOfThree.new_signature }, // not R3's signature
      ],
    };
    expect(verifyKeyRotation(spoiled, { recovery: { keys: recoveryKeys, threshold: 2 } })).toBe(
      true,
    );
    expect(verifyKeyRotation(spoiled, { recovery: { keys: recoveryKeys, threshold: 3 } })).toBe(
      false,
    );
  });

  it('needs the new key to have consented too', () => {
    const forged: KeyRotation = {
      ...twoOfThree,
      new_signature: createStandardRotation({ timestamp: T }, OLD.secretKey, NEWER.secretKey)
        .new_signature,
    };
    expect(verifyKeyRotation(forged, { recovery: { keys: recoveryKeys, threshold: 2 } })).toBe(
      false,
    );
  });

  it('does not verify if the rotation was altered after the recovery keys signed', () => {
    const redirected = { ...twoOfThree, new_id: NEWER_ID };
    expect(verifyKeyRotation(redirected, { recovery: { keys: recoveryKeys, threshold: 2 } })).toBe(
      false,
    );
  });

  it('cannot verify without being told which recovery keys are authoritative', () => {
    expect(verifyKeyRotation(twoOfThree)).toBe(false);
  });

  it('cannot be authorized by an empty recovery key set, or a threshold below 1', () => {
    expect(verifyKeyRotation(twoOfThree, { recovery: { keys: [], threshold: 1 } })).toBe(false);
    expect(verifyKeyRotation(twoOfThree, { recovery: { keys: recoveryKeys, threshold: 0 } })).toBe(
      false,
    );
  });
});

describe('resolveSuccessor / resolveIdentityChain — following rotations', () => {
  const oldToNew = createStandardRotation({ timestamp: T }, OLD.secretKey, NEW.secretKey);
  const newToNewer = createStandardRotation({ timestamp: T + 100 }, NEW.secretKey, NEWER.secretKey);

  it('an identity nobody has rotated has no successor', () => {
    expect(resolveSuccessor(OLD_ID, [])).toEqual({ status: 'none' });
    expect(resolveIdentityChain(OLD_ID, [])).toEqual({ currentId: OLD_ID, chain: [OLD_ID] });
  });

  it('finds the successor named by a rotation', () => {
    expect(resolveSuccessor(OLD_ID, [oldToNew])).toEqual({
      status: 'rotated',
      newId: NEW_ID,
      declaration: oldToNew,
    });
  });

  it('ignores rotations of other identities', () => {
    expect(resolveSuccessor(OLD_ID, [newToNewer])).toEqual({ status: 'none' });
  });

  it('follows a chain of rotations to the current identity', () => {
    expect(resolveIdentityChain(OLD_ID, [newToNewer, oldToNew])).toEqual({
      currentId: NEWER_ID,
      chain: [OLD_ID, NEW_ID, NEWER_ID],
    });
  });

  it('is unaffected by the same rotation being present twice, or authorized two different ways', () => {
    const viaRecovery = createRecoveryRotation(
      { old_id: OLD_ID, timestamp: T + 5 },
      [RECOVERY_1.secretKey],
      NEW.secretKey,
    );
    const result = resolveSuccessor(OLD_ID, [viaRecovery, oldToNew, oldToNew]);
    expect(result.status).toBe('rotated');
    // The earliest declaration is the one reported.
    expect(result).toMatchObject({ newId: NEW_ID, declaration: oldToNew });
  });

  it('reports a fork — two valid rotations naming different successors — as contested, not resolved', () => {
    // A compromised old key can always issue its own rotation; the protocol
    // has no basis to pick between them, so the library reports the fact
    // and leaves the policy to the client (identity.md §8).
    const oldToOther = createStandardRotation({ timestamp: T + 1 }, OLD.secretKey, NEWER.secretKey);
    const result = resolveSuccessor(OLD_ID, [oldToNew, oldToOther]);
    expect(result).toEqual({ status: 'contested', candidates: [NEW_ID, NEWER_ID].sort() });
  });

  it('stops a chain at the last uncontested identity when a fork is reached', () => {
    const newToFork = createStandardRotation(
      { timestamp: T + 200 },
      NEW.secretKey,
      key(70).secretKey,
    );
    const result = resolveIdentityChain(OLD_ID, [oldToNew, newToNewer, newToFork]);
    expect(result.currentId).toBe(NEW_ID);
    expect(result.chain).toEqual([OLD_ID, NEW_ID]);
    expect(result.contested).toEqual({ at: NEW_ID, candidates: [NEWER_ID, id(key(70))].sort() });
  });

  it('terminates on a cycle (A rotates to B, B back to A) and says so', () => {
    const newBackToOld = createStandardRotation(
      { timestamp: T + 50 },
      NEW.secretKey,
      OLD.secretKey,
    );
    const result = resolveIdentityChain(OLD_ID, [oldToNew, newBackToOld]);
    expect(result.cyclic).toBe(true);
    expect(result.chain).toEqual([OLD_ID, NEW_ID]);
  });
});

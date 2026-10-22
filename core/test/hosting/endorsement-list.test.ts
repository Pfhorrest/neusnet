import { describe, expect, it } from 'vitest';
import { encodeNid1, generateKeypair } from '../../src/identity/keypair.js';
import { signObject } from '../../src/identity/signing.js';
import {
  createEndorsementList,
  isValidEndorsementList,
  validateEndorsementList,
  verifyEndorsementList,
} from '../../src/hosting/endorsement-list.js';

const OWNER = generateKeypair(new Uint8Array(32).fill(91));
const OTHER = generateKeypair(new Uint8Array(32).fill(92));
const OWNER_ID = encodeNid1(OWNER.publicKey);

const ENTRY = { id: 'ipns://k51post', version_id: 'ipfs://bafyversion1', pinned_at: 1_700_000_000 };

const MINIMAL = {
  neusnet_version: 1,
  type: 'endorsement_list',
  owner: OWNER_ID,
  generated: 1_700_001_000,
  entries: [ENTRY],
};

describe('validateEndorsementList', () => {
  it('accepts a well-formed list, per the spec\u2019s §8.1 schema', () => {
    expect(() => validateEndorsementList(MINIMAL)).not.toThrow();
  });

  it('accepts an empty entries array', () => {
    expect(() => validateEndorsementList({ ...MINIMAL, entries: [] })).not.toThrow();
  });

  it('accepts several entries for the same stable id (different pinned versions)', () => {
    const entries = [
      ENTRY,
      { ...ENTRY, version_id: 'ipfs://bafyversion2', pinned_at: 1_700_000_500 },
    ];
    expect(() => validateEndorsementList({ ...MINIMAL, entries })).not.toThrow();
  });

  it('rejects two entries with the same version_id (a meaningless duplicate pin)', () => {
    const entries = [ENTRY, { ...ENTRY, id: 'ipns://different-post' }];
    expect(() => validateEndorsementList({ ...MINIMAL, entries })).toThrow();
  });

  it('rejects a wrong neusnet_version or type', () => {
    expect(() => validateEndorsementList({ ...MINIMAL, neusnet_version: 2 })).toThrow();
    expect(() => validateEndorsementList({ ...MINIMAL, type: 'rating_collection' })).toThrow();
  });

  it('rejects a missing or empty owner', () => {
    const { owner: _o, ...rest } = MINIMAL;
    expect(() => validateEndorsementList(rest)).toThrow();
    expect(() => validateEndorsementList({ ...MINIMAL, owner: '' })).toThrow();
  });

  it('rejects a non-integer generated timestamp', () => {
    expect(() => validateEndorsementList({ ...MINIMAL, generated: 1.5 })).toThrow();
  });

  it('rejects a missing entries array', () => {
    const { entries: _e, ...rest } = MINIMAL;
    expect(() => validateEndorsementList(rest)).toThrow();
  });

  it.each(['id', 'version_id'])('rejects an entry with a missing or empty %s', (field) => {
    expect(() =>
      validateEndorsementList({ ...MINIMAL, entries: [{ ...ENTRY, [field]: '' }] }),
    ).toThrow();
    const { [field]: _f, ...rest } = ENTRY as Record<string, unknown>;
    expect(() => validateEndorsementList({ ...MINIMAL, entries: [rest] })).toThrow();
  });

  it('rejects an entry with a non-integer or missing pinned_at', () => {
    expect(() =>
      validateEndorsementList({ ...MINIMAL, entries: [{ ...ENTRY, pinned_at: 1.5 }] }),
    ).toThrow();
    const { pinned_at: _p, ...rest } = ENTRY;
    expect(() => validateEndorsementList({ ...MINIMAL, entries: [rest] })).toThrow();
  });

  it('rejects an entry pinned after the list was generated (nonsensical ordering)', () => {
    expect(() =>
      validateEndorsementList({
        ...MINIMAL,
        generated: 1_700_000_000,
        entries: [{ ...ENTRY, pinned_at: 1_700_000_001 }],
      }),
    ).toThrow();
  });

  it('accepts an entry pinned exactly when the list was generated', () => {
    expect(() =>
      validateEndorsementList({ ...MINIMAL, generated: ENTRY.pinned_at, entries: [ENTRY] }),
    ).not.toThrow();
  });

  it('rejects a non-string signature when present', () => {
    expect(() => validateEndorsementList({ ...MINIMAL, signature: 42 })).toThrow();
  });

  it('rejects null and non-object input', () => {
    expect(() => validateEndorsementList(null)).toThrow();
    expect(() => validateEndorsementList('nope')).toThrow();
  });
});

describe('isValidEndorsementList', () => {
  it('returns true/false without throwing', () => {
    expect(isValidEndorsementList(MINIMAL)).toBe(true);
    expect(isValidEndorsementList(null)).toBe(false);
  });
});

describe('createEndorsementList / verifyEndorsementList', () => {
  const input = { owner: OWNER_ID, generated: 1_700_001_000, entries: [ENTRY] };

  it('produces a validating, verifying list', () => {
    const list = createEndorsementList(input, OWNER.secretKey);
    expect(() => validateEndorsementList(list)).not.toThrow();
    expect(verifyEndorsementList(list)).toBe(true);
  });

  it('sets neusnet_version and type automatically', () => {
    const list = createEndorsementList(input, OWNER.secretKey);
    expect(list.neusnet_version).toBe(1);
    expect(list.type).toBe('endorsement_list');
  });

  it('refuses to sign for an owner that is not the signing key\u2019s own identifier', () => {
    expect(() =>
      createEndorsementList({ ...input, owner: encodeNid1(OTHER.publicKey) }, OWNER.secretKey),
    ).toThrow();
  });

  it('refuses input that would produce an invalid list', () => {
    expect(() =>
      createEndorsementList({ ...input, generated: 1, entries: [ENTRY] }, OWNER.secretKey),
    ).toThrow();
  });

  it('does not verify after any field is tampered with', () => {
    const list = createEndorsementList(input, OWNER.secretKey);
    expect(verifyEndorsementList({ ...list, generated: list.generated + 1 })).toBe(false);
  });

  it('does not verify without a signature', () => {
    expect(verifyEndorsementList(validateEndorsementList(MINIMAL))).toBe(false);
  });

  it('does not verify when signed by a key other than the one its owner names', () => {
    const forged = validateEndorsementList(
      signObject({ ...MINIMAL, owner: OWNER_ID }, OTHER.secretKey),
    );
    expect(verifyEndorsementList(forged)).toBe(false);
  });

  it('uses a caller-supplied verifier for non-native owners', () => {
    const list = validateEndorsementList({ ...MINIMAL, owner: 'at://did:plc:abc', signature: 'x' });
    expect(verifyEndorsementList(list, { verify: () => true })).toBe(true);
    expect(verifyEndorsementList(list, { verify: () => false })).toBe(false);
  });
});

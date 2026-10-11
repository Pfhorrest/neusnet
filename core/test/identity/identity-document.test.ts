import { describe, expect, it } from 'vitest';
import { encodeNid1, generateKeypair } from '../../src/identity/keypair.js';
import { signObject } from '../../src/identity/signing.js';
import {
  createIdentityDocument,
  createIdentityLink,
  isValidIdentityDocument,
  validateIdentityDocument,
  verifyIdentityDocument,
  verifyIdentityLink,
  verifyMutualLink,
} from '../../src/identity/identity-document.js';

const OWNER = generateKeypair(new Uint8Array(32).fill(41));
const OTHER = generateKeypair(new Uint8Array(32).fill(42));
const RECOVERY_1 = generateKeypair(new Uint8Array(32).fill(43));
const RECOVERY_2 = generateKeypair(new Uint8Array(32).fill(44));
const OWNER_ID = encodeNid1(OWNER.publicKey);
const OTHER_ID = encodeNid1(OTHER.publicKey);
const RECOVERY_1_ID = encodeNid1(RECOVERY_1.publicKey);
const RECOVERY_2_ID = encodeNid1(RECOVERY_2.publicKey);

const MINIMAL = {
  neusnet_version: 1,
  type: 'identity',
  id: OWNER_ID,
  timestamp: 1_700_000_000,
};

describe('validateIdentityDocument — required fields', () => {
  it('accepts a minimal document: a keypair is a valid identity with nothing else (§1)', () => {
    expect(() => validateIdentityDocument(MINIMAL)).not.toThrow();
  });

  it('accepts a fully populated document', () => {
    const full = {
      ...MINIMAL,
      display_name: 'Alice',
      bio: 'Writes about modal logic.',
      avatar: { uri: 'ipfs://bafyavatar', mime_type: 'image/png', size: 1234 },
      links: [
        { url: 'https://example.com/alice', label: 'Home page' },
        { url: 'https://reddit.com/user/alice' },
      ],
      status: 'writing',
      recovery_keys: [RECOVERY_1_ID, RECOVERY_2_ID],
      recovery_threshold: 2,
      aggregate_linked: true,
      signature: 'sig...',
    };
    expect(validateIdentityDocument(full)).toEqual(full);
  });

  it('rejects a wrong neusnet_version or type', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, neusnet_version: 2 })).toThrow();
    expect(() => validateIdentityDocument({ ...MINIMAL, type: 'post' })).toThrow();
  });

  it('rejects a missing or empty id', () => {
    const { id: _id, ...rest } = MINIMAL;
    expect(() => validateIdentityDocument(rest)).toThrow();
    expect(() => validateIdentityDocument({ ...MINIMAL, id: '' })).toThrow();
  });

  it('accepts a non-native identifier (identity.md §2.1: other substrates are valid identities)', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, id: 'at://did:plc:abc123' })).not.toThrow();
  });

  it('rejects an id that claims to be a nid1 identifier but is malformed', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, id: 'nid1not-valid-base58!!' })).toThrow();
  });

  it('rejects a non-integer or missing timestamp', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, timestamp: 1.5 })).toThrow();
    const { timestamp: _t, ...rest } = MINIMAL;
    expect(() => validateIdentityDocument(rest)).toThrow();
  });

  it('rejects null and non-object input', () => {
    expect(() => validateIdentityDocument(null)).toThrow();
    expect(() => validateIdentityDocument('nope')).toThrow();
  });

  it('rejects a non-string signature when present', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, signature: 42 })).toThrow();
  });
});

describe('validateIdentityDocument — profile fields', () => {
  it.each(['display_name', 'bio', 'status'])('rejects a non-string %s', (field) => {
    expect(() => validateIdentityDocument({ ...MINIMAL, [field]: 42 })).toThrow();
  });

  it('validates the avatar as a content reference (metadata.md §4)', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, avatar: { uri: '' } })).toThrow();
    expect(() => validateIdentityDocument({ ...MINIMAL, avatar: 'ipfs://x' })).toThrow();
  });

  it('requires each link to have an absolute URL', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, links: [{ url: 'not a url' }] })).toThrow();
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, links: [{ url: '/relative/path' }] }),
    ).toThrow();
    expect(() => validateIdentityDocument({ ...MINIMAL, links: [{ label: 'no url' }] })).toThrow();
  });

  it('rejects a non-string link label and a non-array links field', () => {
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, links: [{ url: 'https://example.com', label: 7 }] }),
    ).toThrow();
    expect(() => validateIdentityDocument({ ...MINIMAL, links: 'https://example.com' })).toThrow();
  });
});

describe('validateIdentityDocument — recovery keys (identity.md §3.3, §5.2)', () => {
  it('rejects a recovery key that is not a valid nid1 identifier', () => {
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, recovery_keys: ['at://did:plc:abc'] }),
    ).toThrow();
  });

  it('rejects duplicate recovery keys (one key must not be able to count twice toward a threshold)', () => {
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, recovery_keys: [RECOVERY_1_ID, RECOVERY_1_ID] }),
    ).toThrow();
  });

  it('rejects a recovery key identical to the identity\u2019s own key (it would not be a separate fallback)', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, recovery_keys: [OWNER_ID] })).toThrow();
  });

  it('accepts a threshold up to the number of recovery keys', () => {
    for (const threshold of [1, 2]) {
      expect(() =>
        validateIdentityDocument({
          ...MINIMAL,
          recovery_keys: [RECOVERY_1_ID, RECOVERY_2_ID],
          recovery_threshold: threshold,
        }),
      ).not.toThrow();
    }
  });

  it.each([0, -1, 1.5, 3])(
    'rejects recovery_threshold %s with two recovery keys (must be an integer from 1 to the key count)',
    (recovery_threshold) => {
      expect(() =>
        validateIdentityDocument({
          ...MINIMAL,
          recovery_keys: [RECOVERY_1_ID, RECOVERY_2_ID],
          recovery_threshold,
        }),
      ).toThrow();
    },
  );

  it('rejects a recovery_threshold when there are no recovery keys to meet it', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, recovery_threshold: 1 })).toThrow();
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, recovery_keys: [], recovery_threshold: 1 }),
    ).toThrow();
  });
});

describe('validateIdentityDocument — linked identities (identity.md §7)', () => {
  const link = { linked_id: OTHER_ID, timestamp: 1_700_000_000, signature: 'sig...' };

  it('accepts well-formed link records', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, linked_ids: [link] })).not.toThrow();
  });

  it('rejects a link record with a missing linked_id, timestamp, or signature', () => {
    for (const field of ['linked_id', 'timestamp', 'signature']) {
      const { [field]: _omitted, ...rest } = link as Record<string, unknown>;
      expect(() => validateIdentityDocument({ ...MINIMAL, linked_ids: [rest] })).toThrow();
    }
  });

  it('rejects an identity linking to itself', () => {
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, linked_ids: [{ ...link, linked_id: OWNER_ID }] }),
    ).toThrow();
  });

  it('rejects two link records for the same identity', () => {
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, linked_ids: [link, { ...link, timestamp: 2 }] }),
    ).toThrow();
  });

  it('rejects a non-boolean aggregate_linked', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, aggregate_linked: 'yes' })).toThrow();
  });
});

describe('validateIdentityDocument — proxy identities (identity.md §5.2)', () => {
  it('accepts a proxy that names its operator', () => {
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, proxy: true, operator: OTHER_ID }),
    ).not.toThrow();
  });

  it('requires an operator when proxy is true', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, proxy: true })).toThrow();
  });

  it('rejects an operator on an identity that is not a proxy', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, operator: OTHER_ID })).toThrow();
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, proxy: false, operator: OTHER_ID }),
    ).toThrow();
  });

  it('rejects a proxy that names itself as its own operator', () => {
    expect(() =>
      validateIdentityDocument({ ...MINIMAL, proxy: true, operator: OWNER_ID }),
    ).toThrow();
  });

  it('rejects a non-boolean proxy and an empty operator', () => {
    expect(() => validateIdentityDocument({ ...MINIMAL, proxy: 'yes' })).toThrow();
    expect(() => validateIdentityDocument({ ...MINIMAL, proxy: true, operator: '' })).toThrow();
  });
});

describe('isValidIdentityDocument', () => {
  it('returns true/false without throwing', () => {
    expect(isValidIdentityDocument(MINIMAL)).toBe(true);
    expect(isValidIdentityDocument(null)).toBe(false);
  });
});

describe('createIdentityDocument / verifyIdentityDocument', () => {
  const input = { id: OWNER_ID, display_name: 'Alice', timestamp: 1_700_000_000 };

  it('produces a validating, verifying document', () => {
    const doc = createIdentityDocument(input, OWNER.secretKey);
    expect(() => validateIdentityDocument(doc)).not.toThrow();
    expect(verifyIdentityDocument(doc)).toBe(true);
  });

  it('sets neusnet_version and type automatically', () => {
    const doc = createIdentityDocument(input, OWNER.secretKey);
    expect(doc.neusnet_version).toBe(1);
    expect(doc.type).toBe('identity');
  });

  it('refuses to sign for an id that is not the signing key\u2019s own identifier', () => {
    // Such a document could never verify, so it must not be produced.
    expect(() => createIdentityDocument({ ...input, id: OTHER_ID }, OWNER.secretKey)).toThrow();
  });

  it('refuses input that would produce an invalid document', () => {
    expect(() =>
      createIdentityDocument({ ...input, recovery_threshold: 1 }, OWNER.secretKey),
    ).toThrow();
  });

  it('does not verify after any field is tampered with', () => {
    const doc = createIdentityDocument(input, OWNER.secretKey);
    expect(verifyIdentityDocument({ ...doc, display_name: 'Mallory' })).toBe(false);
  });

  it('does not verify without a signature', () => {
    expect(verifyIdentityDocument(validateIdentityDocument(MINIMAL))).toBe(false);
  });

  it('does not verify when signed by a key other than the one its id names', () => {
    const forged = validateIdentityDocument(
      signObject({ ...MINIMAL, id: OWNER_ID }, OTHER.secretKey),
    );
    expect(verifyIdentityDocument(forged)).toBe(false);
  });

  it('cannot verify a non-native identifier with the native check alone', () => {
    const doc = validateIdentityDocument({ ...MINIMAL, id: 'at://did:plc:abc', signature: 'x' });
    expect(verifyIdentityDocument(doc)).toBe(false);
  });

  it('uses a caller-supplied verifier for other substrates', () => {
    const doc = validateIdentityDocument({ ...MINIMAL, id: 'at://did:plc:abc', signature: 'x' });
    const verify = (_obj: object, signerId: string): boolean => signerId === 'at://did:plc:abc';
    expect(verifyIdentityDocument(doc, { verify })).toBe(true);
  });
});

describe('identity link records and mutual verification (identity.md §7)', () => {
  function docWithLink(
    owner: typeof OWNER,
    ownerId: string,
    linkedId: string,
    linkSigner: typeof OWNER = owner,
  ): ReturnType<typeof createIdentityDocument> {
    const link = createIdentityLink(
      { linked_id: linkedId, timestamp: 1_700_000_000 },
      linkSigner.secretKey,
    );
    return createIdentityDocument(
      { id: ownerId, timestamp: 1_700_000_001, linked_ids: [link] },
      owner.secretKey,
    );
  }

  it('a link record verifies against the key of the identity that made it', () => {
    const link = createIdentityLink({ linked_id: OTHER_ID, timestamp: 5 }, OWNER.secretKey);
    expect(verifyIdentityLink(link, OWNER.publicKey)).toBe(true);
    expect(verifyIdentityLink(link, OTHER.publicKey)).toBe(false);
  });

  it('a link record does not verify if its linked_id is altered', () => {
    const link = createIdentityLink({ linked_id: OTHER_ID, timestamp: 5 }, OWNER.secretKey);
    expect(verifyIdentityLink({ ...link, linked_id: RECOVERY_1_ID }, OWNER.publicKey)).toBe(false);
  });

  it('two identities that each declare the link are mutually verified', () => {
    const a = docWithLink(OWNER, OWNER_ID, OTHER_ID);
    const b = docWithLink(OTHER, OTHER_ID, OWNER_ID);
    expect(verifyMutualLink(a, b)).toBe(true);
    expect(verifyMutualLink(b, a)).toBe(true);
  });

  it('a unilateral declaration is not verified', () => {
    const a = docWithLink(OWNER, OWNER_ID, OTHER_ID);
    const bWithoutLink = createIdentityDocument(
      { id: OTHER_ID, timestamp: 1_700_000_001 },
      OTHER.secretKey,
    );
    expect(verifyMutualLink(a, bWithoutLink)).toBe(false);
  });

  it('a link declared toward a different identity does not count', () => {
    const a = docWithLink(OWNER, OWNER_ID, OTHER_ID);
    const bLinksElsewhere = docWithLink(OTHER, OTHER_ID, RECOVERY_1_ID);
    expect(verifyMutualLink(a, bLinksElsewhere)).toBe(false);
  });

  it('a link record signed by the wrong key does not count, even inside a validly signed document', () => {
    const a = docWithLink(OWNER, OWNER_ID, OTHER_ID, OTHER); // link record signed by OTHER, not OWNER
    const b = docWithLink(OTHER, OTHER_ID, OWNER_ID);
    expect(verifyIdentityDocument(a)).toBe(true); // the document itself is fine...
    expect(verifyMutualLink(a, b)).toBe(false); // ...but the link record isn't the owner's
  });

  it('requires both documents themselves to verify', () => {
    const a = docWithLink(OWNER, OWNER_ID, OTHER_ID);
    const b = docWithLink(OTHER, OTHER_ID, OWNER_ID);
    expect(verifyMutualLink(a, { ...b, display_name: 'tampered' })).toBe(false);
  });

  it('an identity is never mutually linked with itself', () => {
    const a = docWithLink(OWNER, OWNER_ID, OTHER_ID);
    expect(verifyMutualLink(a, a)).toBe(false);
  });

  it('uses a caller-supplied verifier for other substrates', () => {
    const a = docWithLink(OWNER, OWNER_ID, OTHER_ID);
    const b = docWithLink(OTHER, OTHER_ID, OWNER_ID);
    expect(verifyMutualLink(a, b, { verify: () => false })).toBe(false);
    expect(verifyMutualLink(a, b, { verify: () => true })).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { createIdentityDocument } from '../../src/identity/identity-document.js';
import { encodeNid1, generateKeypair } from '../../src/identity/keypair.js';
import {
  extractNeusnetIds,
  normalizeProfileUrl,
  verifyPlatformBinding,
} from '../../src/identity/platform-binding.js';

const OWNER = generateKeypair(new Uint8Array(32).fill(51));
const OTHER = generateKeypair(new Uint8Array(32).fill(52));
const OWNER_ID = encodeNid1(OWNER.publicKey);
const OTHER_ID = encodeNid1(OTHER.publicKey);
const PROFILE_URL = 'https://reddit.com/user/exampleuser';

function documentLinking(url: string | undefined): ReturnType<typeof createIdentityDocument> {
  return createIdentityDocument(
    {
      id: OWNER_ID,
      timestamp: 1_700_000_000,
      ...(url !== undefined ? { links: [{ url, label: 'Reddit' }] } : {}),
    },
    OWNER.secretKey,
  );
}

describe('extractNeusnetIds', () => {
  it('finds a key token in profile text', () => {
    expect(extractNeusnetIds(`Philosophy nerd. [neusnet:${OWNER_ID}]`)).toEqual([OWNER_ID]);
  });

  it('finds several distinct tokens, once each, in order of first appearance', () => {
    const text = `[neusnet:${OTHER_ID}] and [neusnet:${OWNER_ID}] and again [neusnet:${OTHER_ID}]`;
    expect(extractNeusnetIds(text)).toEqual([OTHER_ID, OWNER_ID]);
  });

  it('returns nothing when there is no token', () => {
    expect(extractNeusnetIds('Just a bio.')).toEqual([]);
    expect(extractNeusnetIds('')).toEqual([]);
  });

  it.each([
    ['an empty payload', '[neusnet:nid1]'],
    ['no nid1 prefix', '[neusnet:abc123]'],
    ['a payload that is valid base58 but not a 32-byte key', '[neusnet:nid1abc]'],
    ['an unclosed bracket', `[neusnet:${OWNER_ID}`],
    ['a differently-cased scheme', `[NEUSNET:${OWNER_ID}]`],
    ['whitespace inside the brackets', `[neusnet: ${OWNER_ID}]`],
  ])('ignores a malformed token: %s', (_label, text) => {
    expect(extractNeusnetIds(text)).toEqual([]);
  });

  it('ignores a token whose payload contains characters outside the base58 alphabet', () => {
    // '0', 'O', 'I', and 'l' are not in the Bitcoin alphabet.
    expect(extractNeusnetIds('[neusnet:nid10OIl]')).toEqual([]);
  });
});

describe('normalizeProfileUrl', () => {
  it('treats a trailing slash on the path as insignificant', () => {
    expect(normalizeProfileUrl('https://reddit.com/user/x/')).toBe(
      normalizeProfileUrl('https://reddit.com/user/x'),
    );
  });

  it('is case-insensitive in the host', () => {
    expect(normalizeProfileUrl('https://Reddit.COM/user/x')).toBe(
      normalizeProfileUrl('https://reddit.com/user/x'),
    );
  });

  it('ignores the fragment, which is never sent to the server', () => {
    expect(normalizeProfileUrl('https://reddit.com/user/x#top')).toBe(
      normalizeProfileUrl('https://reddit.com/user/x'),
    );
  });

  it('treats an explicit default port as insignificant', () => {
    expect(normalizeProfileUrl('https://reddit.com:443/user/x')).toBe(
      normalizeProfileUrl('https://reddit.com/user/x'),
    );
  });

  it('keeps the path case-sensitive, and the query string', () => {
    expect(normalizeProfileUrl('https://example.com/User/x')).not.toBe(
      normalizeProfileUrl('https://example.com/user/x'),
    );
    expect(normalizeProfileUrl('https://forum.example/profile.php?id=1')).not.toBe(
      normalizeProfileUrl('https://forum.example/profile.php?id=2'),
    );
  });

  it('does not conflate http with https', () => {
    expect(normalizeProfileUrl('http://reddit.com/user/x')).not.toBe(
      normalizeProfileUrl('https://reddit.com/user/x'),
    );
  });

  it('keeps the root path as a bare slash', () => {
    expect(normalizeProfileUrl('https://example.com/')).toBe(
      normalizeProfileUrl('https://example.com'),
    );
  });

  it('returns an unparseable string unchanged', () => {
    expect(normalizeProfileUrl('not a url')).toBe('not a url');
  });
});

describe('verifyPlatformBinding (identity.md §2.2: both directions or it is unverified)', () => {
  const profileText = `Philosophy nerd. [neusnet:${OWNER_ID}]`;

  it('is verified when the profile carries the key token AND the signed document links back to the profile', () => {
    const result = verifyPlatformBinding({
      profileUrl: PROFILE_URL,
      profileText,
      identityDocument: documentLinking(PROFILE_URL),
    });
    expect(result).toEqual({ verified: true, id: OWNER_ID });
  });

  it('matches the profile URL despite harmless formatting differences', () => {
    const result = verifyPlatformBinding({
      profileUrl: 'https://Reddit.com/user/exampleuser/',
      profileText,
      identityDocument: documentLinking(PROFILE_URL),
    });
    expect(result.verified).toBe(true);
  });

  it('is unverified when the profile has no token (the document claims the account, but the account never claimed the key)', () => {
    const result = verifyPlatformBinding({
      profileUrl: PROFILE_URL,
      profileText: 'Just a bio.',
      identityDocument: documentLinking(PROFILE_URL),
    });
    expect(result).toEqual({ verified: false, reason: 'no-token' });
  });

  it('is unverified when the profile\u2019s token names a different key than the document', () => {
    const result = verifyPlatformBinding({
      profileUrl: PROFILE_URL,
      profileText: `[neusnet:${OTHER_ID}]`,
      identityDocument: documentLinking(PROFILE_URL),
    });
    expect(result).toEqual({ verified: false, reason: 'no-token' });
  });

  it('is unverified when the document does not link to the profile (the account claims a key that never claimed the account)', () => {
    const noLinks = verifyPlatformBinding({
      profileUrl: PROFILE_URL,
      profileText,
      identityDocument: documentLinking(undefined),
    });
    expect(noLinks).toEqual({ verified: false, reason: 'url-not-linked' });

    const wrongProfile = verifyPlatformBinding({
      profileUrl: PROFILE_URL,
      profileText,
      identityDocument: documentLinking('https://reddit.com/user/someone-else'),
    });
    expect(wrongProfile).toEqual({ verified: false, reason: 'url-not-linked' });
  });

  it('is unverified when the identity document\u2019s signature does not verify', () => {
    const tampered = { ...documentLinking(PROFILE_URL), display_name: 'Mallory' };
    const result = verifyPlatformBinding({
      profileUrl: PROFILE_URL,
      profileText,
      identityDocument: tampered,
    });
    expect(result).toEqual({ verified: false, reason: 'document-unverified' });
  });

  it('forwards a caller-supplied signature verifier to the document check', () => {
    const result = verifyPlatformBinding({
      profileUrl: PROFILE_URL,
      profileText,
      identityDocument: documentLinking(PROFILE_URL),
      verify: () => false,
    });
    expect(result).toEqual({ verified: false, reason: 'document-unverified' });
  });
});

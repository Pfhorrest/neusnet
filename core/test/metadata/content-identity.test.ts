import { describe, expect, it } from 'vitest';
import {
  contentIdentityMatches,
  contentReferencesMatch,
} from '../../src/metadata/content-identity.js';
import type { ContentReference } from '../../src/metadata/content-reference.js';
import type { PostMetadata } from '../../src/metadata/post.js';

const SHA = 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

function post(content: ContentReference[]): PostMetadata {
  return { neusnet_version: 1, type: 'post', id: 'ipns://x', tags: [], content, timestamp: 1 };
}

describe('contentReferencesMatch — immutable URIs', () => {
  it('matches identical IPFS URIs', () => {
    expect(contentReferencesMatch({ uri: 'ipfs://bafyA' }, { uri: 'ipfs://bafyA' })).toBe(true);
  });

  it('does not match different IPFS URIs', () => {
    expect(contentReferencesMatch({ uri: 'ipfs://bafyA' }, { uri: 'ipfs://bafyB' })).toBe(false);
  });

  it('ignores mime_type and size when the immutable URI matches', () => {
    expect(
      contentReferencesMatch(
        { uri: 'ipfs://bafyA', mime_type: 'text/html', size: 10 },
        { uri: 'ipfs://bafyA' },
      ),
    ).toBe(true);
  });

  it('compares IPFS CIDs case-sensitively (CIDv0 is case-sensitive base58)', () => {
    expect(contentReferencesMatch({ uri: 'ipfs://QmAbC' }, { uri: 'ipfs://QmabC' })).toBe(false);
  });

  it('matches magnet links by BitTorrent infohash, ignoring case and other parameters', () => {
    expect(
      contentReferencesMatch(
        { uri: 'magnet:?xt=urn:btih:ABCDEF0123&dn=name&tr=udp://tracker.example' },
        { uri: 'magnet:?dn=other&xt=urn:btih:abcdef0123' },
      ),
    ).toBe(true);
  });

  it('does not match magnet links with different infohashes', () => {
    expect(
      contentReferencesMatch({ uri: 'magnet:?xt=urn:btih:aaaa' }, { uri: 'magnet:?xt=urn:btih:bbbb' }),
    ).toBe(false);
  });

  it('does not match a magnet link that carries no infohash', () => {
    expect(contentReferencesMatch({ uri: 'magnet:?dn=x' }, { uri: 'magnet:?dn=x' })).toBe(false);
  });

  it('does not match an empty ipfs:// URI', () => {
    expect(contentReferencesMatch({ uri: 'ipfs://' }, { uri: 'ipfs://' })).toBe(false);
  });
});

describe('contentReferencesMatch — mutable URIs', () => {
  it.each(['https://example.com/post', 'http://example.com/post', 'ipns://k51abc'])(
    'does not treat equal mutable URI %s as a match on its own',
    (uri) => {
      expect(contentReferencesMatch({ uri }, { uri })).toBe(false);
    },
  );

  it('treats an unknown URI scheme as mutable (conservative)', () => {
    expect(contentReferencesMatch({ uri: 'foo://same' }, { uri: 'foo://same' })).toBe(false);
  });

  it('matches equal mutable URIs when both also carry the same hash', () => {
    expect(
      contentReferencesMatch(
        { uri: 'https://example.com/post', hash: SHA },
        { uri: 'https://example.com/post', hash: SHA },
      ),
    ).toBe(true);
  });
});

describe('contentReferencesMatch — hash fields', () => {
  it('matches different URIs that share a hash', () => {
    expect(
      contentReferencesMatch(
        { uri: 'https://a.example/x', hash: SHA },
        { uri: 'https://b.example/y', hash: SHA },
      ),
    ).toBe(true);
  });

  it('compares the algorithm and digest case-insensitively', () => {
    expect(
      contentReferencesMatch(
        { uri: 'https://a.example/x', hash: 'SHA256:ABCD' },
        { uri: 'https://b.example/y', hash: 'sha256:abcd' },
      ),
    ).toBe(true);
  });

  it('does not match when the algorithms differ, even if the digests are identical strings', () => {
    expect(
      contentReferencesMatch(
        { uri: 'https://a.example/x', hash: 'sha256:abcd' },
        { uri: 'https://b.example/y', hash: 'blake3:abcd' },
      ),
    ).toBe(false);
  });

  it('does not match different digests', () => {
    expect(
      contentReferencesMatch(
        { uri: 'https://a.example/x', hash: 'sha256:abcd' },
        { uri: 'https://b.example/y', hash: 'sha256:abce' },
      ),
    ).toBe(false);
  });

  it('does not match when only one side has a hash', () => {
    expect(
      contentReferencesMatch({ uri: 'https://a.example/x', hash: SHA }, { uri: 'https://b.example/y' }),
    ).toBe(false);
  });
});

describe('contentReferencesMatch — inline content', () => {
  // Every inline reference has the same `uri` ("inline:"), so URI equality
  // alone would call ALL inline content identical; identity must be decided
  // by the inline text itself.
  it('matches inline references with identical text', () => {
    expect(
      contentReferencesMatch(
        { uri: 'inline:', inline_content: 'Hello' },
        { uri: 'inline:', inline_content: 'Hello' },
      ),
    ).toBe(true);
  });

  it('does not match inline references with different text', () => {
    expect(
      contentReferencesMatch(
        { uri: 'inline:', inline_content: 'Hello' },
        { uri: 'inline:', inline_content: 'Goodbye' },
      ),
    ).toBe(false);
  });

  it('compares inline text exactly, with no Unicode normalization (consistent with JCS)', () => {
    expect(
      contentReferencesMatch(
        { uri: 'inline:', inline_content: '\u00e9' },
        { uri: 'inline:', inline_content: 'e\u0301' },
      ),
    ).toBe(false);
  });

  it('does not match an inline reference against a non-inline one', () => {
    expect(
      contentReferencesMatch({ uri: 'inline:', inline_content: 'Hello' }, { uri: 'ipfs://bafyA' }),
    ).toBe(false);
  });
});

describe('contentIdentityMatches', () => {
  it('matches when any single reference matches (references are mirrors of the same content)', () => {
    const a = post([{ uri: 'https://a.example/x' }, { uri: 'ipfs://bafyA' }]);
    const b = post([{ uri: 'https://other.example/y' }, { uri: 'ipfs://bafyA' }]);
    expect(contentIdentityMatches(a, b)).toBe(true);
  });

  it('does not match when no reference matches', () => {
    expect(contentIdentityMatches(post([{ uri: 'ipfs://bafyA' }]), post([{ uri: 'ipfs://bafyB' }]))).toBe(
      false,
    );
  });

  it('is symmetric', () => {
    const a = post([{ uri: 'https://a.example/x', hash: SHA }]);
    const b = post([{ uri: 'https://b.example/y', hash: SHA }]);
    expect(contentIdentityMatches(a, b)).toBe(contentIdentityMatches(b, a));
  });
});

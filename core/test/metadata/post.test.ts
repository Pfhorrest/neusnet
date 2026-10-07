import { describe, expect, it } from 'vitest';
import { encodeNid1, generateKeypair } from '../../src/identity/keypair.js';
import { signObject } from '../../src/identity/signing.js';
import {
  computeTrustLevel,
  createPostMetadata,
  isValidPostMetadata,
  UnrecognizedVersionError,
  validatePostMetadata,
} from '../../src/metadata/post.js';

const AUTHOR = generateKeypair(new Uint8Array(32).fill(11));
const INTRODUCER = generateKeypair(new Uint8Array(32).fill(22));
const STRANGER = generateKeypair(new Uint8Array(32).fill(33));

// --- Appendix A: Minimal Valid Metadata File (metadata.md), as corrected
// to include the required `type` field that the published spec's Appendix
// A was itself missing until this implementation surfaced the gap. ---
const APPENDIX_A = {
  neusnet_version: 1,
  type: 'post',
  id: 'ipns://k51qzi5uqu5dh6lfh0....',
  author: 'npub1abc123...',
  tags: [],
  content: [{ uri: 'inline:', mime_type: 'text/plain', inline_content: 'Hello, neusnet.' }],
  timestamp: 1740000000,
  signature: 'sig1abc...',
};

// --- Appendix B: Full-Featured Metadata File, likewise corrected. ---
const APPENDIX_B = {
  neusnet_version: 1,
  type: 'post',
  id: 'ipns://k51qzi5uqu5dh6lfh0....',
  author: 'npub1abc123...',
  subject: 'Re: The case for decentralized moderation',
  summary: 'A counterargument focusing on the cold-start problem and Sybil resistance.',
  tags: ['decentralization', 'moderation', 'trust-graphs'],
  content: [
    {
      uri: 'ipfs://bafybeig...',
      mime_type: 'text/html',
      size: 142080,
      hash: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    },
    {
      uri: 'https://example.com/posts/counterargument.html',
      mime_type: 'text/html',
      hash: 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    },
  ],
  parents: ['<version identifier of parent post>'],
  previous: '<version identifier of prior version of this post>',
  timestamp: 1740003600,
  signature: 'sig1abc...',
};

// --- Appendix C: Multi-Parent Synthesis Reply, verbatim. ---
const APPENDIX_C = {
  neusnet_version: 1,
  type: 'post',
  id: 'ipns://k51qzi5uqu5dh6lfh1....',
  author: 'nid1F3sAqQpLzFtKmVbRwXcNyHjDgEoIuPe...',
  subject: 'Re: The moderation debate — a synthesis',
  summary: 'Both positions share more ground than the disagreement suggests.',
  tags: ['decentralization', 'moderation', 'trust-graphs'],
  content: [
    {
      uri: 'inline:',
      mime_type: 'text/plain',
      inline_content:
        "You're both closer than you think. Alice's Sybil-resistance concern and Bob's cold-start concern are two sides of the same tradeoff...",
    },
  ],
  parents: ['ipns://k51qzi5uqu5dh6lfh0.../version/abc', 'ipns://k51qzi5uqu5dh6lfh2.../version/def'],
  timestamp: 1740003800,
  signature: 'sig1abc...',
};

// --- Appendix D: Third-Party-Attested Bridged Post, verbatim (as
// corrected: originally titled "Unsigned Bridged Post" despite having a
// signature field, which this implementation's trust-level tests below
// confirm actually makes it third-party attested, not unverified). ---
const APPENDIX_D = {
  neusnet_version: 1,
  type: 'post',
  id: 'at://did:plc:abc123.../app.bsky.feed.post/xyz',
  author: 'at://did:plc:abc123...',
  subject: 'Interesting thread on trust graphs',
  tags: ['trust-graphs', 'bluesky'],
  content: [
    { uri: 'https://bsky.app/profile/abc123.bsky.social/post/xyz', mime_type: 'text/html' },
  ],
  timestamp: 1740007200,
  signature: 'sig_of_introducer_not_author...',
};

describe('validatePostMetadata — spec appendix examples', () => {
  it.each([
    ['Appendix A (minimal)', APPENDIX_A],
    ['Appendix B (full-featured)', APPENDIX_B],
    ['Appendix C (multi-parent)', APPENDIX_C],
    ['Appendix D (third-party-attested bridged)', APPENDIX_D],
  ])('accepts %s', (_label, example) => {
    expect(() => validatePostMetadata(example)).not.toThrow();
  });

  it('Appendix C genuinely has two parents, and validation preserves both in order', () => {
    const validated = validatePostMetadata(APPENDIX_C);
    expect(validated.parents).toEqual([
      'ipns://k51qzi5uqu5dh6lfh0.../version/abc',
      'ipns://k51qzi5uqu5dh6lfh2.../version/def',
    ]);
  });
});

describe('validatePostMetadata — required fields', () => {
  const base = {
    neusnet_version: 1,
    type: 'post',
    id: 'ipns://example',
    tags: [],
    content: [{ uri: 'ipfs://x' }],
    timestamp: 1740000000,
  };

  it('accepts the minimal object with no author and no signature (genuinely unsigned)', () => {
    expect(() => validatePostMetadata(base)).not.toThrow();
  });

  it('rejects a missing neusnet_version', () => {
    const { neusnet_version: _n, ...rest } = base;
    expect(() => validatePostMetadata(rest)).toThrow();
  });

  it('throws UnrecognizedVersionError specifically for a non-1 neusnet_version', () => {
    expect(() => validatePostMetadata({ ...base, neusnet_version: 2 })).toThrow(
      UnrecognizedVersionError,
    );
  });

  it('rejects a wrong type value', () => {
    expect(() => validatePostMetadata({ ...base, type: 'identity' })).toThrow();
  });

  it('rejects a missing id', () => {
    const { id: _id, ...rest } = base;
    expect(() => validatePostMetadata(rest)).toThrow();
  });

  it('rejects an empty id', () => {
    expect(() => validatePostMetadata({ ...base, id: '' })).toThrow();
  });

  it('rejects a missing tags array', () => {
    const { tags: _t, ...rest } = base;
    expect(() => validatePostMetadata(rest)).toThrow();
  });

  it('rejects a tag that is not already in normalized form', () => {
    // ratings.md §6: tags in a post must already be normalized — "Science
    // Fiction" (unnormalized) is not the same string as its own
    // normalization ("science-fiction"), so this must be rejected rather
    // than silently normalized on the caller's behalf.
    expect(() => validatePostMetadata({ ...base, tags: ['Science Fiction'] })).toThrow();
  });

  it('accepts already-normalized tags', () => {
    expect(() => validatePostMetadata({ ...base, tags: ['science-fiction'] })).not.toThrow();
  });

  it('rejects a missing content array', () => {
    const { content: _c, ...rest } = base;
    expect(() => validatePostMetadata(rest)).toThrow();
  });

  it('rejects an empty content array', () => {
    expect(() => validatePostMetadata({ ...base, content: [] })).toThrow();
  });

  it('rejects a content array with an invalid content reference', () => {
    expect(() => validatePostMetadata({ ...base, content: [{ uri: '' }] })).toThrow();
  });

  it('rejects a missing timestamp', () => {
    const { timestamp: _ts, ...rest } = base;
    expect(() => validatePostMetadata(rest)).toThrow();
  });

  it('rejects a non-integer timestamp', () => {
    expect(() => validatePostMetadata({ ...base, timestamp: 1740000000.5 })).toThrow();
  });

  it('rejects null and non-object input', () => {
    expect(() => validatePostMetadata(null)).toThrow();
    expect(() => validatePostMetadata('nope')).toThrow();
  });
});

describe('validatePostMetadata — optional fields and their constraints', () => {
  const base = {
    neusnet_version: 1,
    type: 'post',
    id: 'ipns://example',
    tags: [],
    content: [{ uri: 'ipfs://x' }],
    timestamp: 1740000000,
  };

  it('accepts a present subject and summary', () => {
    expect(() =>
      validatePostMetadata({ ...base, subject: 'Hello', summary: 'A greeting.' }),
    ).not.toThrow();
  });

  it('rejects a non-string subject when present', () => {
    expect(() => validatePostMetadata({ ...base, subject: 42 })).toThrow();
  });

  it('rejects a non-string or empty author when present', () => {
    expect(() => validatePostMetadata({ ...base, author: 42 })).toThrow();
    expect(() => validatePostMetadata({ ...base, author: '' })).toThrow();
  });

  it('rejects a non-string summary when present', () => {
    expect(() => validatePostMetadata({ ...base, summary: 42 })).toThrow();
  });

  it('rejects a non-string signature when present', () => {
    expect(() => validatePostMetadata({ ...base, author: 'nid1abc', signature: 42 })).toThrow();
  });

  it('accepts an empty parents array and omitted parents equivalently', () => {
    expect(() => validatePostMetadata({ ...base, parents: [] })).not.toThrow();
    expect(() => validatePostMetadata(base)).not.toThrow();
  });

  it('accepts multiple parents', () => {
    expect(() =>
      validatePostMetadata({ ...base, parents: ['ipfs://a', 'ipfs://b', 'ipfs://c'] }),
    ).not.toThrow();
  });

  it('rejects a non-array parents field', () => {
    expect(() => validatePostMetadata({ ...base, parents: 'ipfs://a' })).toThrow();
  });

  it('rejects a non-empty-string entry in parents', () => {
    expect(() => validatePostMetadata({ ...base, parents: [''] })).toThrow();
  });

  it('rejects a non-string previous field when present', () => {
    expect(() => validatePostMetadata({ ...base, previous: 42 })).toThrow();
  });

  it('requires author to be present when signature is present (metadata.md §3)', () => {
    expect(() => validatePostMetadata({ ...base, signature: 'sig...' })).toThrow();
  });

  it('accepts signature with author both present', () => {
    expect(() =>
      validatePostMetadata({ ...base, author: 'nid1abc', signature: 'sig...' }),
    ).not.toThrow();
  });
});

describe('createPostMetadata', () => {
  it('produces an object that validatePostMetadata accepts (round-trip)', () => {
    const created = createPostMetadata(
      {
        id: 'ipns://my-post',
        author: 'nid1placeholder',
        tags: ['philosophy'],
        content: [{ uri: 'inline:', mime_type: 'text/plain', inline_content: 'hi' }],
        timestamp: 1740000000,
      },
      AUTHOR.secretKey,
    );
    expect(() => validatePostMetadata(created)).not.toThrow();
  });

  it('sets neusnet_version and type automatically', () => {
    const created = createPostMetadata(
      {
        id: 'ipns://x',
        author: 'nid1placeholder',
        tags: [],
        content: [{ uri: 'ipfs://y' }],
        timestamp: 1740000000,
      },
      AUTHOR.secretKey,
    );
    expect(created.neusnet_version).toBe(1);
    expect(created.type).toBe('post');
  });

  it('includes summary, parents, and previous when supplied', () => {
    const created = createPostMetadata(
      {
        id: 'ipns://x',
        author: 'nid1placeholder',
        subject: 'A subject',
        summary: 'A summary',
        tags: [],
        content: [{ uri: 'ipfs://y' }],
        parents: ['ipfs://parent-a', 'ipfs://parent-b'],
        previous: 'ipfs://prior-version',
        timestamp: 1740000000,
      },
      AUTHOR.secretKey,
    );
    expect(created.summary).toBe('A summary');
    expect(created.parents).toEqual(['ipfs://parent-a', 'ipfs://parent-b']);
    expect(created.previous).toBe('ipfs://prior-version');
  });

  it('defaults tags to an empty array when omitted', () => {
    const created = createPostMetadata(
      { id: 'ipns://x', author: 'nid1placeholder', content: [{ uri: 'ipfs://y' }], timestamp: 1 },
      AUTHOR.secretKey,
    );
    expect(created.tags).toEqual([]);
  });

  it('produces a signature that verifies against the signing key via computeTrustLevel', () => {
    const created = createPostMetadata(
      {
        id: 'ipns://x',
        author: 'nid1placeholder',
        tags: [],
        content: [{ uri: 'ipfs://y' }],
        timestamp: 1740000000,
      },
      AUTHOR.secretKey,
    );
    // Not asserting 'author-verified' here since the author string is a
    // placeholder, not AUTHOR's real nid1 — just that it verifies as
    // *some* valid signature by AUTHOR's key (third-party-attested, since
    // the placeholder author string won't decode to AUTHOR's actual key).
    expect(computeTrustLevel(created, AUTHOR.publicKey)).toBe('third-party-attested');
  });

  it('rejects input that would produce an invalid object (e.g. unnormalized tags)', () => {
    expect(() =>
      createPostMetadata(
        {
          id: 'ipns://x',
          author: 'nid1placeholder',
          tags: ['Not Normalized'],
          content: [{ uri: 'ipfs://y' }],
          timestamp: 1,
        },
        AUTHOR.secretKey,
      ),
    ).toThrow();
  });
});

describe('computeTrustLevel', () => {
  it('returns "unverified" for a post with no signature field, regardless of key supplied', () => {
    const post = validatePostMetadata({
      neusnet_version: 1,
      type: 'post',
      id: 'ipns://x',
      tags: [],
      content: [{ uri: 'ipfs://y' }],
      timestamp: 1,
    });
    expect(computeTrustLevel(post)).toBe('unverified');
  });

  it('returns "author-verified" when the post is signed by the key its author field decodes to', () => {
    const authorId = encodeNid1(AUTHOR.publicKey);
    const post = validatePostMetadata(
      signObject(
        {
          neusnet_version: 1,
          type: 'post',
          id: 'ipns://x',
          author: authorId,
          tags: [],
          content: [{ uri: 'ipfs://y' }],
          timestamp: 1,
        },
        AUTHOR.secretKey,
      ),
    );
    expect(computeTrustLevel(post, AUTHOR.publicKey)).toBe('author-verified');
  });

  it('returns "third-party-attested" when signed by a key different from the native nid1 author', () => {
    const authorId = encodeNid1(AUTHOR.publicKey);
    const post = validatePostMetadata(
      signObject(
        {
          neusnet_version: 1,
          type: 'post',
          id: 'ipns://x',
          author: authorId, // names AUTHOR...
          tags: [],
          content: [{ uri: 'ipfs://y' }],
          timestamp: 1,
        },
        INTRODUCER.secretKey, // ...but signed by INTRODUCER
      ),
    );
    expect(computeTrustLevel(post, INTRODUCER.publicKey)).toBe('third-party-attested');
  });

  it('returns "third-party-attested" when author is a non-nid1 identifier (e.g. an AT Protocol DID), per metadata.md §6.3', () => {
    const post = validatePostMetadata(
      signObject(
        {
          neusnet_version: 1,
          type: 'post',
          id: 'at://did:plc:abc123.../app.bsky.feed.post/xyz',
          author: 'at://did:plc:abc123...', // not a nid1 identifier
          tags: [],
          content: [{ uri: 'https://example.com' }],
          timestamp: 1,
        },
        INTRODUCER.secretKey,
      ),
    );
    expect(computeTrustLevel(post, INTRODUCER.publicKey)).toBe('third-party-attested');
  });

  it('throws if signature is present but the supplied key does not actually match it', () => {
    const post = validatePostMetadata(
      signObject(
        {
          neusnet_version: 1,
          type: 'post',
          id: 'ipns://x',
          author: 'nid1placeholder',
          tags: [],
          content: [{ uri: 'ipfs://y' }],
          timestamp: 1,
        },
        AUTHOR.secretKey,
      ),
    );
    // STRANGER's key did not produce this signature — the caller got the
    // key resolution wrong, or the post is tampered; either way this is
    // not the same thing as "unverified" (which means no signature at all).
    expect(() => computeTrustLevel(post, STRANGER.publicKey)).toThrow();
  });

  it('throws if signature is present but no signer key was supplied at all', () => {
    const post = validatePostMetadata(
      signObject(
        {
          neusnet_version: 1,
          type: 'post',
          id: 'ipns://x',
          author: 'nid1placeholder',
          tags: [],
          content: [{ uri: 'ipfs://y' }],
          timestamp: 1,
        },
        AUTHOR.secretKey,
      ),
    );
    expect(() => computeTrustLevel(post)).toThrow();
  });
});

describe('isValidPostMetadata', () => {
  it('returns true for a valid post without throwing', () => {
    expect(
      isValidPostMetadata({
        neusnet_version: 1,
        type: 'post',
        id: 'ipns://x',
        tags: [],
        content: [{ uri: 'ipfs://y' }],
        timestamp: 1,
      }),
    ).toBe(true);
  });

  it('returns false (not throwing) for an invalid post', () => {
    expect(isValidPostMetadata(null)).toBe(false);
    expect(isValidPostMetadata({})).toBe(false);
  });
});

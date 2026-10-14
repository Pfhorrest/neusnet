import { describe, expect, it } from 'vitest';
import {
  buildTrustGraph,
  buildTrustGraphFromPosts,
  buildVersionHistory,
  computeTrustLevel,
  createIdentityDocument,
  createPostMetadata,
  createRatingRecord,
  createStandardRotation,
  derivedAffinity,
  effectivePostScore,
  encodeNid1,
  generateKeypair,
  normalizeTag,
  resolveIdentityChain,
  signObject,
  validatePostMetadata,
  verifyIdentityDocument,
  verifyKeyRotation,
  verifyObject,
  verifyPlatformBinding,
  type RatingRecord,
} from '../src/index.js';

// These mirror the code samples in README.md, so the documentation can't
// quietly stop working. If you change a sample there, change it here too.
describe('README examples', () => {
  it('identity, signing, and verification', () => {
    const { secretKey, publicKey } = generateKeypair();
    const myId = encodeNid1(publicKey);
    expect(myId.startsWith('nid1')).toBe(true);

    const signed = signObject({ rater: myId, item: 'ipfs://...', ratings: { true: 1 } }, secretKey);
    expect(verifyObject(signed, publicKey)).toBe(true);
    expect(verifyObject({ ...signed, ratings: { true: -1 } }, publicKey)).toBe(false);
  });

  it('tag normalization', () => {
    expect(normalizeTag('Science Fiction')).toBe('science-fiction');
    expect(normalizeTag('Philosophy.Epistemology')).toBe('philosophy.epistemology');
    expect(() => normalizeTag('philosophy..epistemology')).toThrow();
  });

  it('publishing a post, rating it, and scoring it', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const aliceId = encodeNid1(alice.publicKey);
    const bobId = encodeNid1(bob.publicKey);

    // Bob publishes a post.
    const post = createPostMetadata(
      {
        id: 'ipns://k51-example-post',
        author: bobId,
        tags: ['philosophy'],
        content: [{ uri: 'inline:', mime_type: 'text/plain', inline_content: 'Hello, neusnet.' }],
        timestamp: 1_700_000_000,
      },
      bob.secretKey,
    );

    expect(() => validatePostMetadata(post)).not.toThrow();
    expect(computeTrustLevel(post, bob.publicKey)).toBe('author-verified');

    // Alice rates it. `item` is the post's *version* identifier — in a real
    // deployment, the content address of the metadata file.
    const versionId = 'ipfs://bafy-example-version-1';
    const rating = createRatingRecord(
      {
        rater: aliceId,
        item: versionId,
        item_type: 'post',
        ratings: { true: 1 },
        timestamp: 1_700_000_100,
        public: true,
      },
      alice.secretKey,
    );

    // Build a graph from the ratings plus what's known about each rated post.
    const graph = buildTrustGraph({
      records: [rating],
      posts: new Map([[versionId, { author: bobId, tags: post.tags }]]),
    });

    // How does the post look to Alice?
    expect(effectivePostScore(graph, aliceId, versionId, { dimension: 'true' })).toBe(1);
  });
  it('versions and aggregation', () => {
    const bob = generateKeypair();
    const carol = generateKeypair();
    const bobId = encodeNid1(bob.publicKey);
    const carolId = encodeNid1(carol.publicKey);
    const postId = 'ipns://k51-example-post';

    // Bob publishes a post, then an edit of it (whose `previous` names v1).
    const v1 = createPostMetadata(
      { id: postId, author: bobId, content: [{ uri: 'ipfs://content-1' }], timestamp: 1 },
      bob.secretKey,
    );
    const v2 = createPostMetadata(
      {
        id: postId,
        author: bobId,
        content: [{ uri: 'ipfs://content-2' }],
        previous: 'ipfs://v1',
        timestamp: 2,
      },
      bob.secretKey,
    );
    const known = new Map([
      ['ipfs://v1', v1],
      ['ipfs://v2', v2],
    ]);

    const history = buildVersionHistory({ id: postId, currentVersionId: 'ipfs://v2', known });
    expect(history.canonical).toEqual(['ipfs://v2', 'ipfs://v1']);

    // Carol rated both versions, changing her mind.
    const rate = (item: string, value: number, timestamp: number): RatingRecord =>
      createRatingRecord(
        {
          rater: carolId,
          item,
          item_type: 'post',
          ratings: { true: value },
          timestamp,
          public: true,
        },
        carol.secretKey,
      );
    const records = [rate('ipfs://v1', 1, 10), rate('ipfs://v2', -1, 20)];

    // Her latest opinion counts once, not once per version.
    const graph = buildTrustGraphFromPosts({
      known,
      currentVersions: new Map([[postId, 'ipfs://v2']]),
      records,
    });
    expect(derivedAffinity(graph, carolId, bobId, 'user', { dimension: 'true' })).toBe(-1);
  });
  it('identity documents, platform binding, and key rotation', () => {
    const alice = generateKeypair();
    const aliceId = encodeNid1(alice.publicKey);

    const doc = createIdentityDocument(
      {
        id: aliceId,
        display_name: 'Alice',
        links: [{ url: 'https://reddit.com/user/alice' }],
        timestamp: 1_700_000_000,
      },
      alice.secretKey,
    );
    expect(verifyIdentityDocument(doc)).toBe(true);

    // Her Reddit bio carries her key, and her document links back to the profile:
    const binding = verifyPlatformBinding({
      profileUrl: 'https://reddit.com/user/alice',
      profileText: `Philosophy nerd. [neusnet:${aliceId}]`,
      identityDocument: doc,
    });
    expect(binding).toEqual({ verified: true, id: aliceId });

    // Later she moves to a new key; both keys sign the rotation.
    const next = generateKeypair();
    const nextId = encodeNid1(next.publicKey);
    const rotation = createStandardRotation(
      { timestamp: 1_700_100_000 },
      alice.secretKey,
      next.secretKey,
    );
    expect(verifyKeyRotation(rotation)).toBe(true);
    expect(resolveIdentityChain(aliceId, [rotation])).toEqual({
      currentId: nextId,
      chain: [aliceId, nextId],
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  buildTrustGraph,
  createPostMetadata,
  createRatingRecord,
  effectivePostScore,
  encodeNid1,
  generateKeypair,
  normalizeTag,
  signObject,
  verifyObject,
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
});

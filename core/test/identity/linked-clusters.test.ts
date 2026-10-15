import { describe, expect, it } from 'vitest';
import {
  createIdentityDocument,
  createIdentityLink,
} from '../../src/identity/identity-document.js';
import { encodeNid1, generateKeypair, type Keypair } from '../../src/identity/keypair.js';
import {
  applyIdentityMapping,
  computeIdentityMapping,
  computeLinkedClusters,
} from '../../src/identity/linked-clusters.js';
import type { PostInfo } from '../../src/ratings/trust-graph.js';
import type { RatingRecord } from '../../src/ratings/rating-record.js';

const key = (n: number): Keypair => generateKeypair(new Uint8Array(32).fill(n));
const A = key(81);
const B = key(82);
const C = key(83);
const D = key(84); // unlinked
const id = (kp: Keypair): string => encodeNid1(kp.publicKey);
const A_ID = id(A);
const B_ID = id(B);
const C_ID = id(C);
const D_ID = id(D);

/** A's document, declaring mutual links to whichever ids are given, with aggregate_linked as specified. */
function docOf(
  owner: Keypair,
  ownerId: string,
  linkedIds: string[],
  aggregateLinked?: boolean,
): ReturnType<typeof createIdentityDocument> {
  return createIdentityDocument(
    {
      id: ownerId,
      timestamp: 1,
      linked_ids: linkedIds.map((linkedId) =>
        createIdentityLink({ linked_id: linkedId, timestamp: 1 }, owner.secretKey),
      ),
      ...(aggregateLinked !== undefined ? { aggregate_linked: aggregateLinked } : {}),
    },
    owner.secretKey,
  );
}

describe('computeLinkedClusters — finding mutually-verified clusters', () => {
  it('finds a simple mutually-linked pair', () => {
    const docs = [docOf(A, A_ID, [B_ID]), docOf(B, B_ID, [A_ID])];
    const clusters = computeLinkedClusters(docs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toEqual([A_ID, B_ID].sort());
  });

  it('does not count a unilateral declaration', () => {
    const docs = [docOf(A, A_ID, [B_ID]), docOf(B, B_ID, [])];
    expect(computeLinkedClusters(docs)).toEqual([]);
  });

  it('transitively groups a chain into one cluster, even without every pair linking directly', () => {
    // A<->B and B<->C mutually link; A and C never declare each other, but
    // end up in the same social cluster through B.
    const docs = [docOf(A, A_ID, [B_ID]), docOf(B, B_ID, [A_ID, C_ID]), docOf(C, C_ID, [B_ID])];
    const clusters = computeLinkedClusters(docs);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.members).toEqual([A_ID, B_ID, C_ID].sort());
  });

  it('leaves an identity with no mutual link out of the result entirely', () => {
    const docs = [docOf(A, A_ID, [B_ID]), docOf(B, B_ID, [A_ID]), docOf(C, C_ID, [])];
    const clusters = computeLinkedClusters(docs);
    expect(clusters).toHaveLength(1);
    expect(clusters.flatMap((c) => c.members)).not.toContain(C_ID);
  });

  it('produces a deterministic canonical id: the lexicographically smallest member', () => {
    const docs = [docOf(A, A_ID, [B_ID]), docOf(B, B_ID, [A_ID])];
    const clusters = computeLinkedClusters(docs);
    expect(clusters[0]?.canonicalId).toBe([A_ID, B_ID].sort()[0]);
  });

  it('does not count a link whose own signature does not verify, even inside a validly signed document', () => {
    const forgedLink = createIdentityLink({ linked_id: A_ID, timestamp: 1 }, C.secretKey); // signed by C, not B
    const bDoc = createIdentityDocument(
      { id: B_ID, timestamp: 1, linked_ids: [forgedLink] },
      B.secretKey,
    );
    const docs = [docOf(A, A_ID, [B_ID]), bDoc];
    expect(computeLinkedClusters(docs)).toEqual([]);
  });

  it('does not count a link from a document whose own signature does not verify', () => {
    const tampered = { ...docOf(B, B_ID, [A_ID]), display_name: 'Mallory' };
    const docs = [docOf(A, A_ID, [B_ID]), tampered];
    expect(computeLinkedClusters(docs)).toEqual([]);
  });

  it('layer 1: ownerPrefersAggregate is true if ANY cluster member sets aggregate_linked (identity.md §7.1)', () => {
    const docs = [docOf(A, A_ID, [B_ID], false), docOf(B, B_ID, [A_ID], true)];
    expect(computeLinkedClusters(docs)[0]?.ownerPrefersAggregate).toBe(true);
  });

  it('layer 1: defaults to false when no member sets it', () => {
    const docs = [docOf(A, A_ID, [B_ID]), docOf(B, B_ID, [A_ID])];
    expect(computeLinkedClusters(docs)[0]?.ownerPrefersAggregate).toBe(false);
  });

  it('uses a caller-supplied verifier for non-native substrates', () => {
    const fake = (): boolean => true;
    const docA = {
      ...docOf(A, A_ID, []),
      id: 'at://did:plc:a',
      linked_ids: [{ linked_id: 'at://did:plc:b', timestamp: 1, signature: 'x' }],
    };
    const docB = {
      ...docOf(B, B_ID, []),
      id: 'at://did:plc:b',
      linked_ids: [{ linked_id: 'at://did:plc:a', timestamp: 1, signature: 'x' }],
    };
    expect(computeLinkedClusters([docA, docB], { verify: fake })).toHaveLength(1);
    expect(computeLinkedClusters([docA, docB], { verify: () => false })).toEqual([]);
  });
});

describe('computeIdentityMapping — layer 2 (viewer mode)', () => {
  const clusters = computeLinkedClusters([
    docOf(A, A_ID, [B_ID], false),
    docOf(B, B_ID, [A_ID], false),
    docOf(C, C_ID, [], true), // unlinked; aggregate_linked is moot with no cluster
  ]);

  it('respect-owner (default): merges only clusters whose owner preference is true', () => {
    const mapping = computeIdentityMapping(clusters, 'respect-owner');
    expect(mapping.size).toBe(0); // owner preference is false here
  });

  it('respect-owner merges when the owner preference is true', () => {
    const aggregating = computeLinkedClusters([
      docOf(A, A_ID, [B_ID], true),
      docOf(B, B_ID, [A_ID]),
    ]);
    const mapping = computeIdentityMapping(aggregating, 'respect-owner');
    expect(mapping.get(A_ID)).toBe(mapping.get(B_ID));
  });

  it('always-aggregate merges every mutually-verified cluster regardless of owner preference', () => {
    const mapping = computeIdentityMapping(clusters, 'always-aggregate');
    expect(mapping.get(A_ID)).toBe(mapping.get(B_ID));
  });

  it('always-separate merges nothing, regardless of owner preference', () => {
    const aggregating = computeLinkedClusters([
      docOf(A, A_ID, [B_ID], true),
      docOf(B, B_ID, [A_ID]),
    ]);
    expect(computeIdentityMapping(aggregating, 'always-separate').size).toBe(0);
  });

  it('every merged member maps to the same cluster canonical id, including the canonical member itself', () => {
    const mapping = computeIdentityMapping(clusters, 'always-aggregate');
    const canonical = [A_ID, B_ID].sort()[0]!;
    expect(mapping.get(A_ID)).toBe(canonical);
    expect(mapping.get(B_ID)).toBe(canonical);
  });

  it('an unlinked identity is never in the mapping, under any mode', () => {
    for (const mode of ['respect-owner', 'always-aggregate', 'always-separate'] as const) {
      expect(computeIdentityMapping(clusters, mode).has(C_ID)).toBe(false);
    }
  });
});

describe('applyIdentityMapping — remapping records and post info', () => {
  const mapping = new Map([
    [A_ID, A_ID], // canonical member maps to itself
    [B_ID, A_ID],
  ]);

  function rating(rater: string, item: string, item_type: 'post' | 'user' | 'tag'): RatingRecord {
    return {
      neusnet_version: 1,
      type: 'rating',
      rater,
      item,
      item_type,
      ratings: { true: 1 },
      timestamp: 1,
      public: true,
    };
  }

  it('remaps a rater to its cluster\u2019s canonical id', () => {
    const { records } = applyIdentityMapping({
      records: [rating(B_ID, 'post:x', 'post')],
      posts: new Map(),
      mapping,
    });
    expect(records[0]?.rater).toBe(A_ID);
  });

  it('remaps a direct rating\u2019s item when item_type is "user"', () => {
    const { records } = applyIdentityMapping({
      records: [rating(D_ID, B_ID, 'user')],
      posts: new Map(),
      mapping,
    });
    expect(records[0]?.item).toBe(A_ID);
  });

  it('does not remap a post or tag item, even if its string happens to match a mapped id', () => {
    const { records } = applyIdentityMapping({
      records: [rating(D_ID, B_ID, 'post'), rating(D_ID, B_ID, 'tag')],
      posts: new Map(),
      mapping,
    });
    expect(records[0]?.item).toBe(B_ID);
    expect(records[1]?.item).toBe(B_ID);
  });

  it('leaves a rater or item untouched when it is not in the mapping', () => {
    const { records } = applyIdentityMapping({
      records: [rating(D_ID, 'post:x', 'post')],
      posts: new Map(),
      mapping,
    });
    expect(records[0]).toEqual(rating(D_ID, 'post:x', 'post'));
  });

  it('remaps a post\u2019s author', () => {
    const posts = new Map<string, PostInfo>([['v1', { author: B_ID, tags: ['philosophy'] }]]);
    const { posts: remapped } = applyIdentityMapping({ records: [], posts, mapping });
    expect(remapped.get('v1')).toEqual({ author: A_ID, tags: ['philosophy'] });
  });

  it('leaves a post with no author, or an unmapped author, unchanged', () => {
    const posts = new Map<string, PostInfo>([
      ['v1', { tags: [] }],
      ['v2', { author: D_ID, tags: [] }],
    ]);
    const { posts: remapped } = applyIdentityMapping({ records: [], posts, mapping });
    expect(remapped.get('v1')).toEqual({ tags: [] });
    expect(remapped.get('v2')).toEqual({ author: D_ID, tags: [] });
  });

  it('preserves a stableId already present on a PostInfo', () => {
    const posts = new Map<string, PostInfo>([['v1', { author: B_ID, tags: [], stableId: 'post' }]]);
    const { posts: remapped } = applyIdentityMapping({ records: [], posts, mapping });
    expect(remapped.get('v1')?.stableId).toBe('post');
  });
});

describe('end to end: aggregation changes the trust graph (identity.md §7.1)', () => {
  it('a viewer\u2019s affinity with one linked identity carries to the cluster\u2019s other identity, only once aggregated', async () => {
    const { buildTrustGraph, derivedAffinity } = await import('../../src/ratings/trust-graph.js');

    const records: RatingRecord[] = [
      {
        neusnet_version: 1,
        type: 'rating',
        rater: 'Viewer',
        item: 'post:by-A',
        item_type: 'post',
        ratings: { true: 1 },
        timestamp: 1,
        public: true,
      },
    ];
    const posts = new Map<string, PostInfo>([['post:by-A', { author: A_ID, tags: [] }]]);

    // Without aggregation, affinity with B is unaffected by a rating of A's post.
    const separateGraph = buildTrustGraph({ records, posts });
    expect(derivedAffinity(separateGraph, 'Viewer', B_ID, 'user', { dimension: 'true' })).toBe(0);

    // With the cluster aggregated, B *is* A for trust-graph purposes.
    const clusters = computeLinkedClusters([docOf(A, A_ID, [B_ID], true), docOf(B, B_ID, [A_ID])]);
    const mapping = computeIdentityMapping(clusters, 'respect-owner');
    const { records: r2, posts: p2 } = applyIdentityMapping({ records, posts, mapping });
    const aggregatedGraph = buildTrustGraph({ records: r2, posts: p2 });
    const canonical = mapping.get(A_ID)!;
    expect(
      derivedAffinity(aggregatedGraph, 'Viewer', canonical, 'user', { dimension: 'true' }),
    ).toBe(1);
  });
});

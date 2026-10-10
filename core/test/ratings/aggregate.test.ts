import { describe, expect, it } from 'vitest';
import { buildVersionHistory, type VersionHistory } from '../../src/metadata/version-history.js';
import type { PostMetadata } from '../../src/metadata/post.js';
import { aggregatePostRatings, buildTrustGraphFromPosts } from '../../src/ratings/aggregate.js';
import type { RatingRecord } from '../../src/ratings/rating-record.js';
import {
  derivedAffinity,
  effectiveAffinity,
  effectivePostScore,
} from '../../src/ratings/trust-graph.js';
import { A_ID, B, B_ID, I, POST_ID, known, version } from '../helpers/post-fixtures.js';

function rating(
  rater: string,
  item: string,
  ratings: Record<string, number>,
  timestamp: number,
): RatingRecord {
  return {
    neusnet_version: 1,
    type: 'rating',
    rater,
    item,
    item_type: 'post',
    ratings,
    timestamp,
    public: true,
  };
}

interface World {
  knownFiles: Map<string, PostMetadata>;
  history: VersionHistory;
}

/** Build the history of `POST_ID` (or another id) from the given files. */
function worldOf(
  files: Record<string, PostMetadata>,
  currentVersionId: string,
  id: string = POST_ID,
): World {
  const knownFiles = known(files);
  return { knownFiles, history: buildVersionHistory({ id, currentVersionId, known: knownFiles }) };
}

// A post with three versions where v3 skips v2 (so v2 is memory-holed):
//   canonical = [v3, v1], memoryHoled = [v2]
function threeVersionWorld(): World {
  return worldOf(
    {
      v1: version({ timestamp: 1 }),
      v2: version({ timestamp: 2, previous: 'v1' }),
      v3: version({ timestamp: 3, previous: 'v1' }),
    },
    'v3',
  );
}

describe('aggregatePostRatings — which versions count (ratings.md §2.5 steps 1–4)', () => {
  it('includes canonical versions, newest first, then memory-holed versions', () => {
    const { knownFiles, history } = threeVersionWorld();
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect(result.includedVersionIds).toEqual(['v3', 'v1', 'v2']);
  });

  it('counts ratings of a memory-holed version: an author cannot erase the response to their own words', () => {
    const { knownFiles, history } = threeVersionWorld();
    const records = [rating('R1', 'v2', { true: -1 }, 10)];
    const result = aggregatePostRatings({ history, known: knownFiles, records });
    expect(result.ratings).toEqual(records);
  });

  it('ignores ratings of versions that are not part of this post', () => {
    const { knownFiles, history } = threeVersionWorld();
    const records = [rating('R1', 'some-other-post', { true: 1 }, 10)];
    expect(aggregatePostRatings({ history, known: knownFiles, records }).ratings).toEqual([]);
  });

  it('ignores rating records that are not about posts, even if their item string matches a version id', () => {
    const { knownFiles, history } = threeVersionWorld();
    const userRating: RatingRecord = { ...rating('R1', 'v1', { true: 1 }, 10), item_type: 'user' };
    const result = aggregatePostRatings({ history, known: knownFiles, records: [userRating] });
    expect(result.ratings).toEqual([]);
  });

  it('counts a third-party introduction whose content identity is confirmed', () => {
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: [{ uri: 'ipfs://same-content' }] }),
        intro: version({ timestamp: 5, signer: I, content: [{ uri: 'ipfs://same-content' }] }),
      },
      'v1',
    );
    const records = [rating('R1', 'intro', { true: 1 }, 10)];
    const result = aggregatePostRatings({ history, known: knownFiles, records });
    expect(result.includedVersionIds).toEqual(['v1', 'intro']);
    expect(result.ratings).toEqual(records);
  });

  it('excludes a third-party introduction whose content cannot be confirmed as the same', () => {
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: [{ uri: 'ipfs://real' }] }),
        intro: version({ timestamp: 5, signer: I, content: [{ uri: 'ipfs://different' }] }),
      },
      'v1',
    );
    const records = [rating('R1', 'intro', { true: 1 }, 10)];
    const result = aggregatePostRatings({ history, known: knownFiles, records });
    expect(result.includedVersionIds).toEqual(['v1']);
    expect(result.ratings).toEqual([]);
  });

  it('does not confirm identity from an equal mutable URI alone', () => {
    const https = [{ uri: 'https://example.com/post' }];
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: https }),
        intro: version({ timestamp: 5, signer: I, content: https }),
      },
      'v1',
    );
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect(result.includedVersionIds).toEqual(['v1']);
  });

  it('confirms identity through a shared hash even when the mutable URIs differ', () => {
    const hash = 'sha256:' + 'ab'.repeat(32);
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: [{ uri: 'https://author.example/p', hash }] }),
        intro: version({
          timestamp: 5,
          signer: I,
          content: [{ uri: 'https://mirror.example/p', hash }],
        }),
      },
      'v1',
    );
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect(result.includedVersionIds).toEqual(['v1', 'intro']);
  });

  it('treats an unsigned copy naming the canonical author like an introduction', () => {
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: [{ uri: 'ipfs://same' }] }),
        copy: version({ timestamp: 5, signer: 'none', content: [{ uri: 'ipfs://same' }] }),
      },
      'v1',
    );
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect(result.includedVersionIds).toEqual(['v1', 'copy']);
  });

  it('confirms an introduction against an older canonical version, not just the latest', () => {
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: [{ uri: 'ipfs://original' }] }),
        v2: version({ timestamp: 2, previous: 'v1', content: [{ uri: 'ipfs://edited' }] }),
        introOfOriginal: version({
          timestamp: 5,
          signer: I,
          content: [{ uri: 'ipfs://original' }],
        }),
      },
      'v2',
    );
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect(result.includedVersionIds).toContain('introOfOriginal');
  });

  it('excludes a false claimant\u2019s ratings, even when its content matches', () => {
    const same = [{ uri: 'ipfs://same-content' }];
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: same }),
        plagiarist: version({ timestamp: 2, author: B_ID, signer: B, content: same }),
      },
      'v1',
    );
    const records = [rating('R1', 'plagiarist', { true: 1 }, 10)];
    const result = aggregatePostRatings({ history, known: knownFiles, records });
    expect(result.includedVersionIds).toEqual(['v1']);
    expect(result.ratings).toEqual([]);
  });

  it('does not let one introduction vouch for another: only author-signed versions anchor identity', () => {
    // intro1 is confirmed (it shares 'ipfs://real' with the author's v1) but
    // also carries an extra mirror. intro2 matches only that extra mirror —
    // i.e. it matches intro1 but nothing the author signed — so it must not
    // be confirmed by riding on intro1.
    const { knownFiles, history } = worldOf(
      {
        v1: version({ timestamp: 1, content: [{ uri: 'ipfs://real' }] }),
        intro1: version({
          timestamp: 5,
          signer: I,
          content: [{ uri: 'ipfs://real' }, { uri: 'ipfs://extra' }],
        }),
        intro2: version({ timestamp: 6, signer: I, content: [{ uri: 'ipfs://extra' }] }),
      },
      'v1',
    );
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect(result.includedVersionIds).toEqual(['v1', 'intro1']);
  });
});

describe('aggregatePostRatings — deduplicating by rater (ratings.md §2.5 step 5)', () => {
  it('keeps only a rater\u2019s most recent rating across versions', () => {
    const { knownFiles, history } = threeVersionWorld();
    const early = rating('R1', 'v1', { true: 1 }, 10);
    const late = rating('R1', 'v3', { true: -1 }, 20);
    const result = aggregatePostRatings({ history, known: knownFiles, records: [early, late] });
    expect(result.ratings).toEqual([late]);
    expect(result.superseded).toEqual([early]);
  });

  it('is independent of the order the records are supplied in', () => {
    const { knownFiles, history } = threeVersionWorld();
    const early = rating('R1', 'v1', { true: 1 }, 10);
    const late = rating('R1', 'v3', { true: -1 }, 20);
    const result = aggregatePostRatings({ history, known: knownFiles, records: [late, early] });
    expect(result.ratings).toEqual([late]);
  });

  it('stops an author inflating their post by self-rating every near-identical version', () => {
    const { knownFiles, history } = threeVersionWorld();
    const selfRatings = [
      rating(A_ID, 'v1', { true: 1 }, 1),
      rating(A_ID, 'v2', { true: 1 }, 2),
      rating(A_ID, 'v3', { true: 1 }, 3),
    ];
    const result = aggregatePostRatings({ history, known: knownFiles, records: selfRatings });
    expect(result.ratings).toHaveLength(1);
    expect(result.superseded).toHaveLength(2);
  });

  it('counts distinct raters separately', () => {
    const { knownFiles, history } = threeVersionWorld();
    const records = [
      rating('R1', 'v1', { true: 1 }, 10),
      rating('R2', 'v3', { true: 1 }, 10),
      rating('R3', 'v2', { true: -1 }, 10),
    ];
    const result = aggregatePostRatings({ history, known: knownFiles, records });
    expect(result.ratings).toHaveLength(3);
    expect(result.superseded).toEqual([]);
  });

  it('a later rating replaces the whole earlier record, not dimension by dimension', () => {
    const { knownFiles, history } = threeVersionWorld();
    const early = rating('R1', 'v1', { true: 1, good: 1 }, 10);
    const late = rating('R1', 'v3', { important: 1 }, 20);
    const result = aggregatePostRatings({ history, known: knownFiles, records: [early, late] });
    expect(result.ratings).toEqual([late]);
  });

  it('treats a rater\u2019s newest record being a retraction as having withdrawn their rating', () => {
    const { knownFiles, history } = threeVersionWorld();
    const rated = rating('R1', 'v1', { true: 1 }, 10);
    const retracted = rating('R1', 'v3', {}, 20);
    const result = aggregatePostRatings({
      history,
      known: knownFiles,
      records: [rated, retracted],
    });
    // The older rating must not be resurrected by a retraction of a
    // *different* version.
    expect(result.ratings).toEqual([]);
    expect(result.superseded).toEqual([rated]);
  });

  it('breaks timestamp ties deterministically, preferring the version earlier in the included order', () => {
    const { knownFiles, history } = threeVersionWorld(); // order: v3, v1, v2
    const onV1 = rating('R1', 'v1', { true: 1 }, 10);
    const onV3 = rating('R1', 'v3', { true: -1 }, 10);
    const forward = aggregatePostRatings({ history, known: knownFiles, records: [onV1, onV3] });
    const backward = aggregatePostRatings({ history, known: knownFiles, records: [onV3, onV1] });
    expect(forward.ratings).toEqual([onV3]);
    expect(backward.ratings).toEqual([onV3]);
  });

  it('treats repeated ratings of the same version as updates', () => {
    const { knownFiles, history } = threeVersionWorld();
    const first = rating('R1', 'v1', { true: 1 }, 10);
    const second = rating('R1', 'v1', { true: -1 }, 20);
    const result = aggregatePostRatings({ history, known: knownFiles, records: [first, second] });
    expect(result.ratings).toEqual([second]);
    expect(result.superseded).toEqual([first]);
  });

  it('orders the aggregate by timestamp, then rater', () => {
    const { knownFiles, history } = threeVersionWorld();
    const records = [
      rating('R2', 'v1', { true: 1 }, 10),
      rating('R1', 'v1', { true: 1 }, 10),
      rating('R3', 'v1', { true: 1 }, 5),
    ];
    const result = aggregatePostRatings({ history, known: knownFiles, records });
    expect(result.ratings.map((r) => r.rater)).toEqual(['R3', 'R1', 'R2']);
  });
});

describe('aggregatePostRatings — per-version breakdown (ratings.md §2.5, closing paragraph)', () => {
  it('lists every included version, including unrated ones', () => {
    const { knownFiles, history } = threeVersionWorld();
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect([...result.byVersion.keys()]).toEqual(['v3', 'v1', 'v2']);
    expect(result.byVersion.get('v1')).toEqual([]);
  });

  it('shows who rated which version, before cross-version deduplication', () => {
    const { knownFiles, history } = threeVersionWorld();
    const onV1 = rating('R1', 'v1', { true: 1 }, 10);
    const onV3 = rating('R1', 'v3', { true: -1 }, 20);
    const result = aggregatePostRatings({ history, known: knownFiles, records: [onV1, onV3] });
    expect(result.byVersion.get('v1')).toEqual([onV1]);
    expect(result.byVersion.get('v3')).toEqual([onV3]);
    // ...even though only the later one counts toward the aggregate.
    expect(result.ratings).toEqual([onV3]);
  });
});

describe('aggregatePostRatings — a post with no canonical history (bridged)', () => {
  const BRIDGED_ID = 'at://did:plc:abc123/app.bsky.feed.post/xyz';
  const AUTHOR = 'at://did:plc:abc123';

  it('counts the current version, which anchors the post', () => {
    const { knownFiles, history } = worldOf(
      { intro: version({ id: BRIDGED_ID, author: AUTHOR, signer: I, timestamp: 1 }) },
      'intro',
      BRIDGED_ID,
    );
    const records = [rating('R1', 'intro', { true: 1 }, 10)];
    const result = aggregatePostRatings({ history, known: knownFiles, records });
    expect(result.includedVersionIds).toEqual(['intro']);
    expect(result.ratings).toEqual(records);
  });

  it('merges a second introduction of the same content, confirmed by a shared hash', () => {
    const hash = 'sha256:' + 'cd'.repeat(32);
    const content = [{ uri: 'https://bsky.app/profile/abc123/post/xyz', hash }];
    const { knownFiles, history } = worldOf(
      {
        intro1: version({ id: BRIDGED_ID, author: AUTHOR, signer: I, timestamp: 1, content }),
        intro2: version({ id: BRIDGED_ID, author: AUTHOR, signer: B, timestamp: 2, content }),
      },
      'intro1',
      BRIDGED_ID,
    );
    const result = aggregatePostRatings({ history, known: knownFiles, records: [] });
    expect(result.includedVersionIds).toEqual(['intro1', 'intro2']);
  });

  it('still counts ratings of the current version when its metadata is not yet known', () => {
    const { history } = worldOf({}, 'not-fetched', BRIDGED_ID);
    const records = [rating('R1', 'not-fetched', { true: 1 }, 10)];
    const result = aggregatePostRatings({ history, known: new Map(), records });
    expect(result.ratings).toEqual(records);
  });
});

describe('buildTrustGraphFromPosts — the whole stack together', () => {
  const opts = { dimension: 'true', decay: 0.5 };

  function twoVersionWorld(): {
    files: Record<string, PostMetadata>;
    currentVersions: Map<string, string>;
  } {
    return {
      files: {
        v1: version({ timestamp: 1 }),
        v2: version({ timestamp: 2, previous: 'v1' }),
      },
      currentVersions: new Map([[POST_ID, 'v2']]),
    };
  }

  it('counts a rater once toward the author\u2019s affinity, however many versions they rated', () => {
    const { files, currentVersions } = twoVersionWorld();
    const records = [rating('R', 'v1', { true: 1 }, 10), rating('R', 'v2', { true: -1 }, 20)];
    const graph = buildTrustGraphFromPosts({ known: known(files), currentVersions, records });
    // Latest opinion only: -1. Without cross-version deduplication this
    // would be mean(1, -1) = 0, wrongly erasing R's change of mind.
    expect(derivedAffinity(graph, 'R', A_ID, 'user', opts)).toBe(-1);
  });

  it('leaves ratings of posts with no resolved current version as separate posts', () => {
    const { files } = twoVersionWorld();
    const records = [rating('R', 'v1', { true: 1 }, 10), rating('R', 'v2', { true: -1 }, 20)];
    const graph = buildTrustGraphFromPosts({
      known: known(files),
      currentVersions: new Map(),
      records,
    });
    expect(derivedAffinity(graph, 'R', A_ID, 'user', opts)).toBe(0);
  });

  it('flows through to effective scores: a viewer inherits the rater\u2019s latest opinion of the author', () => {
    const { files, currentVersions } = twoVersionWorld();
    const records: RatingRecord[] = [
      // U trusts R directly...
      {
        neusnet_version: 1,
        type: 'rating',
        rater: 'U',
        item: 'R',
        item_type: 'user',
        ratings: { true: 1 },
        timestamp: 1,
        public: true,
      },
      // ...and R rated both versions of A's post, changing their mind.
      rating('R', 'v1', { true: 1 }, 10),
      rating('R', 'v2', { true: -1 }, 20),
    ];
    const graph = buildTrustGraphFromPosts({ known: known(files), currentVersions, records });
    // import_weight(R) = 1 * 0.5; composite_affinity(R, A) = -1 (latest only)
    expect(effectiveAffinity(graph, 'U', A_ID, 'user', opts)).toBeCloseTo(-0.5, 10);
    expect(effectivePostScore(graph, 'U', 'v2', opts)).toBeCloseTo(-0.5, 10);
  });

  it('keeps a rival author\u2019s ratings attributed to the rival, not the true author', () => {
    const files = {
      v1: version({ timestamp: 1, content: [{ uri: 'ipfs://same' }] }),
      plagiarist: version({
        timestamp: 2,
        author: B_ID,
        signer: B,
        content: [{ uri: 'ipfs://same' }],
      }),
    };
    const records = [rating('R', 'plagiarist', { true: 1 }, 10)];
    const graph = buildTrustGraphFromPosts({
      known: known(files),
      currentVersions: new Map([[POST_ID, 'v1']]),
      records,
    });
    expect(derivedAffinity(graph, 'R', B_ID, 'user', opts)).toBe(1);
    expect(derivedAffinity(graph, 'R', A_ID, 'user', opts)).toBe(0);
  });

  it('attributes nothing to an author when a version names none', () => {
    const noAuthor: PostMetadata = {
      neusnet_version: 1,
      type: 'post',
      id: POST_ID,
      tags: ['philosophy'],
      content: [{ uri: 'ipfs://x' }],
      timestamp: 1,
    };
    const records = [rating('R', 'v1', { true: 1 }, 10)];
    const graph = buildTrustGraphFromPosts({
      known: known({ v1: noAuthor }),
      currentVersions: new Map(),
      records,
    });
    // The tag is still credited; there is simply no author to credit.
    expect(derivedAffinity(graph, 'R', 'philosophy', 'tag', opts)).toBe(1);
    expect(derivedAffinity(graph, 'R', A_ID, 'user', opts)).toBe(0);
  });

  it('records each version\u2019s tags for scoring', () => {
    const withTags: PostMetadata = { ...version({ timestamp: 1 }), tags: ['philosophy'] };
    const records = [rating('R', 'v1', { true: 1 }, 10)];
    const graph = buildTrustGraphFromPosts({
      known: known({ v1: withTags }),
      currentVersions: new Map(),
      records,
    });
    expect(derivedAffinity(graph, 'R', 'philosophy', 'tag', opts)).toBe(1);
  });

  it('passes a custom author-signature verifier through to history construction', () => {
    const DID = 'did:example:alice';
    const mk = (timestamp: number, previous?: string): PostMetadata => ({
      neusnet_version: 1,
      type: 'post',
      id: POST_ID,
      author: DID,
      tags: [],
      content: [{ uri: `ipfs://c${timestamp}` }],
      timestamp,
      ...(previous !== undefined ? { previous } : {}),
      signature: 'substrate-ok',
    });
    const files = { v1: mk(1), v2: mk(2, 'v1') };
    const records = [rating('R', 'v1', { true: 1 }, 10), rating('R', 'v2', { true: -1 }, 20)];
    const graph = buildTrustGraphFromPosts({
      known: known(files),
      currentVersions: new Map([[POST_ID, 'v2']]),
      records,
      isAuthorSigned: (post) => post.signature === 'substrate-ok',
    });
    // Both versions are canonical under the custom verifier, so R counts once.
    expect(derivedAffinity(graph, 'R', DID, 'user', opts)).toBe(-1);
  });
});

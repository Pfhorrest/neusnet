import { describe, expect, it } from 'vitest';
import type { RatingRecord } from '../../src/ratings/rating-record.js';
import {
  buildTrustGraph,
  compositeAffinity,
  confidence,
  directAffinity,
  derivedAffinity,
  effectiveAffinity,
  effectivePostScore,
  meetsVisibilityThreshold,
  type PostInfo,
} from '../../src/ratings/trust-graph.js';

function rating(
  rater: string,
  item: string,
  item_type: 'post' | 'user' | 'tag',
  ratings: Record<string, number>,
  timestamp = 1,
): RatingRecord {
  return {
    neusnet_version: 1,
    type: 'rating',
    rater,
    item,
    item_type,
    ratings,
    timestamp,
    public: true,
  };
}

const DIM = 'true';

// ============================================================================
// Appendix B's worked example, built as literal test fixtures.
// "Alice, Bob, Carol, and Dave are users. decay = 0.5 throughout. All
// calculations are on the True dimension."
//
// Setup:
// - Alice rated Bob's post X: True +1
// - Alice rated Bob's post Y: True −0.5
// - Bob rated Carol's post Z: True +0.8
// - Carol rated Dave's post W: True −1.0
// - No other ratings exist.
// ============================================================================

const POSTS = new Map<string, PostInfo>([
  ['post:X', { author: 'Bob', tags: [] }],
  ['post:Y', { author: 'Bob', tags: [] }],
  ['post:Z', { author: 'Carol', tags: [] }],
  ['post:W', { author: 'Dave', tags: [] }],
]);

function appendixBGraph(): ReturnType<typeof buildTrustGraph> {
  return buildTrustGraph({
    records: [
      rating('Alice', 'post:X', 'post', { [DIM]: 1 }),
      rating('Alice', 'post:Y', 'post', { [DIM]: -0.5 }),
      rating('Bob', 'post:Z', 'post', { [DIM]: 0.8 }),
      rating('Carol', 'post:W', 'post', { [DIM]: -1.0 }),
    ],
    posts: POSTS,
  });
}

describe('Appendix B worked example — base case', () => {
  const graph = appendixBGraph();
  const opts = { dimension: DIM, decay: 0.5 };

  it('Step 1: derived_affinity(Alice, Bob) = mean(+1, -0.5) = +0.25', () => {
    expect(derivedAffinity(graph, 'Alice', 'Bob', 'user', opts)).toBeCloseTo(0.25, 10);
  });

  it('Step 1: composite_affinity(Alice, Bob) = +0.25 (no direct rating exists)', () => {
    expect(compositeAffinity(graph, 'Alice', 'Bob', 'user', opts)).toBeCloseTo(0.25, 10);
  });

  it('Step 3: composite_affinity(Bob, Carol) = +0.8', () => {
    expect(compositeAffinity(graph, 'Bob', 'Carol', 'user', opts)).toBeCloseTo(0.8, 10);
  });

  it('Step 5: effective_affinity(Alice, Carol) = +0.10 (via Bob, hop 1)', () => {
    expect(effectiveAffinity(graph, 'Alice', 'Carol', 'user', opts)).toBeCloseTo(0.1, 10);
  });

  it('Step 5: effective_score(Alice, Z) = +0.10 (Z has no tags, Alice never rated Z directly, so this equals effective_affinity with its author Carol exactly)', () => {
    expect(effectivePostScore(graph, 'Alice', 'post:Z', opts)).toBeCloseTo(0.1, 10);
  });

  it('Step 6: effective_affinity(Alice, Dave) = -0.05 (via Bob -> Carol, hop 2)', () => {
    expect(effectiveAffinity(graph, 'Alice', 'Dave', 'user', opts)).toBeCloseTo(-0.05, 10);
  });

  it('Step 6: effective_score(Alice, W) = -0.05', () => {
    expect(effectivePostScore(graph, 'Alice', 'post:W', opts)).toBeCloseTo(-0.05, 10);
  });

  it('W falls below the default (0) visibility threshold; Z does not', () => {
    expect(meetsVisibilityThreshold(effectivePostScore(graph, 'Alice', 'post:W', opts), 0)).toBe(
      false,
    );
    expect(meetsVisibilityThreshold(effectivePostScore(graph, 'Alice', 'post:Z', opts), 0)).toBe(
      true,
    );
  });
});

describe('Appendix B worked example — "enemy-of-my-enemy" sign-inverted variant', () => {
  // "Suppose instead Alice had rated Bob's posts negatively: mean −0.25."
  const graph = buildTrustGraph({
    records: [
      // Chosen so mean = -0.25, same magnitude/shape as the base case but
      // negative, as the appendix describes narratively without giving
      // concrete per-post replacement values.
      rating('Alice', 'post:X', 'post', { [DIM]: -0.25 }),
      rating('Alice', 'post:Y', 'post', { [DIM]: -0.25 }),
      rating('Bob', 'post:Z', 'post', { [DIM]: 0.8 }),
      rating('Carol', 'post:W', 'post', { [DIM]: -1.0 }),
    ],
    posts: POSTS,
  });
  const opts = { dimension: DIM, decay: 0.5 };

  it('composite_affinity(Alice, Bob) = -0.25', () => {
    expect(compositeAffinity(graph, 'Alice', 'Bob', 'user', opts)).toBeCloseTo(-0.25, 10);
  });

  it("Bob's endorsement of Z becomes a negative signal for Alice: effective_score(Alice, Z) = -0.10", () => {
    expect(effectivePostScore(graph, 'Alice', 'post:Z', opts)).toBeCloseTo(-0.1, 10);
  });

  it("Carol's condemnation of W becomes a mild positive signal for Alice: effective_score(Alice, W) = +0.05", () => {
    expect(effectivePostScore(graph, 'Alice', 'post:W', opts)).toBeCloseTo(0.05, 10);
  });
});

// ============================================================================
// Component-level tests, independent of the worked example.
// ============================================================================

describe('derivedAffinity', () => {
  it('is 0 when U has rated nothing relating to N (§4.4: unknown nodes)', () => {
    const graph = buildTrustGraph({ records: [], posts: new Map() });
    expect(derivedAffinity(graph, 'Alice', 'Bob', 'user', { dimension: DIM })).toBe(0);
  });

  it('excludes a post rating when the referenced post has no entry in the posts map', () => {
    // A rating record can legitimately arrive before (or without) its
    // target post's metadata being known to this graph (e.g. not yet
    // fetched) — such ratings simply can't be attributed to anyone yet.
    const graph = buildTrustGraph({
      records: [rating('U', 'post:unknown', 'post', { true: 1 })],
      posts: new Map(), // post:unknown has no entry
    });
    expect(derivedAffinity(graph, 'U', 'N', 'user', { dimension: 'true' })).toBe(0);
  });

  it('only includes posts where U explicitly expressed an opinion on this dimension', () => {
    // Confidence is tracked per-dimension (§4.3), which only makes sense if
    // a post rated on a different dimension doesn't silently count as an
    // implicit-zero data point for this one — otherwise every dimension's
    // confidence would be identical for any (U, N) pair. See PROGRESS.md
    // for the full reasoning; this test pins the chosen interpretation.
    const graph = buildTrustGraph({
      records: [
        rating('U', 'post:a', 'post', { true: 1 }),
        rating('U', 'post:b', 'post', { good: 1 }), // no 'true' entry at all
      ],
      posts: new Map([
        ['post:a', { author: 'N', tags: [] }],
        ['post:b', { author: 'N', tags: [] }],
      ]),
    });
    // If post:b counted as an implicit 0 for 'true', the mean would be 0.5;
    // since it's excluded entirely, the mean is just the one explicit rating.
    expect(derivedAffinity(graph, 'U', 'N', 'user', { dimension: 'true' })).toBe(1);
  });

  it('averages across multiple qualifying posts', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'post:a', 'post', { true: 1 }),
        rating('U', 'post:b', 'post', { true: -1 }),
        rating('U', 'post:c', 'post', { true: 0.5 }),
      ],
      posts: new Map([
        ['post:a', { author: 'N', tags: [] }],
        ['post:b', { author: 'N', tags: [] }],
        ['post:c', { author: 'N', tags: [] }],
      ]),
    });
    expect(derivedAffinity(graph, 'U', 'N', 'user', { dimension: 'true' })).toBeCloseTo(1 / 6, 10);
  });

  it('attributes a rating to every tag on a post, at full (undiluted) value (§3.1)', () => {
    const graph = buildTrustGraph({
      records: [rating('U', 'post:a', 'post', { true: 1 })],
      posts: new Map([['post:a', { tags: ['funny', 'cat', 'cute'] }]]),
    });
    for (const tag of ['funny', 'cat', 'cute']) {
      expect(derivedAffinity(graph, 'U', tag, 'tag', { dimension: 'true' })).toBe(1);
    }
  });

  it('distinguishes user vs. tag role for the same node string (item_type disambiguation)', () => {
    // A pathological but spec-anticipated case (ratings.md §2.1: "the same
    // string could in principle identify different things").
    const graph = buildTrustGraph({
      records: [rating('U', 'post:a', 'post', { true: 1 })],
      posts: new Map([['post:a', { author: 'ambiguous', tags: ['something-else'] }]]),
    });
    expect(derivedAffinity(graph, 'U', 'ambiguous', 'user', { dimension: 'true' })).toBe(1);
    expect(derivedAffinity(graph, 'U', 'ambiguous', 'tag', { dimension: 'true' })).toBe(0);
  });
});

describe('directAffinity', () => {
  it('is 0 when no direct rating exists', () => {
    const graph = buildTrustGraph({ records: [], posts: new Map() });
    expect(directAffinity(graph, 'U', 'N', 'user', { dimension: DIM })).toBe(0);
  });

  it('reflects a direct rating of a user', () => {
    const graph = buildTrustGraph({
      records: [rating('U', 'Bob', 'user', { true: 0.6 })],
      posts: new Map(),
    });
    expect(directAffinity(graph, 'U', 'Bob', 'user', { dimension: 'true' })).toBe(0.6);
  });

  it('reflects a direct rating of a tag, independently of a same-named user rating', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'philosophy', 'user', { true: 0.9 }),
        rating('U', 'philosophy', 'tag', { true: -0.2 }),
      ],
      posts: new Map(),
    });
    expect(directAffinity(graph, 'U', 'philosophy', 'user', { dimension: 'true' })).toBe(0.9);
    expect(directAffinity(graph, 'U', 'philosophy', 'tag', { dimension: 'true' })).toBe(-0.2);
  });

  it('uses the most recent record when a direct rating has been superseded', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'Bob', 'user', { true: 0.5 }, 100),
        rating('U', 'Bob', 'user', { true: -0.5 }, 200),
      ],
      posts: new Map(),
    });
    expect(directAffinity(graph, 'U', 'Bob', 'user', { dimension: 'true' })).toBe(-0.5);
  });

  it('treats a retraction (empty ratings map) as no rating', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'Bob', 'user', { true: 0.5 }, 100),
        rating('U', 'Bob', 'user', {}, 200),
      ],
      posts: new Map(),
    });
    expect(directAffinity(graph, 'U', 'Bob', 'user', { dimension: 'true' })).toBe(0);
  });
});

describe('compositeAffinity', () => {
  it('uses the 2:1 derived:direct default when both are present (§4.1)', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'post:a', 'post', { true: 1 }), // derived = 1
        rating('U', 'Bob', 'user', { true: -1 }), // direct = -1
      ],
      posts: new Map([['post:a', { author: 'Bob', tags: [] }]]),
    });
    // (2*1 + 1*(-1)) / 3 = 1/3
    expect(compositeAffinity(graph, 'U', 'Bob', 'user', { dimension: 'true' })).toBeCloseTo(
      1 / 3,
      10,
    );
  });

  it('uses derived alone, unweighted, when no direct rating exists ("no phantom zero")', () => {
    const graph = buildTrustGraph({
      records: [rating('U', 'post:a', 'post', { true: 0.4 })],
      posts: new Map([['post:a', { author: 'Bob', tags: [] }]]),
    });
    expect(compositeAffinity(graph, 'U', 'Bob', 'user', { dimension: 'true' })).toBe(0.4);
  });

  it('uses direct alone, unweighted, when no derived signal exists', () => {
    const graph = buildTrustGraph({
      records: [rating('U', 'Bob', 'user', { true: -0.7 })],
      posts: new Map(),
    });
    expect(compositeAffinity(graph, 'U', 'Bob', 'user', { dimension: 'true' })).toBe(-0.7);
  });

  it('is 0 when neither signal exists', () => {
    const graph = buildTrustGraph({ records: [], posts: new Map() });
    expect(compositeAffinity(graph, 'U', 'Bob', 'user', { dimension: 'true' })).toBe(0);
  });

  it('respects a custom derived:direct weight ratio', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'post:a', 'post', { true: 1 }),
        rating('U', 'Bob', 'user', { true: -1 }),
      ],
      posts: new Map([['post:a', { author: 'Bob', tags: [] }]]),
    });
    // 1:1 ratio instead of the 2:1 default
    expect(
      compositeAffinity(graph, 'U', 'Bob', 'user', {
        dimension: 'true',
        derivedWeight: 1,
        directWeight: 1,
      }),
    ).toBe(0);
  });
});

describe('confidence', () => {
  it('counts the number of posts contributing to derived affinity, per dimension', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'post:a', 'post', { true: 1 }),
        rating('U', 'post:b', 'post', { true: 1, good: 1 }),
        rating('U', 'post:c', 'post', { good: 1 }), // no 'true' entry
      ],
      posts: new Map([
        ['post:a', { author: 'N', tags: [] }],
        ['post:b', { author: 'N', tags: [] }],
        ['post:c', { author: 'N', tags: [] }],
      ]),
    });
    expect(confidence(graph, 'U', 'N', 'user', { dimension: 'true' })).toBe(2);
    expect(confidence(graph, 'U', 'N', 'user', { dimension: 'good' })).toBe(2);
  });

  it('is 0 for an unrated node', () => {
    const graph = buildTrustGraph({ records: [], posts: new Map() });
    expect(confidence(graph, 'U', 'N', 'user', { dimension: 'true' })).toBe(0);
  });
});

describe('effectiveAffinity — traversal robustness', () => {
  it("ignores a relay peer's post rating that references an unknown post, without breaking that peer's other contributions", () => {
    const graph = buildTrustGraph({
      records: [
        rating('Alice', 'Bob', 'user', { true: 1 }),
        rating('Bob', 'post:unknown', 'post', { true: 1 }), // posts map has no entry for this
        rating('Bob', 'Carol', 'user', { true: 0.5 }), // should still come through
      ],
      posts: new Map(),
    });
    expect(
      effectiveAffinity(graph, 'Alice', 'Carol', 'user', { dimension: 'true', decay: 0.5 }),
    ).toBeCloseTo(1 * 0.5 * 0.5, 10);
  });

  it("ignores a relay peer's post rating that doesn't carry the dimension being computed", () => {
    const graph = buildTrustGraph({
      records: [
        rating('Alice', 'Bob', 'user', { true: 1 }),
        rating('Bob', 'post:z', 'post', { good: 1 }), // no 'true' entry
        rating('Bob', 'Carol', 'user', { true: 0.5 }),
      ],
      posts: new Map([['post:z', { author: 'SomeoneElse', tags: [] }]]),
    });
    expect(
      effectiveAffinity(graph, 'Alice', 'Carol', 'user', { dimension: 'true', decay: 0.5 }),
    ).toBeCloseTo(1 * 0.5 * 0.5, 10);
  });
});

describe('effectiveAffinity', () => {
  it('cold start: 0 for every node when U has rated nothing (§4.4)', () => {
    const graph = buildTrustGraph({
      records: [rating('Bob', 'post:z', 'post', { true: 1 })],
      posts: new Map([['post:z', { author: 'Carol', tags: [] }]]),
    });
    expect(effectiveAffinity(graph, 'U', 'Carol', 'user', { dimension: 'true' })).toBe(0);
  });

  it('equals composite affinity at hop 0 when there is nothing beyond direct relations', () => {
    const graph = buildTrustGraph({
      records: [rating('Alice', 'Bob', 'user', { true: 0.5 })],
      posts: new Map(),
    });
    expect(
      effectiveAffinity(graph, 'Alice', 'Bob', 'user', { dimension: 'true', decay: 0.5 }),
    ).toBeCloseTo(0.5, 10);
  });

  it('a node visited via a shorter path is not re-processed via a longer one', () => {
    // Alice -> Bob (hop 1) -> Carol (would-be hop 2), AND Alice -> Carol
    // directly (hop 1). Carol's shortest path is hop 1, so Bob's hop-1
    // encounter with her (a longer, hop-2-equivalent path) must be
    // discarded entirely — not just excluded from further relay, but
    // excluded from her accumulator too (§4.5 step 3).
    const graph = buildTrustGraph({
      records: [
        rating('Alice', 'Bob', 'user', { true: 1 }),
        rating('Alice', 'Carol', 'user', { true: 0.4 }), // direct hop-1 relation
        rating('Bob', 'Carol', 'user', { true: 1 }), // would also reach Carol via Bob, at hop 2 — must be discarded
        rating('Carol', 'Dave', 'user', { true: 1 }),
      ],
      posts: new Map(),
    });
    const opts = { dimension: 'true', decay: 0.5 };

    // Carol's own effective affinity must stay at exactly her hop-0/direct
    // value (0.4) — NOT inflated by Bob's redundant longer-path contribution
    // (which would otherwise add 1*0.5*1 = 0.5, wrongly yielding 0.9).
    expect(effectiveAffinity(graph, 'Alice', 'Carol', 'user', opts)).toBeCloseTo(0.4, 10);

    // Dave is reached only through Carol, who is herself hop 1 (not hop 2
    // via Bob), so her import weight is her own hop-1 weight: 0.4*0.5=0.2.
    // Dave's effective affinity = 0.2 * composite_affinity(Carol,Dave)[1] = 0.2.
    expect(effectiveAffinity(graph, 'Alice', 'Dave', 'user', opts)).toBeCloseTo(0.2, 10);
  });

  it('decay = 0 eliminates all indirect (hop >= 1) contributions beyond hop 0 itself', () => {
    const graph = appendixBGraph();
    const opts = { dimension: DIM, decay: 0 };
    // Bob is still a hop-0/direct node for Alice (composite affinity is
    // unaffected by decay), but Carol (reached only via Bob) gets nothing.
    expect(effectiveAffinity(graph, 'Alice', 'Bob', 'user', opts)).toBeCloseTo(0.25, 10);
    expect(effectiveAffinity(graph, 'Alice', 'Carol', 'user', opts)).toBe(0);
  });

  it('decay = 1 applies no distance attenuation', () => {
    const graph = appendixBGraph();
    const opts = { dimension: DIM, decay: 1 };
    // Same chain as the worked example but with no decay factors at all:
    // import_weight(Bob) = 0.25; effective_affinity(Carol) = 0.25*0.8 = 0.2
    expect(effectiveAffinity(graph, 'Alice', 'Carol', 'user', opts)).toBeCloseTo(0.2, 10);
  });
});

describe('effectivePostScore', () => {
  it('is 0 for a post with no direct rating, no author affinity, and no tag affinity (empty terms, §5)', () => {
    const graph = buildTrustGraph({
      records: [],
      posts: new Map([['post:a', { author: 'Nobody', tags: [] }]]),
    });
    expect(effectivePostScore(graph, 'U', 'post:a', { dimension: 'true' })).toBe(0);
  });

  it('averages direct rating, author affinity, and mean tag affinity as three equal terms', () => {
    // Note this fixture is deliberately NOT three fully-isolated signals:
    // U's own direct rating of post:target is itself a "post relating to
    // Author" (since post:target is authored by Author) and "relating to
    // tagA/tagB" (since post:target carries both tags) — so it also feeds
    // the derived-affinity half of the author and tag composite-affinity
    // terms. This isn't a test artifact to work around; it's genuine,
    // correct system behavior (ratings.md has no carve-out excluding "the
    // post being scored" from derived-affinity bookkeeping), so the
    // expected value below accounts for it explicitly rather than
    // pretending the three terms are independent:
    //
    //   direct_rating(U, post:target)        = 0.2
    //   derived_affinity(U, Author, user)     = mean(0.2) = 0.2   (only post:target qualifies)
    //   composite_affinity(U, Author, user)   = (2*0.2 + 1*0.8) / 3 = 0.4
    //   derived_affinity(U, tagA, tag)        = mean(0.2) = 0.2
    //   composite_affinity(U, tagA, tag)      = (2*0.2 + 1*1) / 3 = 0.46666...
    //   derived_affinity(U, tagB, tag)        = mean(0.2) = 0.2
    //   composite_affinity(U, tagB, tag)      = (2*0.2 + 1*0) / 3 = 0.13333... (non-zero, so NOT excluded)
    //   tag_mean = mean(0.46666..., 0.13333...) = 0.3
    //   effective_score = mean(0.2, 0.4, 0.3) = 0.3
    //
    // (No further peers exist in this graph, so effective affinity equals
    // composite affinity throughout — hop 0 only.)
    const graph = buildTrustGraph({
      records: [
        rating('U', 'post:target', 'post', { true: 0.2 }),
        rating('U', 'Author', 'user', { true: 0.8 }),
        rating('U', 'tagA', 'tag', { true: 1 }),
        rating('U', 'tagB', 'tag', { true: 0 }),
      ],
      posts: new Map([['post:target', { author: 'Author', tags: ['tagA', 'tagB'] }]]),
    });
    expect(effectivePostScore(graph, 'U', 'post:target', { dimension: 'true' })).toBeCloseTo(
      0.3,
      10,
    );
  });

  it('cleanly isolates the author-affinity term when the direct rating and author signal come from different posts (no cross-contamination)', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'post:target', 'post', { true: 0.2 }), // the post being scored — no author/tags
        rating('U', 'post:other-by-author', 'post', { true: 0.8 }), // establishes author affinity cleanly
      ],
      posts: new Map([
        ['post:target', { tags: [] }], // no author, no tags: isolates the direct term
        ['post:other-by-author', { author: 'Author', tags: [] }],
      ]),
    });
    // Without an author/tags on post:target itself, U's rating of it can't
    // feed back into any author/tag term — so this time the three terms
    // really are independent: direct=0.2; author isn't attached to
    // post:target at all, so that term is simply absent (not 0.8).
    expect(effectivePostScore(graph, 'U', 'post:target', { dimension: 'true' })).toBeCloseTo(
      0.2,
      10,
    );
  });

  it('the worked example: #funny/#cat/#cute scenario from §5 produces the documented combined tag term', () => {
    const graph = buildTrustGraph({
      records: [
        rating('U', 'funny', 'tag', { true: 1 }),
        rating('U', 'cute', 'tag', { true: 1 }),
        rating('U', 'cat', 'tag', { true: -0.5 }),
      ],
      posts: new Map([['post:p', { tags: ['funny', 'cat', 'cute'] }]]),
    });
    // mean(+1, +1, -0.5) = +0.5 — the single tag term, with no author or
    // direct-rating terms present (post has no author in this fixture).
    expect(effectivePostScore(graph, 'U', 'post:p', { dimension: 'true' })).toBeCloseTo(0.5, 10);
  });

  it('excludes a zero tag affinity from the tag-mean term only when it reflects an unrated (not explicitly-zero) tag', () => {
    const graph = buildTrustGraph({
      records: [rating('U', 'funny', 'tag', { true: 1 })],
      // 'cat' is never rated by U at all -> affinity 0, excluded per §5's
      // `if effective_affinity(...) != 0` filter on tag_affinities.
      posts: new Map([['post:p', { tags: ['funny', 'cat'] }]]),
    });
    expect(effectivePostScore(graph, 'U', 'post:p', { dimension: 'true' })).toBeCloseTo(1, 10);
  });

  it('a post with many tags is not dominated by tag count (§5\u2019s closing claim)', () => {
    const manyTags = Array.from({ length: 50 }, (_, i) => `tag${i}`);
    const twoTags = ['tagA', 'tagB'];
    const records = [
      ...manyTags.map((t) => rating('U', t, 'tag', { true: 1 })),
      ...twoTags.map((t) => rating('U', t, 'tag', { true: 1 })),
      rating('U', 'Author', 'user', { true: -1 }),
    ];
    const graphMany = buildTrustGraph({
      records,
      posts: new Map([['post:many', { author: 'Author', tags: manyTags }]]),
    });
    const graphTwo = buildTrustGraph({
      records,
      posts: new Map([['post:two', { author: 'Author', tags: twoTags }]]),
    });
    const opts = { dimension: 'true' };
    // Both: mean(author=-1, tagMean=1) = 0, regardless of 2 vs 50 tags.
    expect(effectivePostScore(graphMany, 'U', 'post:many', opts)).toBeCloseTo(0, 10);
    expect(effectivePostScore(graphTwo, 'U', 'post:two', opts)).toBeCloseTo(0, 10);
  });
});

describe('meetsVisibilityThreshold', () => {
  it('a score at or above the threshold meets it', () => {
    expect(meetsVisibilityThreshold(0, 0)).toBe(true);
    expect(meetsVisibilityThreshold(0.1, 0)).toBe(true);
  });

  it('a score below the threshold does not meet it', () => {
    expect(meetsVisibilityThreshold(-0.01, 0)).toBe(false);
  });
});

import type { RatingRecord } from './rating-record.js';

/** Whether a graph node is being evaluated in its user role or tag role (ratings.md §2.1: "the same string could in principle identify different things"). */
export type NodeType = 'user' | 'tag';

/**
 * What's known about a post for the purposes of attributing ratings to its
 * author and tags (ratings.md §3.1). Not the full metadata.md `PostMetadata`
 * shape — only the two fields the trust graph math actually needs.
 */
export interface PostInfo {
  author?: string;
  tags: string[];
}

interface TrustGraphInternal {
  /** Validated, supersession-resolved rating records, indexed by rater. */
  recordsByRater: Map<string, RatingRecord[]>;
  posts: Map<string, PostInfo>;
}

/** An opaque, pre-indexed trust graph — build with {@link buildTrustGraph}. */
export type TrustGraph = TrustGraphInternal;

export interface BuildTrustGraphInput {
  /**
   * All known rating records, from any number of users. Supersession
   * (ratings.md §2.3 — latest record per `(rater, item, item_type)` wins,
   * an empty `ratings` map retracts) is resolved internally; records need
   * not be pre-deduplicated or sorted.
   */
  records: RatingRecord[];
  /**
   * Author/tags for every post referenced as an `item` by a `post`-typed
   * rating record. A post with no entry here is treated as having no
   * known author and no tags (contributing to neither).
   */
  posts: Map<string, PostInfo>;
}

/**
 * Index a flat set of rating records (and the post info needed to resolve
 * post ratings to authors/tags) into a {@link TrustGraph} that the
 * affinity functions in this module can query.
 */
export function buildTrustGraph(input: BuildTrustGraphInput): TrustGraph {
  const latest = resolveLatestRatings(input.records);
  const recordsByRater = new Map<string, RatingRecord[]>();
  for (const record of latest) {
    const list = recordsByRater.get(record.rater);
    if (list) {
      list.push(record);
    } else {
      recordsByRater.set(record.rater, [record]);
    }
  }
  return { recordsByRater, posts: new Map(input.posts) };
}

/**
 * Resolve a flat set of rating records to the latest record per
 * `(rater, item, item_type)` tuple (ratings.md §2.3), dropping any whose
 * winning record is a retraction (an empty `ratings` map).
 */
export function resolveLatestRatings(records: RatingRecord[]): RatingRecord[] {
  const latestByKey = new Map<string, RatingRecord>();
  for (const record of records) {
    const key = `${record.item_type}\u0000${record.item}\u0000${record.rater}`;
    const existing = latestByKey.get(key);
    if (!existing || record.timestamp > existing.timestamp) {
      latestByKey.set(key, record);
    }
  }
  return Array.from(latestByKey.values()).filter(
    (record) => Object.keys(record.ratings).length > 0,
  );
}

/** Shared options for every affinity/score function in this module. */
export interface AffinityOptions {
  /** The rating dimension to compute on (e.g. `"true"`). */
  dimension: string;
  /** User-configured decay factor in [0, 1] applied per hop (ratings.md §4.5). Default `0.5`. */
  decay?: number;
  /** Weight given to derived affinity in the composite (ratings.md §4.1). Default `2`. */
  derivedWeight?: number;
  /** Weight given to direct affinity in the composite (ratings.md §4.1). Default `1`. */
  directWeight?: number;
  /**
   * Optional cap on BFS hop count, for the "compute/bandwidth budget"
   * ratings.md §4.5 mentions. Traversal always terminates on its own once
   * the reachable graph is exhausted (each node is visited at most once),
   * even without this — it's a resource limit, not a correctness
   * requirement. Default: unlimited.
   */
  maxHops?: number;
}

function resolveDecay(opts: AffinityOptions): number {
  return opts.decay ?? 0.5;
}
function resolveDerivedWeight(opts: AffinityOptions): number {
  return opts.derivedWeight ?? 2;
}
function resolveDirectWeight(opts: AffinityOptions): number {
  return opts.directWeight ?? 1;
}

/** Every `post`-typed record `U` has rated that carries an explicit value for `dimension`, where `nodeType`/`N` is attributed as author (user) or a tag (tag) of that post. */
function qualifyingPostRatings(
  graph: TrustGraph,
  U: string,
  N: string,
  nodeType: NodeType,
  dimension: string,
): RatingRecord[] {
  const records = graph.recordsByRater.get(U) ?? [];
  const result: RatingRecord[] = [];
  for (const record of records) {
    if (record.item_type !== 'post') continue;
    if (!(dimension in record.ratings)) continue;
    const info = graph.posts.get(record.item);
    if (!info) continue;
    const attributed = nodeType === 'user' ? info.author === N : info.tags.includes(N);
    if (attributed) result.push(record);
  }
  return result;
}

/**
 * Derived affinity (ratings.md §4.2): the mean of `U`'s ratings, on
 * `dimension`, of posts authored by (nodeType `'user'`) or tagged with
 * (nodeType `'tag'`) `N`. Only posts where `U` explicitly rated this
 * specific dimension count — a post `U` rated on a different dimension
 * only is not treated as an implicit 0 for this one (see PROGRESS.md for
 * why; pinned by a dedicated test in `test/ratings/trust-graph.test.ts`).
 * `0` if `U` has rated nothing relating to `N` (§4.4: unknown nodes).
 */
export function derivedAffinity(
  graph: TrustGraph,
  U: string,
  N: string,
  nodeType: NodeType,
  opts: AffinityOptions,
): number {
  const records = qualifyingPostRatings(graph, U, N, nodeType, opts.dimension);
  if (records.length === 0) return 0;
  // Safe: qualifyingPostRatings already filtered to records where
  // `dimension in record.ratings`, but that invariant doesn't carry across
  // the function boundary for the type checker.
  const sum = records.reduce((acc, r) => acc + r.ratings[opts.dimension]!, 0);
  return sum / records.length;
}

/**
 * The count of ratings contributing to {@link derivedAffinity} (ratings.md
 * §4.3) — the same qualifying set, counted rather than averaged.
 */
export function confidence(
  graph: TrustGraph,
  U: string,
  N: string,
  nodeType: NodeType,
  opts: AffinityOptions,
): number {
  return qualifyingPostRatings(graph, U, N, nodeType, opts.dimension).length;
}

/**
 * Direct affinity (ratings.md §4.1): `U`'s explicit direct rating of `N`
 * (as a user or a tag, per `nodeType`) on `dimension`, if any. `0` if none
 * exists or the latest such rating is a retraction.
 */
export function directAffinity(
  graph: TrustGraph,
  U: string,
  N: string,
  nodeType: NodeType,
  opts: AffinityOptions,
): number {
  const records = graph.recordsByRater.get(U) ?? [];
  const record = records.find((r) => r.item_type === nodeType && r.item === N);
  if (!record) return 0;
  return record.ratings[opts.dimension] ?? 0;
}

/**
 * Composite affinity (ratings.md §4.1): the weighted combination of
 * derived and direct affinity. When only one is present, it is used
 * as-is — "no phantom zero is injected for the missing signal."
 */
export function compositeAffinity(
  graph: TrustGraph,
  U: string,
  N: string,
  nodeType: NodeType,
  opts: AffinityOptions,
): number {
  const derivedRecords = qualifyingPostRatings(graph, U, N, nodeType, opts.dimension);
  const directRecords = graph.recordsByRater.get(U) ?? [];
  const directRecord = directRecords.find((r) => r.item_type === nodeType && r.item === N);
  const hasDirect = directRecord !== undefined;
  const hasDerived = derivedRecords.length > 0;

  if (!hasDerived && !hasDirect) return 0;

  const derived = hasDerived ? derivedAffinity(graph, U, N, nodeType, opts) : 0;
  const direct = hasDirect ? (directRecord.ratings[opts.dimension] ?? 0) : 0;

  if (hasDerived && hasDirect) {
    const dw = resolveDerivedWeight(opts);
    const xw = resolveDirectWeight(opts);
    return (dw * derived + xw * direct) / (dw + xw);
  }
  return hasDerived ? derived : direct;
}

/**
 * Every `(nodeId, nodeType)` pair that rater `P` has non-zero composite
 * affinity with — i.e. "the nodes in P's rating collection" (ratings.md
 * §4.5 step 2), derived directly from P's own rating records rather than
 * a separate global index. Used by {@link effectiveAffinity}'s traversal.
 */
function compositeAffinitiesOf(
  graph: TrustGraph,
  P: string,
  opts: AffinityOptions,
): { nodeId: string; nodeType: NodeType; value: number }[] {
  const records = graph.recordsByRater.get(P) ?? [];
  const candidates = new Map<string, { nodeId: string; nodeType: NodeType }>();

  for (const record of records) {
    if (record.item_type === 'post') {
      if (!(opts.dimension in record.ratings)) continue;
      const info = graph.posts.get(record.item);
      if (!info) continue;
      if (info.author !== undefined) {
        const key = `user\u0000${info.author}`;
        candidates.set(key, { nodeId: info.author, nodeType: 'user' });
      }
      for (const tag of info.tags) {
        const key = `tag\u0000${tag}`;
        candidates.set(key, { nodeId: tag, nodeType: 'tag' });
      }
    } else {
      const key = `${record.item_type}\u0000${record.item}`;
      candidates.set(key, { nodeId: record.item, nodeType: record.item_type });
    }
  }

  const result: { nodeId: string; nodeType: NodeType; value: number }[] = [];
  for (const { nodeId, nodeType } of candidates.values()) {
    const value = compositeAffinity(graph, P, nodeId, nodeType, opts);
    if (value !== 0) result.push({ nodeId, nodeType, value });
  }
  return result;
}

/**
 * Run the full breadth-first traversal (ratings.md §4.5) from `U` once,
 * returning accumulated effective-affinity contributions for every node
 * reached. Shared by {@link effectiveAffinity} (which looks up one entry)
 * and {@link effectivePostScore} (which needs several at once — the
 * author plus every tag — without re-running the traversal per lookup).
 *
 * The per-hop import-weight chaining here follows ratings.md Appendix B's
 * worked example precisely: each hop's weight is the previous hop's
 * accumulated contribution into that node, times one additional decay
 * factor — not `composite_affinity(U, P, D) × decay^H` computed directly
 * from U as §4.5's own prose formula states, which (read literally) would
 * require U to have direct affinity with distant peers it may never have
 * rated anything related to, and would be circular for exactly the nodes
 * the traversal exists to reach indirectly. The worked example is
 * unambiguous and is what this implementation is verified against (see
 * `test/ratings/trust-graph.test.ts` and PROGRESS.md); §4.5's prose
 * formula is best read as a loose gloss on this chain, not a literal
 * restatement of it.
 */
function runTraversal(graph: TrustGraph, U: string, opts: AffinityOptions): Map<string, number> {
  const decay = resolveDecay(opts);
  const maxHops = opts.maxHops ?? Infinity;

  // Keyed by `${nodeType}\0${nodeId}` throughout, to keep a node's user-role
  // and tag-role affinities independent (ratings.md §2.1's disambiguation).
  const accumulator = new Map<string, number>();
  const visited = new Set<string>([`user\u0000${U}`]);

  const addToAccumulator = (nodeId: string, nodeType: NodeType, amount: number): void => {
    const key = `${nodeType}\u0000${nodeId}`;
    accumulator.set(key, (accumulator.get(key) ?? 0) + amount);
  };

  // Hop 0: U's own composite affinity with each directly-related node, at weight 1.
  for (const { nodeId, nodeType, value } of compositeAffinitiesOf(graph, U, opts)) {
    addToAccumulator(nodeId, nodeType, value);
  }

  // Hop 1 frontier: every user P with non-zero composite_affinity(U, P, D).
  // No visited-check needed here beyond excluding U itself: compositeAffinitiesOf
  // returns at most one entry per (nodeType, nodeId) pair (it's built from a
  // Map keyed that way), so this loop can't itself produce a duplicate, and
  // `visited` at this point contains nothing but U.
  let frontier: { userId: string; importWeight: number }[] = [];
  for (const { nodeId, nodeType, value } of compositeAffinitiesOf(graph, U, opts)) {
    if (nodeType !== 'user' || nodeId === U) continue;
    if (!graph.recordsByRater.has(nodeId)) continue; // nothing to propagate
    visited.add(`user\u0000${nodeId}`);
    frontier.push({ userId: nodeId, importWeight: value * decay });
  }

  let hop = 1;
  while (frontier.length > 0 && hop <= maxHops) {
    const nextContribution = new Map<string, number>(); // keyed by user-id candidate for next hop

    for (const { userId: P, importWeight } of frontier) {
      for (const { nodeId: N, nodeType, value } of compositeAffinitiesOf(graph, P, opts)) {
        // "Each node is visited at most once... longer-path encounters are
        // skipped" (§4.5 step 3) applies to the whole encounter, not just
        // whether N becomes a new relay: if N is a user already resolved
        // at an equal-or-shorter hop (including one resolved earlier in
        // this very hop's frontier, e.g. two of U's own direct relations
        // where one also happens to be reachable through the other), this
        // contribution must be discarded entirely — it must not inflate
        // N's accumulator either. Tags are never "visited" (they aren't
        // relay sources), so no such gating applies to them; every path's
        // contribution to a tag legitimately accumulates.
        if (nodeType === 'user' && visited.has(`user\u0000${N}`)) continue;

        const contribution = importWeight * value;
        addToAccumulator(N, nodeType, contribution);
        if (nodeType === 'user' && N !== U && graph.recordsByRater.has(N)) {
          nextContribution.set(N, (nextContribution.get(N) ?? 0) + contribution);
        }
      }
    }

    hop += 1;
    frontier = [];
    // No visited-check needed here either: the "already visited" guard
    // above (in the inner double-loop) already excludes any already-visited
    // user from ever being added to nextContribution in the first place,
    // for every contributing parent.
    for (const [userId, summed] of nextContribution) {
      visited.add(`user\u0000${userId}`);
      frontier.push({ userId, importWeight: summed * decay });
    }
  }

  return accumulator;
}

/**
 * Effective affinity (ratings.md §4.5): `U`'s composite affinity with `N`,
 * incorporating decayed contributions from peers at greater graph
 * distances via breadth-first traversal. `0` at cold start or for any
 * node outside `U`'s reachable graph (§4.4).
 */
export function effectiveAffinity(
  graph: TrustGraph,
  U: string,
  N: string,
  nodeType: NodeType,
  opts: AffinityOptions,
): number {
  const accumulator = runTraversal(graph, U, opts);
  return accumulator.get(`${nodeType}\u0000${N}`) ?? 0;
}

/**
 * Effective post score (ratings.md §5): the mean of up to three terms —
 * `U`'s direct rating of the post, `U`'s effective affinity with its
 * author, and the mean of `U`'s effective affinities with its tags — each
 * included only when non-zero. `0` if no terms qualify (division by zero
 * in an empty terms list).
 */
export function effectivePostScore(
  graph: TrustGraph,
  U: string,
  postId: string,
  opts: AffinityOptions,
): number {
  const info = graph.posts.get(postId);
  const accumulator = runTraversal(graph, U, opts);
  const terms: number[] = [];

  const directRecords = graph.recordsByRater.get(U) ?? [];
  const directRecord = directRecords.find((r) => r.item_type === 'post' && r.item === postId);
  const directRating = directRecord?.ratings[opts.dimension];
  if (directRating !== undefined && directRating !== 0) {
    terms.push(directRating);
  }

  if (info?.author !== undefined) {
    const authorAffinity = accumulator.get(`user\u0000${info.author}`) ?? 0;
    if (authorAffinity !== 0) terms.push(authorAffinity);
  }

  if (info?.tags !== undefined && info.tags.length > 0) {
    const tagAffinities = info.tags
      .map((tag) => accumulator.get(`tag\u0000${tag}`) ?? 0)
      .filter((v) => v !== 0);
    if (tagAffinities.length > 0) {
      terms.push(tagAffinities.reduce((a, b) => a + b, 0) / tagAffinities.length);
    }
  }

  if (terms.length === 0) return 0;
  return terms.reduce((a, b) => a + b, 0) / terms.length;
}

/**
 * Whether an effective post score meets a user's visibility threshold
 * (ratings.md §5.1) — a post scoring at or above the threshold is shown
 * in the default feed view.
 */
export function meetsVisibilityThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}

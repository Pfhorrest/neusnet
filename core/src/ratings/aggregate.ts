import { contentIdentityMatches } from '../metadata/content-identity.js';
import type { PostMetadata } from '../metadata/post.js';
import {
  buildVersionHistory,
  type AuthorSignatureVerifier,
  type VersionHistory,
} from '../metadata/version-history.js';
import type { RatingRecord } from './rating-record.js';
import { buildTrustGraph, resolveLatestRatings, type PostInfo, type TrustGraph } from './trust-graph.js';

/**
 * Rating aggregation across the versions of a post (ratings.md §2.5).
 *
 * Every function here assumes its rating records and metadata files have
 * already been checked: shapes validated, and signatures verified for any
 * record the caller intends to trust (identity.md §4.4 — "a record whose
 * signature does not verify must be treated as invalid and discarded").
 * Nothing in this module checks a rating's signature.
 */

export interface AggregatePostRatingsInput {
  /** The post's version history, from {@link buildVersionHistory}. */
  history: VersionHistory;
  /** Every metadata file the client knows of, keyed by version identifier. */
  known: ReadonlyMap<string, PostMetadata>;
  /** Rating records to draw from — any records, for any items; irrelevant ones are ignored. */
  records: readonly RatingRecord[];
}

export interface AggregatedPostRatings {
  /**
   * The versions whose ratings count toward this post, in priority order:
   * canonical versions (newest first), then memory-holed versions, then
   * third-party introductions and unsigned copies whose content identity
   * is confirmed. (With no canonical history, the current version leads.)
   */
  includedVersionIds: string[];
  /**
   * One record per rater: their most recent rating of the post across all
   * included versions. A rater whose most recent record is a retraction
   * has withdrawn their rating and does not appear.
   */
  ratings: RatingRecord[];
  /**
   * Included-version records that lost out to a more recent record from
   * the same rater. A caller assembling a trust graph should drop these,
   * so a rater who rated several versions isn't counted once per version
   * ({@link buildTrustGraphFromPosts} does this).
   */
  superseded: RatingRecord[];
  /**
   * Each included version's own ratings (latest per rater per version,
   * retractions removed), *before* cross-version deduplication — for
   * per-version breakdowns (e.g. flagging ratings concentrated on a
   * version other than the current one).
   */
  byVersion: Map<string, RatingRecord[]>;
}

function byTimestampThenRater(a: RatingRecord, b: RatingRecord): number {
  return a.timestamp - b.timestamp || (a.rater < b.rater ? -1 : a.rater > b.rater ? 1 : 0);
}

/**
 * Aggregate ratings across a post's versions (ratings.md §2.5):
 *
 * 1. Count ratings of every canonical version.
 * 2. Count ratings of memory-holed versions — an author cannot erase the
 *    response to their own words by skipping a version.
 * 3. Count ratings of third-party introductions and unsigned copies
 *    naming the canonical author, but only where content identity with an
 *    author-signed version is confirmed (metadata.md §4.3). An
 *    introduction cannot vouch for another introduction.
 * 4. Never count false claimants.
 * 5. Keep only each rater's most recent record across all of that.
 *
 * Where a post has no author-signed version at all (a bridged post whose
 * author hasn't joined neusnet), the current version stands in as the
 * anchor that introductions are confirmed against.
 */
export function aggregatePostRatings(input: AggregatePostRatingsInput): AggregatedPostRatings {
  const { history, known, records } = input;

  const included: string[] = [];
  if (history.canonical.length === 0) included.push(history.currentVersionId);
  included.push(...history.canonical, ...history.memoryHoled);

  const anchors = included
    .map((versionId) => known.get(versionId))
    .filter((post): post is PostMetadata => post !== undefined);
  for (const versionId of [...history.thirdPartyIntroductions, ...history.unsignedCopies]) {
    const post = known.get(versionId);
    if (post !== undefined && anchors.some((anchor) => contentIdentityMatches(post, anchor))) {
      included.push(versionId);
    }
  }

  const order = new Map(included.map((versionId, index) => [versionId, index]));
  const collected = records.filter((r) => r.item_type === 'post' && order.has(r.item));

  // Most recent record per rater across every included version. A tie on
  // timestamp goes to the version earlier in the priority order, so the
  // result doesn't depend on the order records happened to arrive in.
  const retained = new Map<string, RatingRecord>();
  for (const record of collected) {
    const best = retained.get(record.rater);
    const beatsBest =
      best === undefined ||
      record.timestamp > best.timestamp ||
      (record.timestamp === best.timestamp &&
        (order.get(record.item) ?? Infinity) < (order.get(best.item) ?? Infinity));
    if (beatsBest) retained.set(record.rater, record);
  }

  const retainedSet = new Set(retained.values());
  const ratings = [...retained.values()]
    .filter((record) => Object.keys(record.ratings).length > 0)
    .sort(byTimestampThenRater);
  const superseded = collected.filter((record) => !retainedSet.has(record));

  const byVersion = new Map<string, RatingRecord[]>(included.map((versionId) => [versionId, []]));
  for (const record of resolveLatestRatings(collected)) {
    byVersion.get(record.item)?.push(record);
  }
  for (const list of byVersion.values()) list.sort(byTimestampThenRater);

  return { includedVersionIds: included, ratings, superseded, byVersion };
}

export interface BuildTrustGraphFromPostsInput {
  /** Every metadata file the client knows of, keyed by version identifier. */
  known: ReadonlyMap<string, PostMetadata>;
  /**
   * For each post whose versions should be merged: its stable identifier
   * and the version it currently resolves to. Files whose posts are not
   * listed here are treated as standalone posts, one per version, with no
   * cross-version deduplication.
   */
  currentVersions: ReadonlyMap<string, string>;
  /** All rating records to build the graph from. */
  records: readonly RatingRecord[];
  /** Author-signature check for non-native identity substrates; see {@link AuthorSignatureVerifier}. */
  isAuthorSigned?: AuthorSignatureVerifier;
}

/**
 * Assemble a {@link TrustGraph} from post metadata and rating records,
 * applying cross-version aggregation (ratings.md §2.5) so each rater
 * counts once per post rather than once per version.
 *
 * Each version's author and tags are taken from its own metadata file, so
 * a rating of a false claimant's version builds affinity with *that*
 * claimant — "a plagiarist gains affinity only from ratings explicitly
 * given to their version." Note this also credits whatever `author` a
 * third-party-attested file names, confirmed or not; whether unconfirmed
 * attributions should be credited is an open question (metadata.md §7).
 *
 * Cost grows with posts × records, which is fine for a reference
 * implementation and for the data a single client holds; index the
 * records by item first if that ever stops being true.
 */
export function buildTrustGraphFromPosts(input: BuildTrustGraphFromPostsInput): TrustGraph {
  const superseded = new Set<RatingRecord>();
  for (const [id, currentVersionId] of input.currentVersions) {
    const history = buildVersionHistory({
      id,
      currentVersionId,
      known: input.known,
      ...(input.isAuthorSigned !== undefined ? { isAuthorSigned: input.isAuthorSigned } : {}),
    });
    const aggregated = aggregatePostRatings({
      history,
      known: input.known,
      records: input.records,
    });
    for (const record of aggregated.superseded) superseded.add(record);
  }

  const posts = new Map<string, PostInfo>();
  for (const [versionId, post] of input.known) {
    posts.set(versionId, {
      tags: post.tags,
      ...(post.author !== undefined ? { author: post.author } : {}),
    });
  }

  return buildTrustGraph({
    records: input.records.filter((record) => !superseded.has(record)),
    posts,
  });
}

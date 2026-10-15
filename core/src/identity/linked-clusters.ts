import type { RatingRecord } from '../ratings/rating-record.js';
import type { PostInfo } from '../ratings/trust-graph.js';
import {
  verifyMutualLink,
  type IdentityDocument,
  type VerifyOptions,
} from './identity-document.js';

/**
 * Linked-identity aggregation (identity.md §7.1): deciding whether a
 * user's mutually-verified linked identities should be treated as one node
 * in the trust graph, and applying that decision to rating data.
 *
 * This is a pure pre-processing layer in front of
 * `src/ratings/trust-graph.ts`, not a change to it: computing clusters,
 * resolving the two-layer preference, and remapping identifiers all happen
 * here, and the result is handed to the unmodified
 * {@link import('../ratings/trust-graph.js').buildTrustGraph}.
 */

/** A set of identities verified as mutually linked, and the owner-side preference for treating them as one. */
export interface LinkedCluster {
  /** Every member's identifier, sorted. */
  members: string[];
  /**
   * The identifier the cluster aggregates to: by convention, the
   * lexicographically smallest member. Which member is chosen doesn't
   * matter on its own — linking is symmetric and the spec names no
   * "primary" identity in a cluster — only that the choice is
   * deterministic.
   */
  canonicalId: string;
  /**
   * Layer 1 (identity.md §7.1): true if *any* member's document sets
   * `aggregate_linked: true`.
   */
  ownerPrefersAggregate: boolean;
}

/**
 * Find every mutually-verified linked-identity cluster among a set of
 * identity documents (identity.md §7, §7.1).
 *
 * A cluster is a **connected component** of the mutual-link graph — if A
 * and B mutually link, and B and C mutually link, all three are one
 * cluster even though A and C never declared each other directly. The
 * specification describes clusters in this collective sense ("if any
 * identity in a mutually-verified cluster...") without fully spelling out
 * the graph structure; connected components is the natural reading and
 * is far more practical than requiring every pair in an N-person cluster
 * to separately declare the other N-1.
 *
 * Only documents that verify are considered, and only link records whose
 * own signature verifies (a link record's signature is checked
 * independently of its containing document's, exactly as
 * {@link import('./identity-document.js').verifyMutualLink} does for a
 * pair). Identities with no verified mutual link are not included in any
 * cluster — there is nothing to aggregate.
 */
export function computeLinkedClusters(
  documents: readonly IdentityDocument[],
  options?: VerifyOptions,
): LinkedCluster[] {
  const byId = new Map(documents.map((doc) => [doc.id, doc]));
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  };

  const pairs = new Set<string>();
  for (const doc of documents) {
    for (const entry of doc.linked_ids ?? []) {
      const other = byId.get(entry.linked_id);
      if (other === undefined) continue;
      const pairKey = [doc.id, other.id].sort().join('\u0000');
      if (pairs.has(pairKey)) continue; // already resolved from the other side
      pairs.add(pairKey);
      if (verifyMutualLink(doc, other, options)) link(doc.id, other.id);
    }
  }

  const visited = new Set<string>();
  const clusters: LinkedCluster[] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const members: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const current = queue.shift()!; // safe: just pushed, loop guarded by queue.length
      members.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    members.sort();
    const ownerPrefersAggregate = members.some((id) => byId.get(id)?.aggregate_linked === true);
    clusters.push({ members, canonicalId: members[0]!, ownerPrefersAggregate });
  }
  return clusters;
}

/** The viewer's Layer 2 preference (identity.md §7.1). */
export type AggregationMode = 'respect-owner' | 'always-aggregate' | 'always-separate';

/**
 * Apply a viewer's aggregation mode to a set of clusters, producing an
 * identifier remapping: every non-canonical member of a cluster that ends
 * up aggregated maps to that cluster's `canonicalId` (which maps to
 * itself, so a lookup never needs a fallback). A cluster that isn't
 * aggregated under this mode contributes no entries — its members are
 * simply absent from the map.
 */
export function computeIdentityMapping(
  clusters: readonly LinkedCluster[],
  mode: AggregationMode,
): Map<string, string> {
  const mapping = new Map<string, string>();
  if (mode === 'always-separate') return mapping;
  for (const cluster of clusters) {
    if (mode === 'respect-owner' && !cluster.ownerPrefersAggregate) continue;
    for (const member of cluster.members) mapping.set(member, cluster.canonicalId);
  }
  return mapping;
}

export interface ApplyIdentityMappingInput {
  records: readonly RatingRecord[];
  posts: ReadonlyMap<string, PostInfo>;
  /** From {@link computeIdentityMapping} (or assembled by hand). */
  mapping: ReadonlyMap<string, string>;
}

/**
 * Remap rating records and post info through an identity mapping, so that
 * every member of an aggregated cluster acts as its canonical identity for
 * trust-graph purposes — as a rater, and as a post's author. A `post` or
 * `tag`-typed rating's `item` is never remapped: identity clusters are
 * about users, not content or tags, even if a string happened to collide.
 *
 * The result is ordinary input to
 * {@link import('../ratings/trust-graph.js').buildTrustGraph} — this
 * function does not itself build a graph.
 */
export function applyIdentityMapping(input: ApplyIdentityMappingInput): {
  records: RatingRecord[];
  posts: Map<string, PostInfo>;
} {
  const { mapping } = input;
  const remap = (id: string): string => mapping.get(id) ?? id;

  const records = input.records.map((record) => ({
    ...record,
    rater: remap(record.rater),
    item: record.item_type === 'user' ? remap(record.item) : record.item,
  }));

  const posts = new Map<string, PostInfo>();
  for (const [versionId, info] of input.posts) {
    posts.set(
      versionId,
      info.author === undefined ? info : { ...info, author: remap(info.author) },
    );
  }

  return { records, posts };
}

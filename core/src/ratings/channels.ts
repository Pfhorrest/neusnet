import { matchesTagQuery, normalizeTag, tagComponents } from './tags.js';

/**
 * Channels (ratings.md §6.4–§6.6): a user-defined, persistent feed rooted
 * in a tag, with an optional local taxonomy extending it. Unlike every
 * other object in this library, a channel is never signed or published —
 * ratings.md §6.4 is explicit that it is client-local state ("a private
 * taxonomic assertion that affects only their own view") — so there is no
 * wire schema, no `validateChannel`, no `neusnet_version`. What follows
 * are pure functions implementing the matching and suggestion algorithms
 * §6.4–§6.5 describe, which clients are encouraged, not required, to use.
 */

/** A channel (ratings.md §6.4). */
export interface Channel {
  /** The channel's root tag, normalized. */
  rootTag: string;
  /**
   * Additional tag components the user has chosen to include as if they
   * were subtags of the root (§6.4), each normalized. A channel with
   * `rootTag: 'philosophy'` and `localTaxonomy: ['epistemology']` matches
   * `#epistemology` wherever it appears, not only under `#philosophy`.
   */
  localTaxonomy: string[];
  /** Defaults to `rootTag`. */
  displayName: string;
}

export interface CreateChannelOptions {
  localTaxonomy?: string[];
  displayName?: string;
}

/** Construct a channel, normalizing its root tag and local taxonomy (ratings.md §6.1 rules apply to both). */
export function createChannel(rootTag: string, options?: CreateChannelOptions): Channel {
  const normalizedRoot = normalizeTag(rootTag);
  return {
    rootTag: normalizedRoot,
    localTaxonomy: (options?.localTaxonomy ?? []).map((tag) => normalizeTag(tag)),
    displayName: options?.displayName ?? normalizedRoot,
  };
}

/**
 * Whether a (normalized) tag belongs in a channel: it matches the root tag
 * under the ordinary prefix rule (ratings.md §6.3 — `#philosophy.logic`
 * matches a `#philosophy` channel automatically, no local taxonomy entry
 * needed), or it matches any local taxonomy entry (component matching,
 * §6.3 again — a local taxonomy entry pulls in that component wherever it
 * appears, under any parent or none).
 */
export function matchesChannel(tag: string, channel: Channel): boolean {
  if (matchesTagQuery(tag, channel.rootTag)) return true;
  return channel.localTaxonomy.some((component) => matchesTagQuery(tag, component));
}

/** Whether any of a post's (normalized) tags belong in a channel. */
export function postMatchesChannel(tags: readonly string[], channel: Channel): boolean {
  return tags.some((tag) => matchesChannel(tag, channel));
}

/** A candidate cross-hierarchy inclusion (ratings.md §6.5). */
export interface SuggestionCandidate {
  /** The bare component being suggested for the local taxonomy, e.g. `"epistemology"`. */
  component: string;
  /** Tags observed under the channel's root that contain this component as their immediate child. */
  observedUnderRoot: string[];
  /** Tags observed elsewhere in the corpus — bare, or under a different parent — that this suggestion would newly include. */
  observedElsewhere: string[];
  /**
   * A plain-language statement of exactly what accepting this suggestion
   * would include, per §6.5's disclosure requirement: "the client cannot
   * know whether the suggestion is a good one or an overly broad one."
   */
  disclosure: string;
}

export interface SuggestOptions {
  /** Components to never suggest — e.g. ones the user has already dismissed. */
  exclude?: readonly string[];
}

function disclosureFor(component: string, example: string): string {
  return (
    `Users you trust often tag posts "${example}". Would you like to also include posts tagged ` +
    `"${component}" (without that prefix) in this channel? This will include all posts where ` +
    `"${component}" appears as a tag segment anywhere.`
  );
}

/**
 * Compute cross-hierarchy inclusion candidates for a channel (ratings.md
 * §6.5): components that appear as the immediate child of the channel's
 * root in some tags, and *also* appear elsewhere in the corpus — bare, or
 * under a different parent — making them candidates to pull into the
 * local taxonomy.
 *
 * `corpus` is each post's tag list, already filtered by the caller to
 * whatever "trusted content" should inform suggestions (§6.5 says "users
 * you trust"; this function has no notion of affinity itself — see
 * `effectiveAffinity` in `trust-graph.ts` for computing that filter).
 * Components already in the channel's local taxonomy, or in `exclude`,
 * are never suggested.
 *
 * Only the *immediate* child of the root is extracted as a candidate —
 * `#philosophy.epistemology.reliabilism` suggests `epistemology`, not
 * `reliabilism` — since a deeper descendant is already reachable through
 * `epistemology` once that component is included, and is in any case
 * already included automatically by the root prefix rule.
 */
export function suggestCrossHierarchyInclusions(
  channel: Channel,
  corpus: readonly (readonly string[])[],
  options?: SuggestOptions,
): SuggestionCandidate[] {
  const excluded = new Set([...channel.localTaxonomy, ...(options?.exclude ?? [])]);
  const underRoot = new Map<string, Set<string>>();
  const elsewhere = new Map<string, Set<string>>();

  const rootParts = tagComponents(channel.rootTag);
  for (const tags of corpus) {
    for (const tag of tags) {
      const parts = tagComponents(tag);
      const hasRootAsPrefix =
        parts.length > rootParts.length && rootParts.every((part, i) => parts[i] === part);
      if (hasRootAsPrefix) {
        // The component immediately after the root, however much deeper
        // the rest of the tag goes — "philosophy.epistemology.reliabilism"
        // still yields "epistemology", not "reliabilism".
        const component = parts[rootParts.length]!;
        if (excluded.has(component)) continue;
        if (!underRoot.has(component)) underRoot.set(component, new Set());
        underRoot.get(component)?.add(tag);
        continue;
      }
      const component = parts[parts.length - 1]!;
      if (excluded.has(component) || component === channel.rootTag) continue;
      // "Elsewhere" means not itself rooted under this channel's tag.
      if (matchesTagQuery(tag, channel.rootTag)) continue;
      if (!elsewhere.has(component)) elsewhere.set(component, new Set());
      elsewhere.get(component)?.add(tag);
    }
  }

  const candidates: SuggestionCandidate[] = [];
  for (const [component, underRootTags] of underRoot) {
    const elsewhereTags = elsewhere.get(component);
    if (elsewhereTags === undefined || elsewhereTags.size === 0) continue;
    const example = [...underRootTags][0]!;
    candidates.push({
      component,
      observedUnderRoot: [...underRootTags].sort(),
      observedElsewhere: [...elsewhereTags].sort(),
      disclosure: disclosureFor(component, example),
    });
  }
  return candidates.sort((a, b) => (a.component < b.component ? -1 : 1));
}

export interface DiscoverTopLevelTagsOptions {
  limit?: number;
}

/**
 * Rank root tag components by how many posts in the corpus carry them
 * (ratings.md §6.5, "Top-level discovery") — a starting point for a
 * personal browsable topic index. A component is counted at most once per
 * post, however many of that post's tags share it. `corpus` should
 * already be filtered to positive-affinity content, as with
 * {@link suggestCrossHierarchyInclusions}.
 */
export function discoverTopLevelTags(
  corpus: readonly (readonly string[])[],
  options?: DiscoverTopLevelTagsOptions,
): string[] {
  const counts = new Map<string, number>();
  for (const tags of corpus) {
    const roots = new Set(tags.map((tag) => tagComponents(tag)[0]!));
    for (const root of roots) counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort(
    ([aTag, aCount], [bTag, bCount]) => bCount - aCount || (aTag < bTag ? -1 : 1),
  );
  const limited = options?.limit !== undefined ? ranked.slice(0, options.limit) : ranked;
  return limited.map(([tag]) => tag);
}

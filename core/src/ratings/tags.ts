/**
 * Tag normalization and search, per ratings.md §6.1–§6.3.
 *
 * Implementation note on "punctuation" (§6.1 steps 3–4): the spec's prose
 * describes removing "punctuation" in the everyday sense, and its own
 * worked example ("C++" → "c") requires stripping `+`, which Unicode
 * classifies as a Symbol (category Sm), not Punctuation (category P*).
 * Rather than special-case particular symbol categories, this
 * implementation defines the keep-set directly from the spec's own stated
 * output shape (`[a-z0-9][a-z0-9-]*[a-z0-9]`, generalized to Unicode
 * letters/numbers per §8.2's direction on non-Latin scripts — see below):
 * a character survives normalization only if it is a Unicode letter,
 * a Unicode number, or the hyphen. Everything else — punctuation, symbols,
 * emoji, control characters — is removed. This is simpler than enumerating
 * Unicode categories that colloquially read as "punctuation," is
 * guaranteed by construction to produce output of the documented shape,
 * and reproduces every worked example in §6.1 and §6.2 exactly (see the
 * test suite).
 *
 * Implementation note on scripts (ratings.md open question §8.2): the
 * spec's documented output shape is written in terms of ASCII
 * `[a-z0-9]`, but §8.2 is explicit that non-Latin-script tags "are not
 * excluded" and recommends NFKC plus script-appropriate lowercasing. This
 * implementation follows that direction: the keep-set uses the Unicode
 * `\p{L}` (Letter) and `\p{N}` (Number) categories rather than an ASCII
 * range, so Cyrillic, CJK, Arabic, and other scripts are normalized
 * (NFKC + lowercased where lowercasing is meaningful) rather than
 * stripped. `.toLowerCase()` is used rather than `.toLocaleLowerCase()`
 * to keep the result locale-independent, per §6.1's "lowercase all
 * characters using Unicode locale-independent case folding" — CJK and
 * similar scripts have no case distinction, so this step is a no-op for
 * them, consistent with §8.2's note that "CJK tags are likely to be
 * case-insensitive by nature."
 */

const WHITESPACE_RUN = /\s+/gu;
const NOT_KEEP_CHAR = /[^\p{L}\p{N}-]/gu;
const HYPHEN_RUN = /-+/g;
const LEADING_OR_TRAILING_HYPHENS = /^-+|-+$/g;

/**
 * Normalize a single tag *component* — one dot-separated segment — per the
 * seven-step procedure in ratings.md §6.1.
 *
 * @throws If the component normalizes to the empty string.
 */
export function normalizeTagComponent(input: string): string {
  const result = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(WHITESPACE_RUN, '-')
    .replace(NOT_KEEP_CHAR, '')
    .replace(HYPHEN_RUN, '-')
    .replace(LEADING_OR_TRAILING_HYPHENS, '');

  if (result.length === 0) {
    throw new Error(
      `normalizeTagComponent: ${JSON.stringify(input)} normalizes to the empty string`,
    );
  }
  return result;
}

/**
 * Normalize a full tag, flat or hierarchical, per ratings.md §6.1–§6.2.
 *
 * A hierarchical tag (containing `.`) is normalized by splitting on `.`,
 * normalizing each component independently via
 * {@link normalizeTagComponent}, and rejoining with `.`.
 *
 * @throws If the tag has a leading, trailing, or doubled dot (empty
 *   component between two dots), or if any individual component
 *   normalizes to the empty string.
 */
export function normalizeTag(input: string): string {
  // A leading/trailing/doubled dot produces an empty-string element when
  // split on '.' — rejected explicitly here for a clearer error message
  // than letting normalizeTagComponent's generic empty-component error
  // fire on an empty-string component instead.
  if (input.startsWith('.') || input.endsWith('.') || input.includes('..')) {
    throw new Error(
      `normalizeTag: ${JSON.stringify(input)} has a leading, trailing, or consecutive dot`,
    );
  }

  const normalizedComponents = input.split('.').map(normalizeTagComponent);
  return normalizedComponents.join('.');
}

/**
 * Check whether a string is a valid tag (normalizes without error),
 * without throwing.
 */
export function isValidTag(input: string): boolean {
  try {
    normalizeTag(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Split an already-normalized tag into its dot-separated components.
 *
 * `tagComponents('philosophy.epistemology')` → `['philosophy', 'epistemology']`
 */
export function tagComponents(normalizedTag: string): string[] {
  return normalizedTag.split('.');
}

export interface MatchesTagQueryOptions {
  /**
   * Match only the precise tag string, with no sub-component matching —
   * the "exact" search mode ratings.md §6.3 says clients should offer
   * alongside the default component-matching behavior.
   */
  exact?: boolean;
}

/**
 * Determine whether a tag matches a search query, per the rules in
 * ratings.md §6.3.
 *
 * Both `tag` and `query` are assumed to already be normalized (see
 * {@link normalizeTag}) — this function does not normalize its inputs,
 * since in practice it is called many times against tag data that was
 * normalized once at write/parse time.
 *
 * Default (non-exact) semantics:
 * - A **single-component** query matches if that component appears
 *   *anywhere* in the tag's component list, at any depth.
 * - A **multi-component** query matches only as a *root-anchored prefix*
 *   of the tag's component list — i.e. the tag's first N components
 *   (N = the query's length) must equal the query's components exactly.
 *   `philosophy.epistemology` matches `philosophy.epistemology.reliabilism`
 *   but not `psychology.epistemology` or bare `epistemology`.
 */
export function matchesTagQuery(
  tag: string,
  query: string,
  options?: MatchesTagQueryOptions,
): boolean {
  if (options?.exact === true) {
    return tag === query;
  }

  const tagParts = tagComponents(tag);
  const queryParts = tagComponents(query);

  if (queryParts.length === 1) {
    // Safe: `tagComponents` on a non-empty string always returns at least
    // one element, so `queryParts[0]` exists whenever `queryParts.length === 1`.
    return tagParts.includes(queryParts[0]!);
  }

  if (tagParts.length < queryParts.length) {
    return false;
  }
  return queryParts.every((part, i) => tagParts[i] === part);
}

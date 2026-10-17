import { describe, expect, it } from 'vitest';
import {
  createChannel,
  discoverTopLevelTags,
  matchesChannel,
  postMatchesChannel,
  suggestCrossHierarchyInclusions,
} from '../../src/ratings/channels.js';

describe('createChannel', () => {
  it('normalizes the root tag and defaults an empty local taxonomy', () => {
    const channel = createChannel('Philosophy');
    expect(channel.rootTag).toBe('philosophy');
    expect(channel.localTaxonomy).toEqual([]);
  });

  it('normalizes local taxonomy entries', () => {
    const channel = createChannel('philosophy', { localTaxonomy: ['Epistemology'] });
    expect(channel.localTaxonomy).toEqual(['epistemology']);
  });

  it('defaults displayName to the root tag', () => {
    expect(createChannel('philosophy').displayName).toBe('philosophy');
  });

  it('accepts an explicit displayName', () => {
    expect(createChannel('philosophy', { displayName: 'Philosophy Chat' }).displayName).toBe(
      'Philosophy Chat',
    );
  });

  it('throws on an invalid root tag or local taxonomy entry', () => {
    expect(() => createChannel('..bad')).toThrow();
    expect(() => createChannel('philosophy', { localTaxonomy: ['..bad'] })).toThrow();
  });
});

describe('matchesChannel', () => {
  const channel = createChannel('philosophy', { localTaxonomy: ['epistemology'] });

  it('matches the bare root tag', () => {
    expect(matchesChannel('philosophy', channel)).toBe(true);
  });

  it('matches a subtag of the root, per the normal prefix rule (§6.3) — no local taxonomy needed', () => {
    expect(matchesChannel('philosophy.epistemology', channel)).toBe(true);
    expect(matchesChannel('philosophy.logic', createChannel('philosophy'))).toBe(true);
  });

  it('matches a local taxonomy component anywhere it appears, including under a different parent', () => {
    expect(matchesChannel('epistemology', channel)).toBe(true);
    expect(matchesChannel('psychology.epistemology', channel)).toBe(true);
  });

  it('does not match an unrelated tag', () => {
    expect(matchesChannel('cooking', channel)).toBe(false);
  });

  it('a channel with no local taxonomy only matches the root and its subtags', () => {
    const bare = createChannel('philosophy');
    expect(matchesChannel('epistemology', bare)).toBe(false);
  });
});

describe('postMatchesChannel', () => {
  const channel = createChannel('philosophy');

  it('matches if any of the post\u2019s tags match the channel', () => {
    expect(postMatchesChannel(['cooking', 'philosophy.logic'], channel)).toBe(true);
  });

  it('does not match a post with no matching tags', () => {
    expect(postMatchesChannel(['cooking', 'gardening'], channel)).toBe(false);
  });

  it('does not match an untagged post', () => {
    expect(postMatchesChannel([], channel)).toBe(false);
  });
});

describe('suggestCrossHierarchyInclusions (ratings.md §6.5)', () => {
  const channel = createChannel('philosophy');

  it('suggests a component seen under the root when it also appears bare elsewhere in the corpus', () => {
    const corpus = [
      ['philosophy.epistemology'],
      ['philosophy.epistemology'],
      ['epistemology'], // bare, elsewhere
    ];
    const suggestions = suggestCrossHierarchyInclusions(channel, corpus);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ component: 'epistemology' });
  });

  it('suggests a component that appears under a *different* parent elsewhere', () => {
    const corpus = [['philosophy.epistemology'], ['psychology.epistemology']];
    const suggestions = suggestCrossHierarchyInclusions(channel, corpus);
    expect(suggestions.map((s) => s.component)).toEqual(['epistemology']);
  });

  it('does not suggest a component that only ever appears under the channel\u2019s own root', () => {
    const corpus = [['philosophy.epistemology'], ['philosophy.epistemology']];
    expect(suggestCrossHierarchyInclusions(channel, corpus)).toEqual([]);
  });

  it('does not suggest a component already in the local taxonomy', () => {
    const already = createChannel('philosophy', { localTaxonomy: ['epistemology'] });
    const corpus = [['philosophy.epistemology'], ['epistemology']];
    expect(suggestCrossHierarchyInclusions(already, corpus)).toEqual([]);
  });

  it('respects an explicit exclusion list (e.g. previously dismissed suggestions)', () => {
    const corpus = [['philosophy.epistemology'], ['epistemology']];
    expect(suggestCrossHierarchyInclusions(channel, corpus, { exclude: ['epistemology'] })).toEqual(
      [],
    );
  });

  it('extracts only the immediate child component, not a deeper descendant', () => {
    const corpus = [['philosophy.epistemology.reliabilism'], ['epistemology']];
    const suggestions = suggestCrossHierarchyInclusions(channel, corpus);
    expect(suggestions.map((s) => s.component)).toEqual(['epistemology']);
  });

  it('does not suggest the root tag\u2019s own bare form or unrelated components', () => {
    const corpus = [['philosophy'], ['cooking']];
    expect(suggestCrossHierarchyInclusions(channel, corpus)).toEqual([]);
  });

  it('does not suggest a component found "elsewhere" that is itself excluded', () => {
    const already = createChannel('philosophy', { localTaxonomy: ['epistemology'] });
    // 'epistemology' appears under a different parent too, but it's already
    // in the local taxonomy, so it must not resurface as a candidate.
    const corpus = [['psychology.epistemology']];
    expect(suggestCrossHierarchyInclusions(already, corpus)).toEqual([]);
  });

  it('does not suggest a component from a tag that mentions the root as a middle component', () => {
    // 'cooking.philosophy.ethics' has 'philosophy' as neither its first nor
    // last component, so it isn't "under the root" (no prefix match) — but
    // it does still relate to philosophy, so its last component ('ethics')
    // should not count as found "elsewhere", unrelated to this channel.
    const corpus = [['philosophy.epistemology'], ['cooking.philosophy.ethics']];
    expect(suggestCrossHierarchyInclusions(channel, corpus).map((s) => s.component)).not.toContain(
      'ethics',
    );
  });

  it('does not treat the channel\u2019s own root tag as a candidate when it is some other tag\u2019s last component', () => {
    // 'other.philosophy' ends in the component 'philosophy', which is this
    // channel's own root — suggesting it back to itself would be circular.
    const corpus = [['philosophy.epistemology'], ['other.philosophy']];
    expect(suggestCrossHierarchyInclusions(channel, corpus).map((s) => s.component)).not.toContain(
      'philosophy',
    );
  });

  it('records example tags from both sides, for display', () => {
    const corpus = [['philosophy.epistemology'], ['psychology.epistemology']];
    const [suggestion] = suggestCrossHierarchyInclusions(channel, corpus);
    expect(suggestion?.observedUnderRoot).toEqual(['philosophy.epistemology']);
    expect(suggestion?.observedElsewhere).toEqual(['psychology.epistemology']);
  });

  it('states the exact scope in the disclosure, per §6.5\u2019s required wording', () => {
    const corpus = [['philosophy.epistemology'], ['epistemology']];
    const [suggestion] = suggestCrossHierarchyInclusions(channel, corpus);
    expect(suggestion?.disclosure).toContain('philosophy.epistemology');
    expect(suggestion?.disclosure).toContain('epistemology');
    expect(suggestion?.disclosure.toLowerCase()).toContain('all posts');
    expect(suggestion?.disclosure.toLowerCase()).toContain('anywhere');
  });

  it('is deterministically ordered (by component name) regardless of corpus order', () => {
    const corpus = [
      ['philosophy.psychiatry'],
      ['psychiatry'],
      ['philosophy.epistemology'],
      ['epistemology'],
    ];
    const suggestions = suggestCrossHierarchyInclusions(channel, corpus);
    expect(suggestions.map((s) => s.component)).toEqual(['epistemology', 'psychiatry']);
  });

  it('returns nothing for an empty corpus', () => {
    expect(suggestCrossHierarchyInclusions(channel, [])).toEqual([]);
  });
});

describe('discoverTopLevelTags (ratings.md §6.5, "Top-level discovery")', () => {
  it('ranks root components by frequency, most common first', () => {
    const corpus = [
      ['philosophy.epistemology'],
      ['philosophy.logic'],
      ['cooking'],
      ['philosophy.ethics'],
    ];
    expect(discoverTopLevelTags(corpus)).toEqual(['philosophy', 'cooking']);
  });

  it('counts a root component once per post, even with multiple matching tags on one post', () => {
    // Both posts contribute count 1 to their root ('philosophy' from one
    // post with two philosophy-rooted tags, 'cooking' from the other) — if
    // the two tags on the first post were wrongly double-counted,
    // 'philosophy' would outrank 'cooking' instead of tying and falling to
    // the alphabetical tie-break.
    const corpus = [['philosophy.a', 'philosophy.b'], ['cooking']];
    expect(discoverTopLevelTags(corpus)).toEqual(['cooking', 'philosophy']);
  });

  it('breaks ties alphabetically for a deterministic order', () => {
    expect(discoverTopLevelTags([['zoology'], ['art']])).toEqual(['art', 'zoology']);
  });

  it('respects an optional limit', () => {
    const corpus = [['a'], ['a'], ['b'], ['c']];
    expect(discoverTopLevelTags(corpus, { limit: 2 })).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty corpus', () => {
    expect(discoverTopLevelTags([])).toEqual([]);
  });
});

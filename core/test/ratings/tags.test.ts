import { describe, expect, it } from 'vitest';
import {
  isValidTag,
  matchesTagQuery,
  normalizeTag,
  tagComponents,
} from '../../src/ratings/tags.js';

describe('normalizeTag — flat tags (ratings.md §6.1)', () => {
  // The exact worked examples given in the spec's §6.1 table.
  it.each([
    ['Funny', 'funny'],
    ['Science Fiction', 'science-fiction'],
    ['#cat', 'cat'],
    ['C++', 'c'],
    ['well-being', 'well-being'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeTag(input)).toBe(expected);
  });

  it('strips characters that are Unicode symbols rather than punctuation (the "C++" case)', () => {
    // U+002B PLUS SIGN and U+003D EQUALS SIGN are general category Sm
    // (Symbol, math), not P* (Punctuation) — a naive `\p{P}`-only strip
    // would leave them behind. Per the spec's own "C++" → "c" example,
    // stripped symbols are *deleted*, not replaced with a hyphen (only
    // whitespace becomes a hyphen — step 5 is specifically about
    // whitespace runs) — so adjacent letters simply close up.
    expect(normalizeTag('A+B=C')).toBe('abc');
  });

  it('collapses runs of whitespace to a single hyphen', () => {
    expect(normalizeTag('a   b')).toBe('a-b');
  });

  it('collapses runs of hyphens to a single hyphen', () => {
    expect(normalizeTag('a---b')).toBe('a-b');
  });

  it('strips leading and trailing hyphens introduced by edge whitespace/punctuation', () => {
    expect(normalizeTag('  cat  ')).toBe('cat');
    expect(normalizeTag('-cat-')).toBe('cat');
    expect(normalizeTag('!!!cat!!!')).toBe('cat');
  });

  it('preserves non-Latin scripts rather than stripping them (ratings.md §8.2 direction)', () => {
    // Cyrillic, with no case distinction issue here since already lowercase-able.
    expect(normalizeTag('Кот')).toBe('кот');
    // CJK: no case to fold, should pass through unchanged (modulo NFKC).
    expect(normalizeTag('哲学')).toBe('哲学');
    // A non-Latin phrase with a space, to confirm whitespace→hyphen still
    // applies regardless of script.
    expect(normalizeTag('哲学 討論')).toBe('哲学-討論');
  });

  it('applies NFKC normalization (compatibility decomposition)', () => {
    // U+FF21 FULLWIDTH LATIN CAPITAL LETTER A decomposes under NFKC to
    // U+0041 LATIN CAPITAL LETTER A, which then lowercases to "a".
    expect(normalizeTag('\uFF21\uFF22\uFF23')).toBe('abc');
  });

  it('throws when a tag normalizes to the empty string', () => {
    expect(() => normalizeTag('!!!')).toThrow();
    expect(() => normalizeTag('   ')).toThrow();
    expect(() => normalizeTag('')).toThrow();
  });
});

describe('normalizeTag — hierarchical tags (ratings.md §6.2)', () => {
  it.each([
    ['Philosophy.Epistemology', 'philosophy.epistemology'],
    ['Science Fiction.Hard SF', 'science-fiction.hard-sf'],
    ['#philosophy.epistemology.reliabilism', 'philosophy.epistemology.reliabilism'],
  ])('normalizes %j to %j', (input, expected) => {
    expect(normalizeTag(input)).toBe(expected);
  });

  it('treats hyphens as having no hierarchical significance (distinct from dots)', () => {
    // ratings.md §6.2: "#philosophy-basement is a flat tag... #philosophy.basement
    // is a tag asserting that basement is a subtopic of philosophy."
    expect(normalizeTag('philosophy-basement')).toBe('philosophy-basement');
    expect(tagComponents(normalizeTag('philosophy-basement'))).toEqual(['philosophy-basement']);
    expect(tagComponents(normalizeTag('philosophy.basement'))).toEqual(['philosophy', 'basement']);
  });

  it('rejects leading dots', () => {
    expect(() => normalizeTag('.philosophy')).toThrow();
  });

  it('rejects trailing dots', () => {
    expect(() => normalizeTag('philosophy.')).toThrow();
  });

  it('rejects consecutive dots', () => {
    expect(() => normalizeTag('philosophy..epistemology')).toThrow();
  });

  it('rejects a tag where any single component normalizes to empty', () => {
    // "philosophy.!!!" — the second component has nothing left after
    // normalization, which must invalidate the whole tag, not silently
    // drop that component.
    expect(() => normalizeTag('philosophy.!!!')).toThrow();
  });

  it('supports arbitrary depth', () => {
    expect(normalizeTag('A.B.C.D.E')).toBe('a.b.c.d.e');
  });
});

describe('isValidTag', () => {
  it('returns true for valid tags without throwing', () => {
    expect(isValidTag('philosophy.epistemology')).toBe(true);
  });

  it('returns false (not throwing) for invalid tags', () => {
    expect(isValidTag('')).toBe(false);
    expect(isValidTag('.leading')).toBe(false);
    expect(isValidTag('a..b')).toBe(false);
  });
});

describe('tagComponents', () => {
  it('splits a normalized tag into its dot-separated components', () => {
    expect(tagComponents('philosophy.epistemology.reliabilism')).toEqual([
      'philosophy',
      'epistemology',
      'reliabilism',
    ]);
  });

  it('returns a single-element array for a flat tag', () => {
    expect(tagComponents('philosophy')).toEqual(['philosophy']);
  });
});

describe('matchesTagQuery — search semantics (ratings.md §6.3)', () => {
  // The exact three worked examples from §6.3, plus the general rule they
  // illustrate: a single-component query matches that component at ANY
  // position in the tag's hierarchy; a multi-component query matches only
  // as a prefix anchored at the tag's root.

  it('a single-component query matches the bare tag', () => {
    expect(matchesTagQuery('philosophy', 'philosophy')).toBe(true);
  });

  it('a single-component query matches a deeper tag containing it as any component', () => {
    expect(matchesTagQuery('philosophy.epistemology', 'philosophy')).toBe(true);
    expect(matchesTagQuery('philosophy.epistemology.reliabilism', 'philosophy')).toBe(true);
  });

  it('a single-component query matches the same component under a DIFFERENT parent', () => {
    // §6.3: "A search for #epistemology matches ... #philosophy.epistemology,
    // #psychology.epistemology, and any other tag with epistemology as a component."
    expect(matchesTagQuery('philosophy.epistemology', 'epistemology')).toBe(true);
    expect(matchesTagQuery('psychology.epistemology', 'epistemology')).toBe(true);
  });

  it('a single-component query matches a component at any depth, not just the leaf', () => {
    expect(matchesTagQuery('philosophy.epistemology.reliabilism', 'epistemology')).toBe(true);
    expect(matchesTagQuery('philosophy.epistemology.reliabilism', 'reliabilism')).toBe(true);
  });

  it('a multi-component query matches as a root-anchored prefix, and its own extensions', () => {
    expect(matchesTagQuery('philosophy.epistemology', 'philosophy.epistemology')).toBe(true);
    expect(matchesTagQuery('philosophy.epistemology.reliabilism', 'philosophy.epistemology')).toBe(
      true,
    );
  });

  it('a multi-component query does NOT match a tag with the same leaf under a different parent', () => {
    // The spec's key disambiguating example: searching philosophy.epistemology
    // must NOT match psychology.epistemology.
    expect(matchesTagQuery('psychology.epistemology', 'philosophy.epistemology')).toBe(false);
  });

  it('a multi-component query does NOT match the bare leaf component alone', () => {
    expect(matchesTagQuery('epistemology', 'philosophy.epistemology')).toBe(false);
  });

  it('a multi-component query does not match when it is not anchored at the root', () => {
    // philosophy.epistemology is not a *prefix* of music.philosophy.epistemology
    // (which starts with "music"), even though it appears as a sub-sequence.
    expect(matchesTagQuery('music.philosophy.epistemology', 'philosophy.epistemology')).toBe(false);
  });

  it('a tag shorter than a multi-component query never matches', () => {
    expect(matchesTagQuery('philosophy', 'philosophy.epistemology')).toBe(false);
  });

  it('an unrelated tag does not match', () => {
    expect(matchesTagQuery('cooking', 'philosophy')).toBe(false);
  });

  describe('exact mode', () => {
    it('matches only the precise tag string, not sub-components', () => {
      expect(matchesTagQuery('philosophy.epistemology', 'philosophy', { exact: true })).toBe(false);
      expect(
        matchesTagQuery('philosophy.epistemology', 'philosophy.epistemology', { exact: true }),
      ).toBe(true);
    });
  });
});

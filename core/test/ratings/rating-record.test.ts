import { describe, expect, it } from 'vitest';
import { generateKeypair } from '../../src/identity/keypair.js';
import {
  createRatingRecord,
  isValidRatingRecord,
  supersedes,
  validateRatingRecord,
} from '../../src/ratings/rating-record.js';

const RATER = generateKeypair(new Uint8Array(32).fill(1));

// Appendix B's worked example (§2.1's schema example is a template with
// placeholders, not a concrete instance — this is drawn from Appendix B
// instead, which gives concrete values): "Alice rated Bob's post X: True +1"
const CONCRETE_EXAMPLE = {
  neusnet_version: 1,
  type: 'rating',
  rater: 'nid1alice...',
  item: 'ipfs://post-x',
  item_type: 'post',
  ratings: { true: 1 },
  timestamp: 1740000000,
  public: true,
  signature: 'sig1abc...',
};

describe('validateRatingRecord', () => {
  it('accepts a well-formed record', () => {
    expect(() => validateRatingRecord(CONCRETE_EXAMPLE)).not.toThrow();
  });

  it('accepts an empty ratings map as a valid retraction (§2.3)', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, ratings: {} })).not.toThrow();
  });

  it('accepts a record with no signature (unsigned, e.g. in-progress or local-only)', () => {
    const { signature: _s, ...unsigned } = CONCRETE_EXAMPLE;
    expect(() => validateRatingRecord(unsigned)).not.toThrow();
  });

  it.each(['post', 'user', 'tag'])('accepts item_type %j', (item_type) => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, item_type })).not.toThrow();
  });

  it('rejects a wrong neusnet_version', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, neusnet_version: 2 })).toThrow();
  });

  it('rejects a non-string signature when present', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, signature: 42 })).toThrow();
  });

  it('rejects an invalid item_type', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, item_type: 'comment' })).toThrow();
  });

  it('rejects a missing rater', () => {
    const { rater: _r, ...rest } = CONCRETE_EXAMPLE;
    expect(() => validateRatingRecord(rest)).toThrow();
  });

  it('rejects an empty item', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, item: '' })).toThrow();
  });

  it('rejects a missing ratings map', () => {
    const { ratings: _rt, ...rest } = CONCRETE_EXAMPLE;
    expect(() => validateRatingRecord(rest)).toThrow();
  });

  it('rejects a ratings value outside [-1, +1]', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, ratings: { true: 1.5 } })).toThrow();
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, ratings: { true: -1.1 } })).toThrow();
  });

  it('accepts boundary values -1, 0, and +1', () => {
    for (const v of [-1, 0, 1]) {
      expect(() =>
        validateRatingRecord({ ...CONCRETE_EXAMPLE, ratings: { true: v } }),
      ).not.toThrow();
    }
  });

  it('rejects a non-numeric rating value', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, ratings: { true: '1' } })).toThrow();
  });

  it('accepts arbitrary, non-core dimension names (§1.2: communities may define additional dimensions)', () => {
    expect(() =>
      validateRatingRecord({ ...CONCRETE_EXAMPLE, ratings: { spiciness: 0.7 } }),
    ).not.toThrow();
  });

  it('rejects a missing public field', () => {
    const { public: _p, ...rest } = CONCRETE_EXAMPLE;
    expect(() => validateRatingRecord(rest)).toThrow();
  });

  it('rejects a non-boolean public field', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, public: 'yes' })).toThrow();
  });

  it('rejects a non-integer timestamp', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, timestamp: 1.5 })).toThrow();
  });

  it('rejects a wrong type value', () => {
    expect(() => validateRatingRecord({ ...CONCRETE_EXAMPLE, type: 'post' })).toThrow();
  });

  it('rejects null and non-object input', () => {
    expect(() => validateRatingRecord(null)).toThrow();
    expect(() => validateRatingRecord('nope')).toThrow();
  });
});

describe('isValidRatingRecord', () => {
  it('returns true/false without throwing', () => {
    expect(isValidRatingRecord(CONCRETE_EXAMPLE)).toBe(true);
    expect(isValidRatingRecord(null)).toBe(false);
  });
});

describe('createRatingRecord', () => {
  it('produces a record that validateRatingRecord accepts (round-trip)', () => {
    const created = createRatingRecord(
      {
        rater: 'nid1placeholder',
        item: 'ipfs://some-post',
        item_type: 'post',
        ratings: { true: 1, good: 0.5 },
        timestamp: 1740000000,
        public: true,
      },
      RATER.secretKey,
    );
    expect(() => validateRatingRecord(created)).not.toThrow();
  });

  it('sets neusnet_version and type automatically', () => {
    const created = createRatingRecord(
      {
        rater: 'nid1x',
        item: 'ipfs://y',
        item_type: 'post',
        ratings: { true: 1 },
        timestamp: 1,
        public: true,
      },
      RATER.secretKey,
    );
    expect(created.neusnet_version).toBe(1);
    expect(created.type).toBe('rating');
  });

  it('rejects input that would produce an invalid record (e.g. out-of-range rating)', () => {
    expect(() =>
      createRatingRecord(
        {
          rater: 'nid1x',
          item: 'ipfs://y',
          item_type: 'post',
          ratings: { true: 2 },
          timestamp: 1,
          public: true,
        },
        RATER.secretKey,
      ),
    ).toThrow();
  });
});

describe('supersedes — updating and retracting ratings (§2.3)', () => {
  const older = validateRatingRecord({ ...CONCRETE_EXAMPLE, timestamp: 100 });
  const newer = validateRatingRecord({ ...CONCRETE_EXAMPLE, timestamp: 200 });
  const differentItem = validateRatingRecord({
    ...CONCRETE_EXAMPLE,
    timestamp: 200,
    item: 'ipfs://different-post',
  });
  const differentRater = validateRatingRecord({
    ...CONCRETE_EXAMPLE,
    timestamp: 200,
    rater: 'nid1someone-else',
  });
  const differentItemType = validateRatingRecord({
    ...CONCRETE_EXAMPLE,
    timestamp: 200,
    item_type: 'user',
  });

  it('a newer record supersedes an older one for the same (rater, item, item_type)', () => {
    expect(supersedes(newer, older)).toBe(true);
  });

  it('an older record does not supersede a newer one', () => {
    expect(supersedes(older, newer)).toBe(false);
  });

  it('records for a different item do not supersede each other, regardless of timestamp', () => {
    expect(supersedes(differentItem, older)).toBe(false);
  });

  it('records from a different rater do not supersede each other', () => {
    expect(supersedes(differentRater, older)).toBe(false);
  });

  it('records with a different item_type do not supersede each other (same item string, different type)', () => {
    expect(supersedes(differentItemType, older)).toBe(false);
  });

  it('a record never supersedes itself (equal timestamps)', () => {
    const record = validateRatingRecord(CONCRETE_EXAMPLE);
    expect(supersedes(record, record)).toBe(false);
  });
});

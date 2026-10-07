import { describe, expect, it } from 'vitest';
import {
  isValidRatingCollection,
  validateRatingCollection,
} from '../../src/ratings/rating-collection.js';

const RECORD = {
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

describe('validateRatingCollection', () => {
  it('accepts a well-formed collection, per the §7 schema', () => {
    const collection = {
      neusnet_version: 1,
      type: 'rating_collection',
      owner: 'nid1alice...',
      generated: 1740001000,
      records: [RECORD],
      cached: [],
    };
    expect(() => validateRatingCollection(collection)).not.toThrow();
  });

  it('accepts empty records and cached arrays', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1740001000,
        records: [],
        cached: [],
      }),
    ).not.toThrow();
  });

  it('rejects a wrong neusnet_version', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 2,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1,
        records: [],
        cached: [],
      }),
    ).toThrow();
  });

  it('rejects a wrong type value', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating',
        owner: 'nid1alice...',
        generated: 1,
        records: [],
        cached: [],
      }),
    ).toThrow();
  });

  it('rejects a missing owner', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        generated: 1,
        records: [],
        cached: [],
      }),
    ).toThrow();
  });

  it('rejects a non-integer generated timestamp', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1.5,
        records: [],
        cached: [],
      }),
    ).toThrow();
  });

  it('rejects records containing an invalid rating record', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1,
        records: [{ ...RECORD, ratings: { true: 5 } }],
        cached: [],
      }),
    ).toThrow();
  });

  it('rejects cached containing an invalid rating record', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1,
        records: [],
        cached: [{ ...RECORD, item: '' }],
      }),
    ).toThrow();
  });

  it('rejects a missing records array', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1,
        cached: [],
      }),
    ).toThrow();
  });

  it('rejects a missing cached array', () => {
    expect(() =>
      validateRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1,
        records: [],
      }),
    ).toThrow();
  });

  it('rejects null and non-object input', () => {
    expect(() => validateRatingCollection(null)).toThrow();
    expect(() => validateRatingCollection('nope')).toThrow();
  });
});

describe('isValidRatingCollection', () => {
  it('returns true/false without throwing', () => {
    expect(
      isValidRatingCollection({
        neusnet_version: 1,
        type: 'rating_collection',
        owner: 'nid1alice...',
        generated: 1,
        records: [],
        cached: [],
      }),
    ).toBe(true);
    expect(isValidRatingCollection(null)).toBe(false);
  });
});

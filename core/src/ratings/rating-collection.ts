import { validateRatingRecord, type RatingRecord } from './rating-record.js';

/** A rating record collection wrapper, per ratings.md §7. */
export interface RatingCollection {
  neusnet_version: 1;
  type: 'rating_collection';
  owner: string;
  generated: number;
  /** The owner's own public rating records, in ascending timestamp order. */
  records: RatingRecord[];
  /** Cached copies of rating records retrieved from the owner's peers. */
  cached: RatingRecord[];
}

function fail(message: string): never {
  throw new Error(`validateRatingCollection: ${message}`);
}

function validateRecordArray(value: unknown, fieldName: string): RatingRecord[] {
  if (!Array.isArray(value)) {
    fail(`"${fieldName}" is required and must be an array`);
  }
  return value.map((entry: unknown) => {
    try {
      return validateRatingRecord(entry);
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new Error(`"${fieldName}" contains an invalid rating record: ${reason}`, { cause: e });
    }
  });
}

/**
 * Validate and return a rating collection object per ratings.md §7.
 */
export function validateRatingCollection(value: unknown): RatingCollection {
  if (typeof value !== 'object' || value === null) {
    fail(`expected an object, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;

  if (obj.neusnet_version !== 1) {
    fail(`"neusnet_version" must be 1, got ${JSON.stringify(obj.neusnet_version)}`);
  }
  if (obj.type !== 'rating_collection') {
    fail(`"type" must be "rating_collection", got ${JSON.stringify(obj.type)}`);
  }
  if (typeof obj.owner !== 'string' || obj.owner.length === 0) {
    fail('"owner" is required and must be a non-empty string');
  }
  if (typeof obj.generated !== 'number' || !Number.isInteger(obj.generated)) {
    fail(`"generated" is required and must be an integer, got ${JSON.stringify(obj.generated)}`);
  }

  const records = validateRecordArray(obj.records, 'records');
  const cached = validateRecordArray(obj.cached, 'cached');

  return {
    neusnet_version: 1,
    type: 'rating_collection',
    owner: obj.owner,
    generated: obj.generated,
    records,
    cached,
  };
}

/** Check whether a value is a valid rating collection, without throwing. */
export function isValidRatingCollection(value: unknown): value is RatingCollection {
  try {
    validateRatingCollection(value);
    return true;
  } catch {
    return false;
  }
}

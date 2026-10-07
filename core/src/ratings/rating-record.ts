import { signObject } from '../identity/signing.js';

/** The item type a rating record targets (ratings.md §2.1). */
export type ItemType = 'post' | 'user' | 'tag';

/** A rating record (ratings.md §2.1). */
export interface RatingRecord {
  neusnet_version: 1;
  type: 'rating';
  rater: string;
  item: string;
  item_type: ItemType;
  ratings: Record<string, number>;
  timestamp: number;
  public: boolean;
  signature?: string;
}

/**
 * The four recommended default rating dimensions (ratings.md §1.2).
 * Conventional, not protocol-enforced — `ratings.md` is explicit that
 * "additional dimensions may be defined by communities or individual
 * clients," so {@link validateRatingRecord} does not restrict dimension
 * names to this set.
 */
export const CORE_DIMENSIONS = ['true', 'good', 'important', 'new'] as const;

const ITEM_TYPES: readonly ItemType[] = ['post', 'user', 'tag'];

function fail(message: string): never {
  throw new Error(`validateRatingRecord: ${message}`);
}

/**
 * Validate and return a rating record per ratings.md §2.1.
 *
 * Performs shape/type validation only — it does not check `signature`
 * against any key (see `src/identity/signing.ts`'s `verifyObject` for
 * that) and does not implement update/supersession semantics (see
 * {@link supersedes} for that).
 */
export function validateRatingRecord(value: unknown): RatingRecord {
  if (typeof value !== 'object' || value === null) {
    fail(`expected an object, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;

  if (obj.neusnet_version !== 1) {
    fail(`"neusnet_version" must be 1, got ${JSON.stringify(obj.neusnet_version)}`);
  }
  if (obj.type !== 'rating') {
    fail(`"type" must be "rating", got ${JSON.stringify(obj.type)}`);
  }
  if (typeof obj.rater !== 'string' || obj.rater.length === 0) {
    fail('"rater" is required and must be a non-empty string');
  }
  if (typeof obj.item !== 'string' || obj.item.length === 0) {
    fail('"item" is required and must be a non-empty string');
  }
  if (typeof obj.item_type !== 'string' || !ITEM_TYPES.includes(obj.item_type as ItemType)) {
    fail(
      `"item_type" must be one of ${JSON.stringify(ITEM_TYPES)}, got ${JSON.stringify(obj.item_type)}`,
    );
  }

  if (typeof obj.ratings !== 'object' || obj.ratings === null || Array.isArray(obj.ratings)) {
    fail('"ratings" is required and must be an object (a map from dimension name to value)');
  }
  const ratings = obj.ratings as Record<string, unknown>;
  for (const [dimension, v] of Object.entries(ratings)) {
    if (typeof v !== 'number' || v < -1 || v > 1 || Number.isNaN(v)) {
      fail(`"ratings.${dimension}" must be a number in [-1, +1], got ${JSON.stringify(v)}`);
    }
  }

  if (typeof obj.timestamp !== 'number' || !Number.isInteger(obj.timestamp)) {
    fail(`"timestamp" is required and must be an integer, got ${JSON.stringify(obj.timestamp)}`);
  }

  if (typeof obj.public !== 'boolean') {
    fail(`"public" is required and must be a boolean, got ${JSON.stringify(obj.public)}`);
  }

  if (obj.signature !== undefined && typeof obj.signature !== 'string') {
    fail(`"signature" must be a string when present, got ${JSON.stringify(obj.signature)}`);
  }

  const result: RatingRecord = {
    neusnet_version: 1,
    type: 'rating',
    rater: obj.rater,
    item: obj.item,
    item_type: obj.item_type as ItemType,
    ratings: ratings as Record<string, number>,
    timestamp: obj.timestamp,
    public: obj.public,
  };
  if (obj.signature !== undefined) result.signature = obj.signature;
  return result;
}

/** Check whether a value is a valid rating record, without throwing. */
export function isValidRatingRecord(value: unknown): value is RatingRecord {
  try {
    validateRatingRecord(value);
    return true;
  } catch {
    return false;
  }
}

/** Input to {@link createRatingRecord}. */
export interface CreateRatingRecordInput {
  rater: string;
  item: string;
  item_type: ItemType;
  /** A map from dimension name to value in [-1, +1]. Pass `{}` to retract a prior rating (§2.3). */
  ratings: Record<string, number>;
  /** Unix timestamp (seconds). Never defaulted internally — see createPostMetadata's doc comment in metadata/post.ts for why. */
  timestamp: number;
  public: boolean;
}

/**
 * Construct and sign a rating record per ratings.md §2.1 and identity.md
 * §4. The result is guaranteed to pass {@link validateRatingRecord}.
 */
export function createRatingRecord(
  input: CreateRatingRecordInput,
  secretKey: Uint8Array,
): RatingRecord & { signature: string } {
  const unsigned = {
    neusnet_version: 1 as const,
    type: 'rating' as const,
    rater: input.rater,
    item: input.item,
    item_type: input.item_type,
    ratings: input.ratings,
    timestamp: input.timestamp,
    public: input.public,
  };
  validateRatingRecord(unsigned);
  const signed = signObject(unsigned, secretKey);
  return validateRatingRecord(signed) as RatingRecord & { signature: string };
}

/**
 * Determine whether rating record `a` supersedes rating record `b`, per
 * ratings.md §2.3: the most recent record (by timestamp) for a given
 * `(rater, item, item_type)` tuple supersedes all earlier records for
 * that tuple. Records for a different tuple never supersede each other,
 * regardless of timestamp.
 */
export function supersedes(a: RatingRecord, b: RatingRecord): boolean {
  return (
    a.rater === b.rater &&
    a.item === b.item &&
    a.item_type === b.item_type &&
    a.timestamp > b.timestamp
  );
}

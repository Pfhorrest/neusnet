/**
 * Content reference objects, per metadata.md §4.
 */

/** A content reference object (metadata.md §4). */
export interface ContentReference {
  uri: string;
  mime_type?: string;
  size?: number;
  hash?: string;
  inline_content?: string;
}

const MIME_TYPE_SHAPE = /^[^/\s]+\/[^/\s]+$/;
// "algorithm:hexdigest" — e.g. "sha256:9f86d0...". The digest must be an
// even-length hex string (a whole number of bytes); the algorithm name is
// unconstrained beyond being non-empty (metadata.md §4 names sha256 and
// blake3 as recommended, but doesn't restrict the field to those two).
const HASH_SHAPE = /^[^:\s]+:([0-9a-fA-F]{2})+$/;

function fail(message: string): never {
  throw new Error(`validateContentReference: ${message}`);
}

/**
 * Validate and return a content reference object per metadata.md §4.
 *
 * @throws If `value` is not a well-formed content reference.
 */
export function validateContentReference(value: unknown): ContentReference {
  if (typeof value !== 'object' || value === null) {
    fail(`expected an object, got ${JSON.stringify(value)}`);
  }
  const obj = value as Record<string, unknown>;

  if (typeof obj.uri !== 'string' || obj.uri.length === 0) {
    fail('"uri" is required and must be a non-empty string');
  }

  if (obj.mime_type !== undefined) {
    if (typeof obj.mime_type !== 'string' || !MIME_TYPE_SHAPE.test(obj.mime_type)) {
      fail(
        `"mime_type" must be a string of the form "type/subtype", got ${JSON.stringify(obj.mime_type)}`,
      );
    }
  }

  if (obj.size !== undefined) {
    if (typeof obj.size !== 'number' || !Number.isInteger(obj.size) || obj.size < 0) {
      fail(`"size" must be a non-negative integer, got ${JSON.stringify(obj.size)}`);
    }
  }

  if (obj.hash !== undefined) {
    if (typeof obj.hash !== 'string' || !HASH_SHAPE.test(obj.hash)) {
      fail(
        `"hash" must be of the form "algorithm:hexdigest" with an even-length hex digest, got ${JSON.stringify(obj.hash)}`,
      );
    }
  }

  const isInline = obj.uri === 'inline:';
  if (isInline && typeof obj.inline_content !== 'string') {
    fail('"inline_content" is required (and must be a string) when "uri" is "inline:"');
  }
  if (!isInline && obj.inline_content !== undefined) {
    fail(
      '"inline_content" must be omitted when "uri" is not "inline:" (metadata.md §4: "present only when uri is inline:")',
    );
  }

  const result: ContentReference = { uri: obj.uri };
  if (obj.mime_type !== undefined) result.mime_type = obj.mime_type;
  if (obj.size !== undefined) result.size = obj.size;
  if (obj.hash !== undefined) result.hash = obj.hash;
  // Unlike mime_type/size/hash above, this cast is NOT redundant: the
  // validation above only checks `typeof obj.inline_content !== 'string'`
  // inside the `isInline` branch (a derived boolean), not as a direct
  // `obj.uri === 'inline:'` check at this point, so TS's flow analysis
  // can't connect the two and narrow this access on its own.
  if (obj.inline_content !== undefined) result.inline_content = obj.inline_content as string;
  return result;
}

/**
 * Check whether a value is a valid content reference, without throwing.
 */
export function isValidContentReference(value: unknown): value is ContentReference {
  try {
    validateContentReference(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * neusnet-core: reference implementation of the neusnet protocol's
 * substrate-independent core. Everything here is pure computation — no
 * network, storage, or UI.
 *
 * Modules are grouped by the layer of the specification they implement:
 * encoding and canonicalization (the byte-level plumbing), identity
 * (identity.md), metadata (metadata.md), and ratings (ratings.md).
 */

// Encoding and canonicalization
export { BASE58_ALPHABET, decodeBase58, encodeBase58 } from './encoding/base58.js';
export { decodeBase64Url, encodeBase64Url } from './encoding/base64url.js';
export { canonicalizeJson } from './canonicalization/jcs.js';

// Identity (identity.md)
export {
  NID1_PREFIX,
  decodeNid1,
  encodeNid1,
  generateKeypair,
  isValidNid1,
  type Keypair,
} from './identity/keypair.js';
export { bytesToSign, signObject, verifyObject } from './identity/signing.js';

// Post metadata (metadata.md)
export {
  isValidContentReference,
  validateContentReference,
  type ContentReference,
} from './metadata/content-reference.js';
export {
  UnrecognizedVersionError,
  computeTrustLevel,
  createPostMetadata,
  isValidPostMetadata,
  validatePostMetadata,
  type CreatePostMetadataInput,
  type PostMetadata,
  type TrustLevel,
} from './metadata/post.js';
export { contentIdentityMatches, contentReferencesMatch } from './metadata/content-identity.js';
export {
  buildVersionHistory,
  verifyNativeAuthorSignature,
  type AuthorSignatureVerifier,
  type BuildVersionHistoryInput,
  type VersionHistory,
} from './metadata/version-history.js';

// Ratings and the trust graph (ratings.md)
export {
  isValidTag,
  matchesTagQuery,
  normalizeTag,
  normalizeTagComponent,
  tagComponents,
  type MatchesTagQueryOptions,
} from './ratings/tags.js';
export {
  CORE_DIMENSIONS,
  createRatingRecord,
  isValidRatingRecord,
  supersedes,
  validateRatingRecord,
  type CreateRatingRecordInput,
  type ItemType,
  type RatingRecord,
} from './ratings/rating-record.js';
export {
  isValidRatingCollection,
  validateRatingCollection,
  type RatingCollection,
} from './ratings/rating-collection.js';
export {
  buildTrustGraph,
  compositeAffinity,
  confidence,
  derivedAffinity,
  directAffinity,
  effectiveAffinity,
  effectivePostScore,
  meetsVisibilityThreshold,
  resolveLatestRatings,
  type AffinityOptions,
  type BuildTrustGraphInput,
  type NodeType,
  type PostInfo,
  type TrustGraph,
} from './ratings/trust-graph.js';
export {
  aggregatePostRatings,
  buildTrustGraphFromPosts,
  type AggregatePostRatingsInput,
  type AggregatedPostRatings,
  type BuildTrustGraphFromPostsInput,
} from './ratings/aggregate.js';

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
export { BASE36_ALPHABET, decodeBase36, encodeBase36 } from './encoding/base36.js';
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
export {
  bytesToSign,
  signObject,
  verifyNativeSignature,
  verifyObject,
  type SignatureVerifier,
} from './identity/signing.js';
export {
  createIdentityDocument,
  createIdentityLink,
  isValidIdentityDocument,
  validateIdentityDocument,
  verifyIdentityDocument,
  verifyIdentityLink,
  verifyMutualLink,
  type CreateIdentityDocumentInput,
  type IdentityDocument,
  type IdentityLink,
  type ProfileLink,
  type VerifyOptions,
} from './identity/identity-document.js';
export {
  extractNeusnetIds,
  normalizeProfileUrl,
  verifyPlatformBinding,
  type PlatformBindingResult,
  type VerifyPlatformBindingInput,
} from './identity/platform-binding.js';
export {
  deriveIpnsName,
  endorsementListPath,
  identityDocumentPath,
  rotationDeclarationPath,
} from './identity/ipns.js';
export {
  applyIdentityMapping,
  computeIdentityMapping,
  computeLinkedClusters,
  type AggregationMode,
  type ApplyIdentityMappingInput,
  type LinkedCluster,
} from './identity/linked-clusters.js';
export {
  createRecoveryRotation,
  createStandardRotation,
  isValidKeyRotation,
  resolveIdentityChain,
  resolveSuccessor,
  validateKeyRotation,
  verifyKeyRotation,
  type IdentityChain,
  type KeyRotation,
  type RecoveryRotation,
  type RecoverySignature,
  type StandardRotation,
  type SuccessorResult,
  type VerifyKeyRotationOptions,
} from './identity/rotation.js';

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
  createEndorsementList,
  isValidEndorsementList,
  validateEndorsementList,
  verifyEndorsementList,
  type CreateEndorsementListInput,
  type EndorsementEntry,
  type EndorsementList,
  type VerifyEndorsementListOptions,
} from './hosting/endorsement-list.js';
export {
  createChannel,
  discoverTopLevelTags,
  matchesChannel,
  postMatchesChannel,
  suggestCrossHierarchyInclusions,
  type Channel,
  type CreateChannelOptions,
  type DiscoverTopLevelTagsOptions,
  type SuggestOptions,
  type SuggestionCandidate,
} from './ratings/channels.js';
export {
  aggregatePostRatings,
  buildTrustGraphFromPosts,
  type AggregatePostRatingsInput,
  type AggregatedPostRatings,
  type BuildTrustGraphFromPostsInput,
} from './ratings/aggregate.js';

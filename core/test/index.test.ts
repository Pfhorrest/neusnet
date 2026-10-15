import { describe, expect, it } from 'vitest';
import * as api from '../src/index.js';

// The package entry point must expose the public API. Types can't be checked
// at runtime, but every runtime export a user is documented to call can.
describe('public API (src/index.ts)', () => {
  const functions = [
    // encoding / canonicalization
    'encodeBase58',
    'decodeBase58',
    'encodeBase64Url',
    'decodeBase64Url',
    'canonicalizeJson',
    // identity
    'generateKeypair',
    'encodeNid1',
    'decodeNid1',
    'isValidNid1',
    'signObject',
    'verifyObject',
    'bytesToSign',
    'verifyNativeSignature',
    'createIdentityDocument',
    'createIdentityLink',
    'isValidIdentityDocument',
    'validateIdentityDocument',
    'verifyIdentityDocument',
    'verifyIdentityLink',
    'verifyMutualLink',
    'extractNeusnetIds',
    'normalizeProfileUrl',
    'verifyPlatformBinding',
    'applyIdentityMapping',
    'computeIdentityMapping',
    'computeLinkedClusters',
    'createRecoveryRotation',
    'createStandardRotation',
    'isValidKeyRotation',
    'resolveIdentityChain',
    'resolveSuccessor',
    'validateKeyRotation',
    'verifyKeyRotation',
    // metadata
    'validateContentReference',
    'isValidContentReference',
    'validatePostMetadata',
    'isValidPostMetadata',
    'createPostMetadata',
    'computeTrustLevel',
    'contentIdentityMatches',
    'contentReferencesMatch',
    'buildVersionHistory',
    'verifyNativeAuthorSignature',
    // ratings
    'normalizeTag',
    'normalizeTagComponent',
    'isValidTag',
    'tagComponents',
    'matchesTagQuery',
    'validateRatingRecord',
    'isValidRatingRecord',
    'createRatingRecord',
    'supersedes',
    'validateRatingCollection',
    'isValidRatingCollection',
    'buildTrustGraph',
    'resolveLatestRatings',
    'derivedAffinity',
    'directAffinity',
    'compositeAffinity',
    'confidence',
    'effectiveAffinity',
    'effectivePostScore',
    'meetsVisibilityThreshold',
    'aggregatePostRatings',
    'buildTrustGraphFromPosts',
  ] as const;

  it.each(functions)('exports the function %s', (name) => {
    expect(typeof (api as Record<string, unknown>)[name]).toBe('function');
  });

  it('exports its constants and error class', () => {
    expect(api.NID1_PREFIX).toBe('nid1');
    expect(api.BASE58_ALPHABET).toHaveLength(58);
    expect(api.CORE_DIMENSIONS).toEqual(['true', 'good', 'important', 'new']);
    expect(new api.UnrecognizedVersionError(2)).toBeInstanceOf(Error);
  });
});

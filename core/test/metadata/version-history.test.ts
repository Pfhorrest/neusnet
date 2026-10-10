import { describe, expect, it } from 'vitest';
import { validatePostMetadata, type PostMetadata } from '../../src/metadata/post.js';
import {
  buildVersionHistory,
  verifyNativeAuthorSignature,
} from '../../src/metadata/version-history.js';
import { A_ID, B, B_ID, I, POST_ID, known, version } from '../helpers/post-fixtures.js';

describe('verifyNativeAuthorSignature', () => {
  it('is true for a post signed by the key its author field names', () => {
    expect(verifyNativeAuthorSignature(version({ timestamp: 1 }))).toBe(true);
  });

  it('is false for a post signed by a different key (third-party attested)', () => {
    expect(verifyNativeAuthorSignature(version({ timestamp: 1, signer: I }))).toBe(false);
  });

  it('is false for an unsigned post', () => {
    expect(verifyNativeAuthorSignature(version({ timestamp: 1, signer: 'none' }))).toBe(false);
  });

  it('is false when the author is not a native nid1 identifier', () => {
    expect(
      verifyNativeAuthorSignature(version({ timestamp: 1, author: 'at://did:plc:abc', signer: I })),
    ).toBe(false);
  });

  it('is false for a signed post that has no author', () => {
    const signed = version({ timestamp: 1 });
    const { author: _author, ...withoutAuthor } = signed;
    expect(verifyNativeAuthorSignature(withoutAuthor)).toBe(false);
  });

  it('is false if the post was tampered with after signing', () => {
    const original = version({ timestamp: 1 });
    expect(verifyNativeAuthorSignature({ ...original, timestamp: 2 })).toBe(false);
  });
});

describe('buildVersionHistory — canonical chain', () => {
  it('walks a linear chain newest-first, from the current version back', () => {
    const v1 = version({ timestamp: 1 });
    const v2 = version({ timestamp: 2, previous: 'v1' });
    const v3 = version({ timestamp: 3, previous: 'v2' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v3',
      known: known({ v1, v2, v3 }),
    });
    expect(history.canonicalAuthor).toBe(A_ID);
    expect(history.canonical).toEqual(['v3', 'v2', 'v1']);
    expect(history.memoryHoled).toEqual([]);
    expect(history.thirdPartyIntroductions).toEqual([]);
    expect(history.unsignedCopies).toEqual([]);
    expect(history.falseClaimants).toEqual([]);
    expect(history.missing).toEqual([]);
  });

  it('records the id and current version it was built for', () => {
    const v1 = version({ timestamp: 1 });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1 }),
    });
    expect(history.id).toBe(POST_ID);
    expect(history.currentVersionId).toBe('v1');
  });

  it('a single, unedited post is its own one-entry history', () => {
    const v1 = version({ timestamp: 1 });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1 }),
    });
    expect(history.canonical).toEqual(['v1']);
  });

  it('reports a dangling `previous` link as missing and keeps what it could resolve', () => {
    const v2 = version({ timestamp: 2, previous: 'v1-not-fetched-yet' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v2',
      known: known({ v2 }),
    });
    expect(history.canonical).toEqual(['v2']);
    expect(history.missing).toEqual(['v1-not-fetched-yet']);
  });

  it('reports an unknown current version as missing, with nothing canonical', () => {
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v9',
      known: known({}),
    });
    expect(history.canonical).toEqual([]);
    expect(history.canonicalAuthor).toBeUndefined();
    expect(history.missing).toEqual(['v9']);
  });

  it('throws if the current version resolves to a file claiming a different id', () => {
    const other = version({ timestamp: 1, id: 'ipns://k51other' });
    expect(() =>
      buildVersionHistory({ id: POST_ID, currentVersionId: 'x', known: known({ x: other }) }),
    ).toThrow();
  });

  it('terminates on a `previous` cycle (hostile or corrupt data)', () => {
    // Content-addressed identifiers can't form a cycle, but data arriving
    // from the network can claim anything.
    const v1 = version({ timestamp: 1, previous: 'v2' });
    const v2 = version({ timestamp: 2, previous: 'v1' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v2',
      known: known({ v1, v2 }),
    });
    expect([...history.canonical].sort()).toEqual(['v1', 'v2']);
  });

  it('stops at, and does not follow the links of, a file claiming a different id', () => {
    const foreign = version({ timestamp: 1, id: 'ipns://k51other', previous: 'v0' });
    const v0 = version({ timestamp: 0 });
    const v2 = version({ timestamp: 2, previous: 'foreign' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v2',
      known: known({ foreign, v0, v2 }),
    });
    expect(history.canonical).toEqual(['v2']);
    // v0 does claim this id and is author-signed, but nothing in the chain
    // reaches it, so it is a memory-holed version rather than canonical.
    expect(history.memoryHoled).toEqual(['v0']);
  });
});

describe('buildVersionHistory — anomalous versions (metadata.md §5.2 table)', () => {
  it('memory-holed: an author-signed version of this id that a later version skips over', () => {
    const v1 = version({ timestamp: 1 });
    const v2 = version({ timestamp: 2, previous: 'v1' });
    const v3 = version({ timestamp: 3, previous: 'v1' }); // skips v2
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v3',
      known: known({ v1, v2, v3 }),
    });
    expect(history.canonical).toEqual(['v3', 'v1']);
    expect(history.memoryHoled).toEqual(['v2']);
  });

  it('third-party introduction: names the canonical author but is signed by someone else', () => {
    const v1 = version({ timestamp: 1 });
    const intro = version({ timestamp: 5, signer: I });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1, intro }),
    });
    expect(history.canonical).toEqual(['v1']);
    expect(history.thirdPartyIntroductions).toEqual(['intro']);
  });

  it('unsigned copy: names the canonical author but carries no signature', () => {
    const v1 = version({ timestamp: 1 });
    const copy = version({ timestamp: 5, signer: 'none' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1, copy }),
    });
    expect(history.unsignedCopies).toEqual(['copy']);
  });

  it('false claimant: a different author signed as themselves', () => {
    const v1 = version({ timestamp: 1 });
    const rival = version({ timestamp: 2, author: B_ID, signer: B });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1, rival }),
    });
    expect(history.canonical).toEqual(['v1']);
    expect(history.falseClaimants).toEqual(['rival']);
  });

  it('a file naming a different author is a false claimant however it is signed or not signed', () => {
    const v1 = version({ timestamp: 1 });
    const byIntroducer = version({ timestamp: 2, author: B_ID, signer: I });
    const unsigned = version({ timestamp: 3, author: B_ID, signer: 'none' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1, byIntroducer, unsigned }),
    });
    expect([...history.falseClaimants].sort()).toEqual(['byIntroducer', 'unsigned']);
  });

  it('ignores known files that claim a different id entirely', () => {
    const v1 = version({ timestamp: 1 });
    const unrelated = version({ timestamp: 2, id: 'ipns://k51other' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1, unrelated }),
    });
    expect(history.falseClaimants).toEqual([]);
    expect(history.memoryHoled).toEqual([]);
    expect(history.thirdPartyIntroductions).toEqual([]);
  });

  it('orders each anomaly list newest first, then by version identifier', () => {
    const v1 = version({ timestamp: 1 });
    const introB = version({ timestamp: 5, signer: I, content: [{ uri: 'ipfs://b' }] });
    const introA = version({ timestamp: 5, signer: I, content: [{ uri: 'ipfs://a' }] });
    const introNew = version({ timestamp: 9, signer: I, content: [{ uri: 'ipfs://n' }] });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1, introB, introA, introNew }),
    });
    expect(history.thirdPartyIntroductions).toEqual(['introNew', 'introA', 'introB']);
  });
});

describe('buildVersionHistory — current version is not itself author-signed', () => {
  it('finds the canonical author by walking `previous` back to an author-signed version', () => {
    const v1 = version({ timestamp: 1 });
    const copy = version({ timestamp: 2, signer: I, previous: 'v1' }); // current, third-party attested
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'copy',
      known: known({ v1, copy }),
    });
    expect(history.canonicalAuthor).toBe(A_ID);
    expect(history.canonical).toEqual(['v1']);
    // The current version is not canonical, so it is categorized like any
    // other file that isn't: here, a third-party introduction.
    expect(history.thirdPartyIntroductions).toEqual(['copy']);
  });

  it('keeps walking through a non-author-signed link, so a stray copy does not truncate the history', () => {
    const v1 = version({ timestamp: 1 });
    const stray = version({ timestamp: 2, signer: I, previous: 'v1' });
    const v3 = version({ timestamp: 3, previous: 'stray' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v3',
      known: known({ v1, stray, v3 }),
    });
    expect(history.canonical).toEqual(['v3', 'v1']);
    expect(history.thirdPartyIntroductions).toEqual(['stray']);
  });

  it('excludes a version signed by a different author from the chain even if the author links to it', () => {
    const v1 = version({ timestamp: 1 });
    const rival = version({ timestamp: 2, author: B_ID, signer: B, previous: 'v1' });
    const v3 = version({ timestamp: 3, previous: 'rival' });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v3',
      known: known({ v1, rival, v3 }),
    });
    expect(history.canonical).toEqual(['v3', 'v1']);
    expect(history.falseClaimants).toEqual(['rival']);
  });
});

describe('buildVersionHistory — no author-signed version exists (bridged posts)', () => {
  // The normal state of a bridged post before its author joins neusnet
  // (metadata.md §6.3): everything is a third-party introduction.
  const BLUESKY_AUTHOR = 'at://did:plc:abc123';
  const BRIDGED_ID = 'at://did:plc:abc123/app.bsky.feed.post/xyz';

  it('has no canonical author or chain, and anchors on the current version', () => {
    const intro = version({ id: BRIDGED_ID, author: BLUESKY_AUTHOR, signer: I, timestamp: 1 });
    const history = buildVersionHistory({
      id: BRIDGED_ID,
      currentVersionId: 'intro',
      known: known({ intro }),
    });
    expect(history.canonicalAuthor).toBeUndefined();
    expect(history.canonical).toEqual([]);
    // The anchor is not "anomalous": it is the version the id resolves to.
    expect(history.thirdPartyIntroductions).toEqual([]);
    expect(history.falseClaimants).toEqual([]);
  });

  it('categorizes other files against the current version\u2019s claimed author', () => {
    const intro = version({ id: BRIDGED_ID, author: BLUESKY_AUTHOR, signer: I, timestamp: 1 });
    const second = version({ id: BRIDGED_ID, author: BLUESKY_AUTHOR, signer: I, timestamp: 2 });
    const wrong = version({
      id: BRIDGED_ID,
      author: 'at://did:plc:someone-else',
      signer: I,
      timestamp: 3,
    });
    const history = buildVersionHistory({
      id: BRIDGED_ID,
      currentVersionId: 'intro',
      known: known({ intro, second, wrong }),
    });
    expect(history.thirdPartyIntroductions).toEqual(['second']);
    expect(history.falseClaimants).toEqual(['wrong']);
  });

  it('with no attribution on a competing file, that file is a false claimant', () => {
    const anchor = version({
      id: BRIDGED_ID,
      author: BLUESKY_AUTHOR,
      signer: 'none',
      timestamp: 1,
    });
    const bare: PostMetadata = {
      neusnet_version: 1,
      type: 'post',
      id: BRIDGED_ID,
      tags: [],
      content: [{ uri: 'https://example.com' }],
      timestamp: 2,
    };
    const history = buildVersionHistory({
      id: BRIDGED_ID,
      currentVersionId: 'anchor',
      known: known({ anchor, bare }),
    });
    // The anchor names an author, so `bare` (naming none) conflicts with it.
    expect(history.falseClaimants).toEqual(['bare']);
  });
});

describe('buildVersionHistory — pluggable author-signature verification', () => {
  // identity.md §2.1 lets authors use identity substrates whose signatures
  // this library can't check (AT Protocol DIDs, Nostr keys...). The caller
  // supplies the check for those.
  it('uses a caller-supplied verifier instead of the native one', () => {
    const DID = 'did:example:alice';
    const v1 = validatePostMetadata({
      neusnet_version: 1,
      type: 'post',
      id: POST_ID,
      author: DID,
      tags: [],
      content: [{ uri: 'ipfs://x' }],
      timestamp: 1,
      signature: 'substrate-signature-1',
    });
    const v2 = validatePostMetadata({
      neusnet_version: 1,
      type: 'post',
      id: POST_ID,
      author: DID,
      tags: [],
      content: [{ uri: 'ipfs://y' }],
      timestamp: 2,
      previous: 'v1',
      signature: 'substrate-signature-2',
    });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v2',
      known: known({ v1, v2 }),
      isAuthorSigned: (post) =>
        post.author === DID && post.signature?.startsWith('substrate-') === true,
    });
    expect(history.canonicalAuthor).toBe(DID);
    expect(history.canonical).toEqual(['v2', 'v1']);
  });

  it('with only the native verifier, a non-nid1 author never yields a canonical chain', () => {
    const v1 = version({ author: 'did:example:alice', signer: I, timestamp: 1 });
    const history = buildVersionHistory({
      id: POST_ID,
      currentVersionId: 'v1',
      known: known({ v1 }),
    });
    expect(history.canonical).toEqual([]);
  });
});

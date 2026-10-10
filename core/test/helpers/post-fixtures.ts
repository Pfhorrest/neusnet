import { encodeNid1, generateKeypair, type Keypair } from '../../src/identity/keypair.js';
import type { ContentReference } from '../../src/metadata/content-reference.js';
import {
  createPostMetadata,
  validatePostMetadata,
  type PostMetadata,
} from '../../src/metadata/post.js';

/** The true author of the posts under test. */
export const A: Keypair = generateKeypair(new Uint8Array(32).fill(101));
/** A rival author. */
export const B: Keypair = generateKeypair(new Uint8Array(32).fill(102));
/** An introducer — someone who signs metadata files on behalf of other authors. */
export const I: Keypair = generateKeypair(new Uint8Array(32).fill(103));

export const A_ID = encodeNid1(A.publicKey);
export const B_ID = encodeNid1(B.publicKey);
export const POST_ID = 'ipns://k51post';

export interface VersionOptions {
  id?: string;
  author?: string;
  /** Who signs: a keypair, or `'none'` for an unsigned file. Defaults to A (the default author's own key). */
  signer?: Keypair | 'none';
  previous?: string;
  timestamp: number;
  content?: ContentReference[];
}

/**
 * Build a metadata file with exactly the author/signer relationship a test
 * needs: author-signed (the default), signed by someone else (third-party
 * attested), or unsigned.
 */
export function version(opts: VersionOptions): PostMetadata {
  const id = opts.id ?? POST_ID;
  const author = opts.author ?? A_ID;
  const content = opts.content ?? [{ uri: `ipfs://content-${opts.timestamp}` }];
  const signer = opts.signer ?? A;
  if (signer === 'none') {
    return validatePostMetadata({
      neusnet_version: 1,
      type: 'post',
      id,
      author,
      tags: [],
      content,
      timestamp: opts.timestamp,
      ...(opts.previous !== undefined ? { previous: opts.previous } : {}),
    });
  }
  return createPostMetadata(
    {
      id,
      author,
      content,
      timestamp: opts.timestamp,
      ...(opts.previous !== undefined ? { previous: opts.previous } : {}),
    },
    signer.secretKey,
  );
}

/** Build the `known` map the version-history functions take, keyed by version identifier. */
export function known(entries: Record<string, PostMetadata>): Map<string, PostMetadata> {
  return new Map(Object.entries(entries));
}

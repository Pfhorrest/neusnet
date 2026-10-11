import {
  verifyIdentityDocument,
  type IdentityDocument,
  type SignatureVerifier,
} from './identity-document.js';
import { isValidNid1 } from './keypair.js';

/**
 * External platform identity binding (identity.md §2.2): anchoring an
 * account on a platform with no cryptographic identity (Reddit, a phpBB
 * forum...) to a neusnet key through *mutual attestation*. The account
 * publishes the key as a `[neusnet:nid1...]` token in its bio, and the
 * key's signed identity document lists the account's profile URL in
 * `links`. Either direction alone is just an unverified claim.
 *
 * This module is the pure half: given text and documents the caller has
 * already fetched, it decides what they prove. Fetching is not its job.
 */

// The Base58 (Bitcoin) alphabet, which excludes 0, O, I, and l.
const TOKEN = /\[neusnet:(nid1[1-9A-HJ-NP-Za-km-z]+)\]/g;

/**
 * Extract the neusnet identifiers a piece of profile text claims, from
 * `[neusnet:nid1...]` tokens. Returns each valid, distinct identifier once,
 * in order of first appearance; malformed tokens are ignored.
 *
 * **Only pass text that the account's owner controls** — a bio, or a post
 * the account owner designated for this purpose. A token appearing in a
 * *reply someone else wrote* proves nothing about the account it is
 * attached to, since anyone can type any token anywhere.
 */
export function extractNeusnetIds(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const id = match[1];
    if (id !== undefined && isValidNid1(id) && !found.includes(id)) found.push(id);
  }
  return found;
}

/**
 * A comparison form of a profile URL: the host's case, an explicit default
 * port, the fragment (never sent to a server), and a trailing slash on the
 * path are all insignificant; the scheme, path case, and query string are
 * significant. A string that is not a parseable URL is returned unchanged.
 */
export function normalizeProfileUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = '';
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  return parsed.href;
}

export type PlatformBindingResult =
  | { verified: true; id: string }
  | { verified: false; reason: 'no-token' | 'document-unverified' | 'url-not-linked' };

export interface VerifyPlatformBindingInput {
  /** The platform profile's URL. */
  profileUrl: string;
  /** Text the account's owner controls (see {@link extractNeusnetIds}). */
  profileText: string;
  /** The identity document for the key the caller is asking about. */
  identityDocument: IdentityDocument;
  /** Signature check for the identity document; defaults to the native `nid1` check. */
  verify?: SignatureVerifier;
}

/**
 * Whether an account is verifiably bound to a neusnet identity
 * (identity.md §2.2): the profile text carries a token for the document's
 * key, the document's own signature verifies, and the document lists the
 * profile's URL in `links`. Anything less is unverified, with the reason.
 */
export function verifyPlatformBinding(input: VerifyPlatformBindingInput): PlatformBindingResult {
  const { profileUrl, profileText, identityDocument } = input;

  if (!extractNeusnetIds(profileText).includes(identityDocument.id)) {
    return { verified: false, reason: 'no-token' };
  }
  if (
    !verifyIdentityDocument(identityDocument, input.verify ? { verify: input.verify } : undefined)
  ) {
    return { verified: false, reason: 'document-unverified' };
  }
  const wanted = normalizeProfileUrl(profileUrl);
  const linked = (identityDocument.links ?? []).some(
    (link) => normalizeProfileUrl(link.url) === wanted,
  );
  if (!linked) {
    return { verified: false, reason: 'url-not-linked' };
  }
  return { verified: true, id: identityDocument.id };
}

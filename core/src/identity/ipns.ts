import { encodeBase36 } from '../encoding/base36.js';

/**
 * IPNS name derivation and well-known paths (identity.md §5.3).
 *
 * This is the one piece of IPFS/libp2p-specific binary encoding in this
 * otherwise substrate-agnostic library: identity.md §5.3 specifies IPNS
 * names on IPFS deployments as derived from the user's Ed25519 public key
 * via the standard libp2p peer-ID-as-CID construction, and §6.3 and
 * hosting.md §8.1 both reference fixed paths under that name. Everything
 * else in this module is pure computation — no network I/O — matching the
 * rest of this library's scope.
 */

// libp2p crypto.proto's KeyType enum.
const ED25519_KEY_TYPE = 1;
// The libp2p-key multicodec, identifying a CID as a wrapped public key.
const LIBP2P_KEY_CODEC = 0x72;
const CIDV1_VERSION = 0x01;
// The "identity" multihash function: for inputs short enough (a published
// threshold in go-libp2p; the exact value doesn't matter here, since a
// 36-byte Ed25519 protobuf is well under it), libp2p wraps the payload
// directly, unhashed, tagged 0x00, rather than hashing it with SHA2-256 as
// it would for a longer key (e.g. RSA) — confirmed against the worked
// example below, not assumed. This library only ever produces Ed25519
// keys, so that SHA2-256 path is simply never exercised here.
const IDENTITY_MULTIHASH_CODE = 0x00;

/**
 * Encode a 32-byte Ed25519 public key as the libp2p `PublicKey` protobuf
 * message (`crypto.proto`: `{ required KeyType Type = 1; required bytes
 * Data = 2; }`), by hand — two fixed fields, not worth a protobuf library.
 */
function encodePublicKeyProtobuf(publicKey: Uint8Array): Uint8Array {
  // Field 1 (Type), wire type 0 (varint): tag 0x08, value 1.
  // Field 2 (Data), wire type 2 (length-delimited): tag 0x12, then the
  // length and the 32 raw bytes. Both lengths here (1, 32) fit in a single
  // varint byte, so no general varint encoder is needed.
  return new Uint8Array([0x08, ED25519_KEY_TYPE, 0x12, publicKey.length, ...publicKey]);
}

/**
 * Derive the IPNS name for a native neusnet identity from its Ed25519
 * public key (identity.md §5.3): the libp2p peer ID for that key,
 * expressed as a CIDv1 in its base36 multibase form — the conventional
 * display form for libp2p-key CIDs, chosen for being case-insensitive and
 * safe in a URL/DNS label, both relevant to `ipns://` addressing.
 *
 * Verified against an independently-sourced worked example — see
 * `test/identity/ipns.test.ts` and PROGRESS.md for the source and the
 * byte-by-byte reconstruction — rather than implemented from memory alone,
 * since getting a binary format like this subtly wrong would silently
 * break interoperability with every other libp2p/IPFS tool.
 */
export function deriveIpnsName(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`deriveIpnsName: public key must be exactly 32 bytes, got ${publicKey.length}`);
  }
  const protobuf = encodePublicKeyProtobuf(publicKey);
  const multihash = new Uint8Array([IDENTITY_MULTIHASH_CODE, protobuf.length, ...protobuf]);
  const cid = new Uint8Array([CIDV1_VERSION, LIBP2P_KEY_CODEC, ...multihash]);
  return 'k' + encodeBase36(cid);
}

/** The identity document's well-known path (identity.md §5.3). */
export function identityDocumentPath(ipnsName: string): string {
  return `ipns://${ipnsName}/identity.json`;
}

/** The endorsement list's well-known path (hosting.md §8.1). */
export function endorsementListPath(ipnsName: string): string {
  return `ipns://${ipnsName}/endorsements.json`;
}

/** A rotation declaration's well-known path, named by its Unix timestamp (identity.md §6.3). */
export function rotationDeclarationPath(ipnsName: string, timestamp: number): string {
  if (!Number.isInteger(timestamp)) {
    throw new Error(`rotationDeclarationPath: timestamp must be an integer, got ${timestamp}`);
  }
  return `ipns://${ipnsName}/rotations/${timestamp}.json`;
}

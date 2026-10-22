import { describe, expect, it } from 'vitest';
import { generateKeypair } from '../../src/identity/keypair.js';
import {
  deriveIpnsName,
  endorsementListPath,
  identityDocumentPath,
  rotationDeclarationPath,
} from '../../src/identity/ipns.js';

describe('deriveIpnsName', () => {
  // Known-answer test: a worked example independently sourced from
  // https://discuss.ipfs.tech/t/solved-how-do-i-get-the-cidv1-peer-id-of-a-key-pair/11707
  // ("we add the multicodec prefix libp2p-key (0x72) and the CIDv1 prefix
  // (0x01)... we encode the whole [CID bytes] as base36"), and cross-checked
  // independently (see PROGRESS.md) rather than trusted from memory — the
  // hex below decodes to CIDv1 + libp2p-key + identity-multihash-wrapped
  // protobuf(Ed25519, that public key), which this test reconstructs byte
  // by byte before checking the final string.
  const PUBLIC_KEY_HEX = 'cb311166beeedd9fb6af4cc8c2bf4ac471dcdde7a71ff032440747e084cf0cc8';
  const EXPECTED = 'k51qzi5uqu5dl8wlbw09j1cpr1i456yb3mv0r5wnpx3wz6qq8pnppkvgqdepc8';

  it('matches the independently-sourced known-answer vector', () => {
    const publicKey = Uint8Array.from(Buffer.from(PUBLIC_KEY_HEX, 'hex'));
    expect(deriveIpnsName(publicKey)).toBe(EXPECTED);
  });

  it('starts with the base36 multibase prefix "k"', () => {
    const { publicKey } = generateKeypair();
    expect(deriveIpnsName(publicKey).startsWith('k')).toBe(true);
  });

  it('is deterministic for the same key', () => {
    const { publicKey } = generateKeypair(new Uint8Array(32).fill(7));
    expect(deriveIpnsName(publicKey)).toBe(deriveIpnsName(publicKey));
  });

  it('differs for different keys', () => {
    const a = generateKeypair(new Uint8Array(32).fill(1));
    const b = generateKeypair(new Uint8Array(32).fill(2));
    expect(deriveIpnsName(a.publicKey)).not.toBe(deriveIpnsName(b.publicKey));
  });

  it('rejects a public key that is not exactly 32 bytes', () => {
    expect(() => deriveIpnsName(new Uint8Array(31))).toThrow();
    expect(() => deriveIpnsName(new Uint8Array(33))).toThrow();
  });
});

describe('well-known paths (identity.md §5.3, §6.3)', () => {
  const name = 'k51qzi5uqu5dl8wlbw09j1cpr1i456yb3mv0r5wnpx3wz6qq8pnppkvgqdepc8';

  it('builds the identity document path', () => {
    expect(identityDocumentPath(name)).toBe(`ipns://${name}/identity.json`);
  });

  it('builds the endorsement list path', () => {
    expect(endorsementListPath(name)).toBe(`ipns://${name}/endorsements.json`);
  });

  it('builds a rotation declaration path, named by its timestamp', () => {
    expect(rotationDeclarationPath(name, 1_700_000_000)).toBe(
      `ipns://${name}/rotations/1700000000.json`,
    );
  });

  it('rejects a non-integer timestamp for a rotation path', () => {
    expect(() => rotationDeclarationPath(name, 1.5)).toThrow();
  });
});

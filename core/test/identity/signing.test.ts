import { describe, expect, it } from 'vitest';
import { generateKeypair } from '../../src/identity/keypair.js';
import { signObject, verifyObject } from '../../src/identity/signing.js';

const SEED_A = new Uint8Array(32).fill(1);
const SEED_B = new Uint8Array(32).fill(2);

describe('signObject / verifyObject', () => {
  it('produces a base64url signature field with no padding', () => {
    const kp = generateKeypair(SEED_A);
    const signed = signObject({ foo: 'bar' }, kp.secretKey);
    expect(typeof signed.signature).toBe('string');
    expect(signed.signature).not.toContain('=');
    expect(signed.signature).not.toMatch(/[+/]/);
  });

  it('round-trips: a freshly signed object verifies against the signer public key', () => {
    const kp = generateKeypair(SEED_A);
    const signed = signObject({ rater: 'x', item: 'y', value: 1 }, kp.secretKey);
    expect(verifyObject(signed, kp.publicKey)).toBe(true);
  });

  it('rejects verification against the wrong public key', () => {
    const signer = generateKeypair(SEED_A);
    const impostor = generateKeypair(SEED_B);
    const signed = signObject({ a: 1 }, signer.secretKey);
    expect(verifyObject(signed, impostor.publicKey)).toBe(false);
  });

  it('rejects verification if any non-signature field is tampered with', () => {
    const kp = generateKeypair(SEED_A);
    const signed = signObject({ amount: 100 }, kp.secretKey);
    const tampered = { ...signed, amount: 999 };
    expect(verifyObject(tampered, kp.publicKey)).toBe(false);
  });

  it('rejects verification if the signature field itself is tampered with', () => {
    const kp = generateKeypair(SEED_A);
    const signed = signObject({ amount: 100 }, kp.secretKey);
    const tampered = { ...signed, signature: signed.signature.slice(0, -2) + 'xx' };
    expect(verifyObject(tampered, kp.publicKey)).toBe(false);
  });

  it('excludes the signature field itself from what gets signed (identity.md §4.2)', () => {
    // Signing the same payload twice must exclude any pre-existing
    // `signature` field from the canonicalized/signed bytes, so a signed
    // object re-signed with the same key is bit-for-bit identical...
    const kp = generateKeypair(SEED_A);
    const signedOnce = signObject({ a: 1 }, kp.secretKey);
    const signedTwice = signObject(signedOnce, kp.secretKey);
    expect(signedTwice).toEqual(signedOnce);
  });

  it('is deterministic: signing the same object with the same key twice yields the same signature', () => {
    // Ed25519 (RFC 8032) is itself deterministic — unlike ECDSA it does
    // not use fresh per-signature randomness — so this should always hold.
    const kp = generateKeypair(SEED_A);
    const a = signObject({ x: 1, y: 2 }, kp.secretKey);
    const b = signObject({ x: 1, y: 2 }, kp.secretKey);
    expect(a.signature).toBe(b.signature);
  });

  it('produces different signatures for objects that differ only in key order (same canonical form expected to be equal, so signatures match)', () => {
    // JCS sorts keys, so { a: 1, b: 2 } and { b: 2, a: 1 } canonicalize
    // identically and therefore must sign identically.
    const kp = generateKeypair(SEED_A);
    const a = signObject({ a: 1, b: 2 }, kp.secretKey);
    const b = signObject({ b: 2, a: 1 }, kp.secretKey);
    expect(a.signature).toBe(b.signature);
  });

  it('verifyObject returns false (not throws) for an object with no signature field', () => {
    // No @ts-expect-error needed: verifyObject's `obj: object` parameter is
    // deliberately permissive (it validates shape at runtime, since real
    // callers are checking untrusted input), so this is valid input as far
    // as the type checker is concerned — the interesting behavior is runtime.
    const kp = generateKeypair(SEED_A);
    expect(verifyObject({ a: 1 }, kp.publicKey)).toBe(false);
  });

  it('verifyObject returns false for a non-string signature field', () => {
    const kp = generateKeypair(SEED_A);
    expect(verifyObject({ a: 1, signature: 12345 }, kp.publicKey)).toBe(false);
  });

  it('verifyObject returns false (not throws) when the signature field is not valid base64url', () => {
    const kp = generateKeypair(SEED_A);
    expect(verifyObject({ a: 1, signature: 'not valid base64url!!' }, kp.publicKey)).toBe(false);
  });

  it('verifyObject returns false (not throws) when the public key is the wrong length', () => {
    const kp = generateKeypair(SEED_A);
    const signed = signObject({ a: 1 }, kp.secretKey);
    expect(verifyObject(signed, new Uint8Array(16))).toBe(false);
  });
});

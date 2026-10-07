import serialize from 'canonicalize';

/**
 * JSON Canonicalization Scheme (RFC 8785), used throughout neusnet to
 * produce the exact byte sequence that gets signed and verified — see
 * identity.md §4.2.
 *
 * This wraps the `canonicalize` package (maintained by RFC 8785's editor)
 * rather than reimplementing JCS from scratch. Canonical JSON number
 * formatting must match ECMAScript's `Number::toString` behavior exactly
 * (RFC 8785 §3.2.2.3), which has enough edge cases — exponent thresholds,
 * negative zero, subnormal values — that hand-rolling it risks subtle,
 * hard-to-detect interoperability bugs in something every signature in the
 * protocol depends on. A maintained, spec-authored implementation is the
 * safer foundation for a reference implementation others will build on.
 *
 * @throws If `value` has no canonical JSON representation (e.g. a bare
 *   top-level `undefined`, a function, or a value containing a circular
 *   reference).
 */
export function canonicalizeJson(value: unknown): string {
  const result = serialize(value);
  if (result === undefined) {
    throw new Error(
      'canonicalizeJson: value has no canonical JSON representation ' +
        '(received undefined, a function, or a non-JSON-serializable value)',
    );
  }
  return result;
}

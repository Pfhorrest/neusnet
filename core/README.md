# neusnet-core

A reference implementation of the core, substrate-independent primitives of
the [neusnet protocol](../README.md): identity, signing, canonicalization,
and tag normalization, with more to come (see [PROGRESS.md](PROGRESS.md)
for what's implemented so far and what's next).

This package has no network, storage, or UI code in it. It's the
deterministic, pure-logic foundation everything else — a CLI, a web
client, an IPFS-backed node — would be built on top of: given the right
bytes in, it produces the right bytes out, with no I/O of its own. That
scope is deliberate: it's the part of the protocol most worth getting
exactly right and most amenable to being verified by tests, independent
of any particular hosting or transport choice (see
[hosting.md](../spec/hosting.md) for those).

If you're new to neusnet itself, start with the [project
README](../README.md) and the [spec documents](../spec/) — this package
assumes you've read at least identity.md and the relevant sections of
ratings.md for whatever module you're looking at, and the doc comments
throughout the source reference specific spec sections rather than
re-explaining the protocol.

## Status

Early and incomplete. See [PROGRESS.md](PROGRESS.md) for exactly what's
implemented, what's tested, and what isn't built yet. Don't use this for
anything that needs to interoperate with a real network yet — there isn't
one.

## Requirements

- Node.js 20 or later
- npm (or another package manager that reads `package.json`/`package-lock.json`)

## Getting started

```bash
git clone <this repo>
cd core
npm install
npm test
```

If `npm test` passes, your environment is set up correctly. From there:

```bash
npm run build      # compile to dist/ (ESM + .d.ts type declarations)
npm run typecheck  # tsc --noEmit, no build output
npm run lint        # eslint, strict type-aware rules
npm run format      # prettier --write
npm run test:coverage  # tests + coverage report (thresholds enforced)
```

## What's in here, and how to use it

Everything is a named export from its own module under `src/`; there's no
default export anywhere, and no global state beyond the one-time crypto
wiring described below. Import what you need directly:

```ts
import { generateKeypair, encodeNid1 } from 'neusnet-core/identity/keypair';
import { signObject, verifyObject } from 'neusnet-core/identity/signing';
import { normalizeTag, matchesTagQuery } from 'neusnet-core/ratings/tags';
```

(A single barrel `index.ts` re-exporting everything will be added once
there's enough surface area to make one useful — see PROGRESS.md.)

### Identity: keypairs and `nid1` identifiers (identity.md §2–§3)

```ts
import { generateKeypair, encodeNid1, decodeNid1 } from './src/identity/keypair.js';

const { secretKey, publicKey } = generateKeypair();
const myId = encodeNid1(publicKey);
// => "nid1F3sAqQpLzFtKmVbRwXcNyHjDgEoIuPe..."

decodeNid1(myId); // => the original 32-byte publicKey, or throws if malformed
```

Keep `secretKey` private — this library never persists or transmits it
anywhere; that's entirely the caller's responsibility (see identity.md
§3.2 for the spec's guidance on secure storage, which this library
doesn't implement — it's a client concern, not a protocol-primitive one).

### Signing and verifying objects (identity.md §4)

Any plain object can be signed. Signing excludes an existing `signature`
field (if present) from what actually gets signed, and JSON-canonicalizes
(RFC 8785) everything else before computing the Ed25519 signature over it
— this is what every rating record, post metadata file, and identity
document in the protocol does.

```ts
import { signObject, verifyObject } from './src/identity/signing.js';

const rating = { rater: myId, item: 'ipfs://...', ratings: { true: 1 } };
const signed = signObject(rating, secretKey);
// => { ...rating, signature: "base64url..." }

verifyObject(signed, publicKey); // => true
verifyObject({ ...signed, ratings: { true: -1 } }, publicKey); // => false — tampered
```

`verifyObject` never throws, even on malformed input (missing signature
field, garbage base64url, wrong-length key) — it returns `false`, so it
can be used directly as a filter over untrusted data from the network:

```ts
const validRecords = untrustedRecords.filter((r) => verifyObject(r, authorKey));
```

### Tag normalization and search (ratings.md §6.1–§6.3)

```ts
import { normalizeTag, matchesTagQuery } from './src/ratings/tags.js';

normalizeTag('Science Fiction'); // => "science-fiction"
normalizeTag('Philosophy.Epistemology'); // => "philosophy.epistemology"
normalizeTag('philosophy..epistemology'); // throws — consecutive dots are invalid

// Search semantics: a single-component query matches that component at
// any depth; a multi-component query matches only as a root-anchored
// prefix. See the doc comment on matchesTagQuery for the full rule and
// ratings.md §6.3 for the worked examples this implements exactly.
matchesTagQuery('philosophy.epistemology', 'epistemology'); // => true
matchesTagQuery('psychology.epistemology', 'philosophy.epistemology'); // => false
```

### Canonicalization and encoding (lower-level, used internally)

`src/canonicalization/jcs.ts` and `src/encoding/{base58,base64url}.ts` are
the building blocks the identity module is built on. Most consumers won't
need to call these directly, but they're independently exported and
tested since other spec-required signature schemes (alternative identity
substrates, per identity.md §4.1) need to produce the same canonical byte
sequence without going through this library's Ed25519-specific path.

## Design notes worth knowing before you read the source

- **Portable by construction.** Nothing in `src/` uses `Buffer` or any
  other Node-only global — only `Uint8Array`, `TextEncoder`, and standard
  JS. It should work unmodified in a browser bundle as well as in Node;
  that hasn't been verified with an actual browser test run yet (see
  PROGRESS.md), but the code was written with that constraint throughout.
- **Dependencies were chosen deliberately, not reflexively.** `@noble/ed25519`
  for signatures and `canonicalize` (maintained by RFC 8785's own editor)
  for JCS are both used rather than hand-rolled, specifically because
  getting canonical number serialization or EdDSA exactly right from
  scratch is easy to get subtly wrong in ways that silently break
  cross-implementation interoperability. Base58 uses `base-x` directly
  (not the `bs58` convenience wrapper) so the Bitcoin alphabet specified
  in identity.md §2 is a literal, verifiable constant in this codebase's
  own source rather than trusted from a third-party package internal.
- **`noUncheckedIndexedAccess` is on**, so array/record indexing is typed
  as possibly-`undefined` throughout. Where indexing is safe by
  construction (e.g. a bitmask result indexing a fixed-size alphabet), a
  `!` non-null assertion is used with a comment explaining the invariant,
  rather than adding a dead runtime check or a misleading `as T` cast.
- **One real spec bug was found and fixed during this implementation**:
  identity.md previously claimed JCS performs Unicode NFC normalization.
  RFC 8785 explicitly says the opposite — JCS performs _no_ Unicode
  normalization and preserves strings exactly as given. This was caught
  by a test that encoded the (incorrect) spec claim, which failed against
  the actual RFC-author-maintained canonicalization library; the spec
  document has since been corrected. It's a useful reminder that running
  real tests against real spec-compliant tooling catches things that
  reading the spec carefully does not.

## Testing approach

Tests are written before (or alongside, for small iterations) the code
they test, not after — see any file under `test/` for the pattern: each
test file typically starts from the spec's own worked examples (the
tables in ratings.md §6.1–§6.2 are reproduced as parameterized test cases
verbatim, for instance) and then adds edge cases the spec implies but
doesn't spell out. Where an edge case is genuinely ambiguous in the
written spec, the test file's comments say so and explain the
interpretation chosen.

Coverage thresholds are enforced in CI via `vitest.config.ts` (currently
90% statements/functions/lines, 85% branches) — not as a goal in itself,
but because an uncovered branch in this particular codebase is usually an
untested error path, and error paths (malformed signatures, invalid tags,
wrong-length keys) are exactly where protocol-level bugs tend to hide.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).

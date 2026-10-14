# neusnet-core

A reference implementation of the core, substrate-independent primitives of
the [neusnet protocol](../README.md): identity (documents, linking, platform
binding, key rotation) and signing, canonical JSON, tag normalization, post
metadata, rating records, the trust graph (affinity and effective scores),
and rating aggregation across post versions — with more to come (see
[PROGRESS.md](PROGRESS.md) for what's implemented so far and what's next).

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

Everything is a named export of the package entry point (`src/index.ts`);
there's no default export anywhere, and no global state beyond the
one-time crypto wiring described below. The examples below import from
the package name:

```ts
import { generateKeypair, signObject, normalizeTag } from 'neusnet-core';
```

Until this is published to npm, that name doesn't resolve on its own: inside
this repo, import from `./src/index.js` (as the tests do), or run
`npm run build` and import from `./dist/index.js`.

### Identity: keypairs and `nid1` identifiers (identity.md §2–§3)

```ts
import { generateKeypair, encodeNid1, decodeNid1 } from 'neusnet-core';

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
import { signObject, verifyObject } from 'neusnet-core';

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

### Identity documents, platform binding, and key rotation (identity.md §5–§7)

```ts
import {
  createIdentityDocument,
  verifyIdentityDocument,
  verifyPlatformBinding,
  createStandardRotation,
  verifyKeyRotation,
  resolveIdentityChain,
} from 'neusnet-core';

const doc = createIdentityDocument(
  {
    id: aliceId,
    display_name: 'Alice',
    links: [{ url: 'https://reddit.com/user/alice' }],
    timestamp: 1_700_000_000,
  },
  alice.secretKey,
);
verifyIdentityDocument(doc); // => true

// Her Reddit bio carries her key, and her document links back to the profile:
verifyPlatformBinding({
  profileUrl: 'https://reddit.com/user/alice',
  profileText: `Philosophy nerd. [neusnet:${aliceId}]`, // text *she* controls
  identityDocument: doc,
}); // => { verified: true, id: aliceId }

// Later she moves to a new key; both keys sign the rotation.
const rotation = createStandardRotation(
  { timestamp: 1_700_100_000 },
  alice.secretKey,
  next.secretKey,
);
verifyKeyRotation(rotation); // => true
resolveIdentityChain(aliceId, [rotation]); // => { currentId: nextId, chain: [aliceId, nextId] }
```

A few things worth knowing:

- **Platform binding needs both directions.** A key in a bio with no matching
  `links` entry (or the reverse) is just a claim; `verifyPlatformBinding`
  says which half is missing. Only pass it text the account's owner
  controls — a token typed into someone else's reply proves nothing.
- **Recovery rotations** (`createRecoveryRotation`) need the registered
  recovery keys and threshold passed to `verifyKeyRotation` as
  `{ recovery: { keys, threshold } }`. Each recovery key counts once, and
  entries from unregistered keys are ignored rather than fatal.
- **Forks are reported, not resolved.** If two valid rotations name
  different successors for one identity, `resolveIdentityChain` stops there
  and returns `contested` with the candidates — the protocol doesn't say
  which is right (identity.md §8.2), so that decision is the client's.
- Identity documents for non-native substrates (AT Protocol DIDs, Nostr
  keys...) work too; pass your own `verify` function wherever signatures
  are checked.

### Tag normalization and search (ratings.md §6.1–§6.3)

```ts
import { normalizeTag, matchesTagQuery } from 'neusnet-core';

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

### Posts (metadata.md §3–§4)

```ts
import { createPostMetadata, validatePostMetadata, computeTrustLevel } from 'neusnet-core';

const post = createPostMetadata(
  {
    id: 'ipns://k51-example-post', // the post's stable identifier — you mint this
    author: bobId,
    tags: ['philosophy'], // must already be normalized
    content: [{ uri: 'inline:', mime_type: 'text/plain', inline_content: 'Hello, neusnet.' }],
    timestamp: 1_700_000_000, // you supply "now"; nothing here reads the clock
  },
  bob.secretKey,
);

validatePostMetadata(untrustedJson); // throws on anything malformed
computeTrustLevel(post, bob.publicKey); // => 'author-verified'
```

Validation checks shape and types only. Two things are deliberately left
to the caller: minting a new post's stable `id` (the spec defines what an
identifier must look like but not how to mint one), and supplying the
timestamp. `computeTrustLevel` needs the key you believe signed the post —
Ed25519 signatures don't say who made them — and verifies it before
classifying, rather than trusting you.

### Ratings and the trust graph (ratings.md §2–§5)

```ts
import { buildTrustGraph, createRatingRecord, effectivePostScore } from 'neusnet-core';

// Alice rates Bob's post. `item` is the post's *version* identifier — in a
// real deployment, the content address of its metadata file.
const versionId = 'ipfs://bafy-example-version-1';
const rating = createRatingRecord(
  {
    rater: aliceId,
    item: versionId,
    item_type: 'post',
    ratings: { true: 1 },
    timestamp: 1_700_000_100,
    public: true,
  },
  alice.secretKey,
);

// The graph needs to know whom and what each rated post is attributed to.
const graph = buildTrustGraph({
  records: [rating],
  posts: new Map([[versionId, { author: bobId, tags: post.tags }]]),
});

// How does the post look to Alice?
effectivePostScore(graph, aliceId, versionId, { dimension: 'true' }); // => 1
```

Scores are always _from one viewer's point of view_: the same post has a
different effective score for each user, depending on whom they trust and
whom those people trust (decaying with distance). Also exported:
`derivedAffinity`, `directAffinity`, `compositeAffinity`, `confidence`,
`effectiveAffinity`, and `meetsVisibilityThreshold`.

The traversal is checked against the worked example in ratings.md
Appendix B, number for number (`test/ratings/trust-graph.test.ts`). If
you're going to change `src/ratings/trust-graph.ts`, read its section of
[PROGRESS.md](PROGRESS.md) first — several non-obvious behaviors in there
were settled deliberately.

This library never checks a rating record's signature for you: records are
assumed already validated and verified (`verifyObject`), the way
identity.md §4.4 requires.

### Versions and aggregation (metadata.md §5, ratings.md §2.5)

A post can be edited; each edit is a new version with its own identifier.
`buildVersionHistory` reconstructs a post's canonical history and sorts
every other file claiming its `id` — versions the author skipped over,
third-party introductions, rival claims — into the categories in
metadata.md §5.2. `buildTrustGraphFromPosts` then builds a trust graph in
which each rater counts once per _post_, however many versions they rated:

```ts
import { buildVersionHistory, buildTrustGraphFromPosts } from 'neusnet-core';

// Every metadata file you know of, keyed by version identifier (a CID in real use).
const known = new Map([
  ['ipfs://v1', v1],
  ['ipfs://v2', v2], // v2.previous === 'ipfs://v1'
]);

const history = buildVersionHistory({ id: postId, currentVersionId: 'ipfs://v2', known });
history.canonical; // => ['ipfs://v2', 'ipfs://v1'], newest first

// Carol rated v1 (+1), then later v2 (-1). Her latest opinion counts, once:
const graph = buildTrustGraphFromPosts({
  known,
  currentVersions: new Map([[postId, 'ipfs://v2']]),
  records,
});
derivedAffinity(graph, carolId, bobId, 'user', { dimension: 'true' }); // => -1
```

Nothing is fetched: you supply what you know and what the stable id
currently resolves to (the hosting layer's job), and `history.missing`
lists version identifiers you'd need to fetch to extend the history.
Verifying an author's signature works for native `nid1` identities out of
the box; for other identity substrates, pass your own `isAuthorSigned`.
`test/ratings/aggregate.test.ts` is the best worked reference for the
edge cases (skipped versions, introductions, rival claims, bridged posts).

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

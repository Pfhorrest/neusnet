# neusnet-core: Progress

Status tracker for the reference implementation, kept up to date as the
single source of truth for what's built, what's tested, and what's next.
If you're an instance of Claude resuming this build (in container scratch
space or from a fresh read of `/mnt/user-data/outputs/neusnet-core/`),
read this whole file before writing any code — it also records decisions
you shouldn't need to re-litigate.

**Last updated:** this entry was written during the session that added
post metadata objects (validation, creation, trust-level computation) on
top of the previous session's encoding/canonicalization/identity/tags
foundation.

## Current state at a glance

- **184 tests, all passing.** `npm test` is green.
- **~99.6% coverage** (statements/branches, 100% functions/lines) across
  every implemented module — the single uncovered branch is a documented,
  genuinely-unreachable defensive check (see `bytesEqual` in
  `src/metadata/post.ts`), not a gap worth forcing a test around.
- **Typecheck clean** (`npm run typecheck`), **lint clean** (`npm run
lint`, strict type-aware ESLint rules), **format clean** (`npm run
format:check`).
- **Build works** (`npm run build` emits `dist/` with `.js` + `.d.ts` +
  source maps for every module).
- No barrel `src/index.ts` yet — intentionally deferred until there's
  enough surface area for one to be worth having rather than just
  re-exporting a handful of modules (see "Next up" below).

Run `npm test && npm run typecheck && npm run lint && npm run
format:check && npm run build` as a single sanity check that nothing has
regressed before doing anything else, if you're resuming this.

## Implemented and fully tested

| Module                                  | File                                      | Spec section         | Notes                                                                                                                                                                  |
| --------------------------------------- | ----------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base64url encoding                      | `src/encoding/base64url.ts`               | identity.md §4.3     | Portable (no `Buffer`); RFC 4648 §5, no padding                                                                                                                        |
| Base58 (Bitcoin alphabet)               | `src/encoding/base58.ts`                  | identity.md §2       | Alphabet is a literal constant copied from the spec, not trusted from a third-party package                                                                            |
| JCS canonicalization                    | `src/canonicalization/jcs.ts`             | identity.md §4.2     | Wraps the `canonicalize` npm package (RFC 8785's own editor's implementation) rather than hand-rolling number serialization                                            |
| Ed25519 keypairs + `nid1` IDs           | `src/identity/keypair.ts`                 | identity.md §2–§3    | Wraps `@noble/ed25519` v3's sync API, wired to `@noble/hashes`' sha512                                                                                                 |
| Sign/verify                             | `src/identity/signing.ts`                 | identity.md §4       | `verifyObject` never throws — returns `false` on any malformed input, by design, so it composes as a filter over untrusted data                                        |
| Tag normalization (flat + hierarchical) | `src/ratings/tags.ts`                     | ratings.md §6.1–§6.2 | See "Spec ambiguities resolved" below — several real judgment calls were needed here                                                                                   |
| Tag search semantics                    | `src/ratings/tags.ts` (`matchesTagQuery`) | ratings.md §6.3      | Single-component queries match at any depth; multi-component queries match only as a root-anchored prefix — this asymmetry is deliberate and spec-confirmed, not a bug |
| Content references                      | `src/metadata/content-reference.ts`       | metadata.md §4       | `uri`/`mime_type`/`size`/`hash`/`inline_content`; `inline_content` required iff `uri === 'inline:'`, forbidden otherwise                                               |
| Post metadata (validate/create)         | `src/metadata/post.ts`                    | metadata.md §3       | Field names match the wire format exactly (snake_case), not idiomatic camelCase — see "Decisions made" below                                                           |
| Post trust level                        | `src/metadata/post.ts` (`computeTrustLevel`) | metadata.md §6.1  | Caller must supply the actual signer key (Ed25519 signatures don't embed it); verifies before classifying, never trusts the caller's claim blindly                    |

Post metadata scope note: schema validation, creation/signing, and
trust-level classification are done. **Not** done: canonical version
history construction (metadata.md §5.2) and cross-version rating
aggregation (§5.3) — both operate over a *collection* of versions rather
than a single object, and conceptually belong alongside the trust graph
work (item 2 below) rather than here. Also not done: a concrete
id-minting procedure for brand-new posts — see "Decisions made" below,
this is arguably a genuine spec gap worth raising, not just an
implementation deferral.

## Not started yet

Roughly in priority order (matches dependency order):

1. **Rating records** (ratings.md §2) — schema validation, creation,
   signing (reuses `src/identity/signing.ts` directly, should be close to
   mechanical).
2. **Trust graph / affinity computation** (ratings.md §3–§5) — this is
   the real mathematical core of the protocol: derived vs. direct
   affinity, decay across hops, confidence, effective affinity via graph
   traversal, sign inversion (enemy-of-my-enemy), effective post scores,
   visibility threshold. Substantial, deserves careful test design
   against hand-computed small-graph examples before trusting it on
   anything larger. **Also covers**, since it operates over collections
   the same way: canonical version history construction (metadata.md
   §5.2) and cross-version rating aggregation (§5.3), deferred from the
   post-metadata work above for exactly this reason.
3. **Identity documents** (identity.md §5) — schema, creation, signing,
   the `recovery_keys`/`recovery_threshold` fields, `aggregate_linked`,
   `proxy`/`operator` fields.
4. **Key rotation declarations** (identity.md §6) — both the dual-signature
   standard rotation and the recovery-quorum rotation (§6.2's
   `recovery_signatures` threshold verification).
5. **Channels** (ratings.md §6.4–§6.6) — this is more client-shaped logic
   (local taxonomy, suggestion generation) than pure protocol-object
   validation; worth deciding whether it belongs in this package at all
   or in a future client-facing package, given CONTRIBUTING.md's scope
   note that this package is protocol-object logic, not client behavior.
   Leaning toward: the _data structure_ (a channel's root tag + local
   taxonomy as a plain object) belongs here; the _suggestion-generation
   heuristics_ (client-recommendations.md §6.5's parent/child suggestion
   logic) probably don't, since they're explicitly non-normative client
   recommendations, not protocol requirements. Revisit when actually
   building this.
6. **Endorsement lists** (hosting.md §8.1) — schema, creation, signing.
   Mechanical now that post metadata exists (reuses the same patterns —
   `src/metadata/post.ts` is a good template to follow).
7. **A barrel `src/index.ts`** re-exporting the public API of everything
   above, once there's enough of it.

Explicitly **not** planned for this package at all (see CONTRIBUTING.md
"Scope"): anything involving actual IPFS/IPNS network calls, hosting,
gossip/pubsub, or a client UI. Those are future, separate packages once
this core is solid. hosting.md's IPNS derivation formula (§5.3's
protobuf → multihash → CIDv1 steps) is a plausible exception worth
reconsidering — it's pure computation (no network I/O), so it might
belong here after all, just lower priority than the list above.

## Decisions made, and why

- **TypeScript, not Python/Rust/Go.** Lowest barrier to entry for casual
  contributors ("a rando finding this on GitHub"), natural fit for an
  eventual web client, and IPFS's most actively maintained JS
  implementation (Helia) makes this the least-friction choice if/when
  this core gets a networked package built on top of it.
- **TypeScript 6.0.3, not the newly-released 7.0.2.** Checked npm's live
  dist-tags rather than assuming — `typescript-eslint`'s peer range is
  `>=4.8.4 <6.1.0` as of this writing, so 7.0 would mean no type-aware
  linting. Revisit this pin once typescript-eslint catches up; don't
  just bump it reflexively when a dependency update tool suggests it.
- **vitest over jest.** Faster, native ESM/TS support without a separate
  transform config, Jest-compatible API so it's not a new thing to learn.
- **`@noble/ed25519` + `@noble/hashes`, not a hand-rolled or OpenSSL-shelled
  Ed25519.** Audited, portable (no native bindings), the standard choice
  in the JS ecosystem for this.
- **`canonicalize` (npm), not a hand-rolled JCS implementation.** RFC
  8785's canonical number formatting has enough edge cases (exponent
  thresholds, negative zero) that hand-rolling it risks a subtle,
  hard-to-detect interoperability bug in the one thing every signature in
  the protocol depends on. Maintained by the RFC's own editor.
- **`base-x`, not `bs58`.** Same underlying library either way, but
  importing `base-x` directly and supplying the Bitcoin alphabet as our
  own literal constant (copied verbatim from identity.md §2) means
  that constant is visibly, verifiably correct by reading this
  codebase's own source, rather than trusted from `bs58`'s internals.
- **No `Buffer`, anywhere in `src/`.** Only `Uint8Array` and standard
  JS/Web APIs (`TextEncoder`, etc.), so this works unmodified in a
  browser bundle, not just Node. (Test files do use `Buffer` freely for
  fixture convenience — tests only run under Node via vitest, so there's
  no portability constraint there.)
- **`noUncheckedIndexedAccess: true`** in tsconfig, kept on throughout
  rather than disabled for convenience. Where it's genuinely a false
  positive (array indexing proven in-range by surrounding bitwise/length
  arithmetic), a `!` assertion with a one-line comment explaining the
  invariant is used — see `src/encoding/base64url.ts` for the pattern.
  `@typescript-eslint/no-non-null-assertion` is explicitly turned off in
  `eslint.config.js` for exactly this reason (see the comment there);
  don't re-enable it without reworking those call sites.
- **Wire-format field names (snake_case) used directly in TypeScript
  types, not translated to camelCase.** `ContentReference.mime_type`,
  not `mimeType`. Every spec document uses snake_case for every JSON
  field throughout (`neusnet_version`, `mime_type`, `inline_content`,
  `recovery_keys`, ...), so matching it exactly in the TS types means
  `JSON.parse(wireString)` satisfies the type with zero transformation,
  and reading this code next to the spec involves no mental renaming
  step. This trades idiomatic-JS naming conventions for wire fidelity —
  deliberate, for a library whose whole purpose is representing the wire
  format precisely.
- **`createPostMetadata` requires the caller to supply `id`, rather than
  minting one itself.** metadata.md §2 specifies the *form* a stable
  identifier must have but not a procedure for minting a fresh one for a
  brand-new post — unlike a user's identity document (identity.md §5.3,
  deterministic from the user's keypair), there's no spec-given way to
  derive a new post's `id` from its other fields. Rather than invent an
  unspecified scheme, this function treats id-minting as the caller's
  (hosting-layer's) responsibility. **Worth raising as a possible genuine
  spec gap** — metadata.md doesn't flag this as an open question, but it
  arguably should, alongside hosting.md's existing open questions.
- **100% coverage wasn't a goal going in** — the configured thresholds
  are 90/90/85/90 (statements/functions/branches/lines) — but every
  module implemented so far happened to reach 100% once the obvious
  error-path tests were added, so that's the current bar in practice.
  Don't feel obligated to hit exactly 100% on something much more
  complex (the trust graph math, especially) if the remaining gap is
  genuinely low-value to close; the configured thresholds are the actual
  requirement.

## Spec ambiguities resolved (worth knowing before touching tags.ts)

`ratings.md` §6.1's seven-step normalization procedure is informal prose,
not a formal grammar, and a literal reading runs into real problems:

- **"Remove all punctuation"** can't mean strict Unicode category `P*`
  (Punctuation) — the spec's own worked example (`"C++"` → `"c"`) requires
  stripping `+`, which is Unicode category `Sm` (Symbol, math), not
  punctuation at all. Implemented instead as: keep only Unicode letters
  (`\p{L}`), numbers (`\p{N}`), and hyphen; strip everything else. This
  reproduces every worked example in the spec exactly (verified in the
  test suite) and is simpler than enumerating which Unicode categories
  colloquially count as "punctuation."
- **The `[a-z0-9]` output-shape regex in the spec is ASCII-only as
  written, but ratings.md's own open-question discussion (§8.2) explicitly
  says non-Latin scripts "are not excluded."** Implemented using `\p{L}`/
  `\p{N}` rather than an ASCII range, so Cyrillic, CJK, Arabic, etc. are
  preserved (NFKC + lowercased where lowercasing is meaningful) rather
  than stripped as "non-ASCII." Tested explicitly (Cyrillic and CJK
  examples in `test/ratings/tags.test.ts`).
- **Stripped punctuation/symbols are deleted, not replaced with a
  hyphen** — only whitespace runs become a hyphen (step 5 is specific to
  whitespace). `"A+B=C"` → `"abc"`, not `"a-b-c"` — confirmed by the
  spec's own `"C++"` → `"c"` example, which already demonstrates
  deletion-without-separator.
- **`matchesTagQuery`'s single- vs. multi-component asymmetry is real
  and deliberate**, not something to "fix" toward consistency: a
  single-component query matches its component at _any_ position in a
  tag's hierarchy, but a multi-component query matches _only_ as a
  root-anchored prefix (not a contiguous subsequence starting anywhere).
  This is confirmed by the spec's own worked example: searching
  `philosophy.epistemology` must not match `psychology.epistemology`,
  which only holds under root-anchored-prefix semantics. Don't
  "generalize" this to subsequence matching without checking that
  example again.

## Spec bugs found and fixed during this work

**identity.md §4.2** previously claimed JCS canonicalization performs
"Unicode strings in NFC normalization." This is false — RFC 8785 is
explicit that JCS-compliant processing performs _no_ Unicode
normalization and must preserve string data "as is." Caught by a test
(`test/canonicalization/jcs.test.ts`) that initially encoded the
spec's claim and failed against the real `canonicalize` package; verified
against the actual RFC text via web search before concluding the spec
(not the library) was wrong. identity.md has been corrected — see that
file's §4.2 for the fixed text, which also explains the practical
implication for client implementers (normalize user-entered text to NFC
at input time if you want that property, since JCS won't do it for you).

**metadata.md Appendices A and B** were both missing the `type` field
entirely, even though metadata.md §3 lists `type` as a *required* field
and Appendices C and D (written in a later session) correctly include
it. Evidently a leftover from before `type` fields were retrofitted onto
every neusnet object type across the spec suite — these two appendices
just never got updated. Both are now fixed.

**metadata.md Appendix D** (originally titled "Unsigned Bridged Post")
had a `signature` field in its own example, despite the title. Per §6.1's
own trust-level table, a post with `author` naming one party and
`signature` naming a different one is **third-party attested**, not
unverified/unsigned — the example was actually (correctly) demonstrating
§6.3's *recommended* bridging pattern ("should be signed by the
introducer, making it third-party attested"), just mistitled. Renamed to
"Third-Party-Attested Bridged Post" with a corrected caption; the JSON
content itself didn't need to change, only Appendix A/B's missing `type`
field.

All three were caught the same way: while building fixtures for
`test/metadata/post.test.ts` directly from the spec's own appendix
examples (the established practice in this codebase, not something new
for this session), each appendix was parsed as JSON and checked against
§3's and §6.1's own stated rules before being used as a test fixture,
rather than assumed correct because it's already-published, "official"
spec text.

This is worth internalizing as a working method for the rest of this
project, not just a one-off fix: where a test's expected behavior comes
from this project's own earlier spec-writing rather than from an
external, independently-verifiable source, be willing to doubt the spec
text itself — check it against the spec's *own* other stated rules at
minimum, the actual external primary source (an RFC, a standard) where
one exists — and fix the spec rather than quietly making the test match
a possibly-wrong assumption. Three for three so far; check the next
appendix example this carefully too, not just the first time.

## Persistence / resumption notes

This package is developed in container scratch space
(`/home/claude/neusnet-core/`) and synced to
`/mnt/user-data/outputs/neusnet-core/` (source only — `node_modules/`,
`dist/`, `coverage/` excluded) at the end of each work session, since
scratch space is not guaranteed to persist across turns. If
`/home/claude/neusnet-core/` is missing or looks stale on resume, treat
`/mnt/user-data/outputs/neusnet-core/` as the source of truth, copy it
back into scratch space, run `npm install`, and verify the full suite
passes before continuing.

The user's actual git repo has `spec/*.md` and this package should land
at `core/` alongside it (sibling directories) — see the top-level
project README for the overall repo layout.

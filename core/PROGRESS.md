# neusnet-core: Progress

Status tracker for the reference implementation, kept up to date as the
single source of truth for what's built, what's tested, and what's next.
If you're an instance of Claude resuming this build (in container scratch
space or from a fresh read of `/mnt/user-data/outputs/neusnet-core/`),
read this whole file before writing any code — it also records decisions
you shouldn't need to re-litigate.

**Last updated:** this entry was written during the session that added
endorsement lists (hosting.md §8.1) — and, picking up a gap flagged as far
back as the first identity.md session, the actual IPNS name derivation
(identity.md §5.3) that endorsement lists, identity documents, and
rotation declarations all reference but nothing could previously compute.

## Current state at a glance

- **668 tests, all passing.** `npm test` is green.
- **~99.8% statement coverage, ~98% branch coverage, 100%
  functions/lines** across every implemented module — remaining gaps are
  small branch-level edge permutations with real diminishing returns. A
  couple of genuinely-unreachable defensive checks that showed up as
  coverage gaps in `trust-graph.ts` were _removed_ rather than tested
  (see "Decisions made" below) — don't reintroduce them. The one
  remaining uncovered line (`bytesEqual` in `src/metadata/post.ts`) is
  similarly documented as unreachable in a code comment, not a gap worth
  forcing a test around.
- **Typecheck clean** (`npm run typecheck`), **lint clean** (`npm run
lint`, strict type-aware ESLint rules), **format clean** (`npm run
format:check`).
- **Build works** (`npm run build` emits `dist/` with `.js` + `.d.ts` +
  source maps for every module).
- **README examples are executed.** `test/readme-examples.test.ts`
  mirrors the code samples in `README.md`; change one, change the other.

Run `npm test && npm run typecheck && npm run lint && npm run
format:check && npm run build` as a single sanity check that nothing has
regressed before doing anything else, if you're resuming this.

## Implemented and fully tested

| Module                                   | File                                         | Spec section           | Notes                                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base64url encoding                       | `src/encoding/base64url.ts`                  | identity.md §4.3       | Portable (no `Buffer`); RFC 4648 §5, no padding                                                                                                                                                                           |
| Base58 (Bitcoin alphabet)                | `src/encoding/base58.ts`                     | identity.md §2         | Alphabet is a literal constant copied from the spec, not trusted from a third-party package                                                                                                                               |
| JCS canonicalization                     | `src/canonicalization/jcs.ts`                | identity.md §4.2       | Wraps the `canonicalize` npm package (RFC 8785's own editor's implementation) rather than hand-rolling number serialization                                                                                               |
| Ed25519 keypairs + `nid1` IDs            | `src/identity/keypair.ts`                    | identity.md §2–§3      | Wraps `@noble/ed25519` v3's sync API, wired to `@noble/hashes`' sha512                                                                                                                                                    |
| Sign/verify                              | `src/identity/signing.ts`                    | identity.md §4         | `verifyObject` never throws — returns `false` on any malformed input, by design, so it composes as a filter over untrusted data                                                                                           |
| Tag normalization (flat + hierarchical)  | `src/ratings/tags.ts`                        | ratings.md §6.1–§6.2   | See "Spec ambiguities resolved" below — several real judgment calls were needed here                                                                                                                                      |
| Tag search semantics                     | `src/ratings/tags.ts` (`matchesTagQuery`)    | ratings.md §6.3        | Single-component queries match at any depth; multi-component queries match only as a root-anchored prefix — this asymmetry is deliberate and spec-confirmed, not a bug                                                    |
| Content references                       | `src/metadata/content-reference.ts`          | metadata.md §4         | `uri`/`mime_type`/`size`/`hash`/`inline_content`; `inline_content` required iff `uri === 'inline:'`, forbidden otherwise                                                                                                  |
| Post metadata (validate/create)          | `src/metadata/post.ts`                       | metadata.md §3         | Field names match the wire format exactly (snake_case), not idiomatic camelCase — see "Decisions made" below                                                                                                              |
| Post trust level                         | `src/metadata/post.ts` (`computeTrustLevel`) | metadata.md §6.1       | Caller must supply the actual signer key (Ed25519 signatures don't embed it); verifies before classifying, never trusts the caller's claim blindly                                                                        |
| Rating records (validate/create)         | `src/ratings/rating-record.ts`               | ratings.md §2.1        | `ratings` is `Record<string, number>`, open dimension names (§1.2 allows community-defined ones); `supersedes()` implements §2.3's update/retraction rule                                                                 |
| Rating collection wrapper                | `src/ratings/rating-collection.ts`           | ratings.md §7          | `records`/`cached` arrays, each entry validated via rating-record.ts                                                                                                                                                      |
| Trust graph: affinity + effective scores | `src/ratings/trust-graph.ts`                 | ratings.md §3–§5       | The mathematical core — see its own section below, this is not a "just reads the spec" module                                                                                                                             |
| Content identity                         | `src/metadata/content-identity.ts`           | metadata.md §4.3       | Immutable URI / hash / inline-text matching; a mutable URI never confirms identity alone                                                                                                                                  |
| Canonical version history                | `src/metadata/version-history.ts`            | metadata.md §5.2       | Walks `previous`, finds the canonical author, categorizes every other known file; author-signature check is injectable for non-native substrates                                                                          |
| Cross-version rating aggregation         | `src/ratings/aggregate.ts`                   | ratings.md §2.5        | One rating per rater per post; `buildTrustGraphFromPosts` wires metadata + records into a `TrustGraph`                                                                                                                    |
| IPNS name derivation + well-known paths  | `src/identity/ipns.ts`                       | identity.md §5.3, §6.3 | Pure computation (libp2p peer-ID-as-CIDv1, base36) — the one IPFS/libp2p-specific piece in an otherwise substrate-agnostic library; verified against an independently-sourced worked example, not implemented from memory |
| base36 encoding                          | `src/encoding/base36.ts`                     | —                      | Reuses the existing `base-x` dependency, same pattern as base58                                                                                                                                                           |
| Endorsement lists                        | `src/hosting/endorsement-list.ts`            | hosting.md §8.1        | First module under `src/hosting/`; standard validate/create/verify shape, matching `identity-document.ts` and `post.ts`                                                                                                   |
| Channels                                 | `src/ratings/channels.ts`                    | ratings.md §6.4–§6.6   | Client-local only (never signed/published, per §6.4) — matching + suggestion algorithms as pure functions, no validator                                                                                                   |
| Linked-identity aggregation              | `src/identity/linked-clusters.ts`            | identity.md §7.1       | Pure pre-processing in front of `trust-graph.ts` (unchanged): cluster, resolve the viewer's mode, remap, then build the graph normally                                                                                    |
| Identity documents + link records        | `src/identity/identity-document.ts`          | identity.md §5, §7     | Validation, native signing, mutual-link verification; `signing.ts` gained the shared `SignatureVerifier`/`verifyNativeSignature`                                                                                          |
| External platform binding                | `src/identity/platform-binding.ts`           | identity.md §2.2       | Pure half only: token extraction + both-directions check; the caller fetches profiles and documents                                                                                                                       |
| Key rotation (standard + recovery)       | `src/identity/rotation.ts`                   | identity.md §6         | Per-declaration verification, plus `resolveIdentityChain`, which _reports_ forks as `contested` rather than choosing                                                                                                      |
| Package entry point                      | `src/index.ts`                               | —                      | Re-exports the public API; `test/index.test.ts` pins the export surface, and the built `dist/` was verified importable in plain Node                                                                                      |

Post metadata scope note: schema validation, creation/signing, and
trust-level classification are done. **Not** done: canonical version
history construction (metadata.md §5.2) and cross-version rating
aggregation (§5.3) — both operate over a _collection_ of versions rather
than a single object, and conceptually belong alongside the trust graph
work (item 2 below) rather than here. Also not done: a concrete
id-minting procedure for brand-new posts — see "Decisions made" below,
this is arguably a genuine spec gap worth raising, not just an
implementation deferral.

## Not started yet

Nothing is currently on the explicit list — every module named in the
original scope (identity, metadata, ratings, trust graph, channels,
endorsement lists) is implemented. The actual IPFS/IPNS _network_ layer
(resolving an `ipns://` name, fetching and publishing content, gossip)
remains explicitly **not** planned for this package (see CONTRIBUTING.md
"Scope") — that's a future, separate package once a client needs it. If
you're picking this up with nothing specific in mind, read hosting.md and
client-recommendations.md fresh for anything this library could still
usefully compute without doing network I/O itself (the IPNS derivation
work was exactly this kind of find), or consider a `neusnet-node` /
`neusnet-client` package that uses this one.

## The trust graph module: what to know before touching it

`src/ratings/trust-graph.ts` is the one module where "just implement what
the spec says" was not enough — the written spec underdetermines the
algorithm in several places, and each was resolved by cross-checking
against ratings.md Appendix B's worked example, whose every number this
implementation reproduces exactly (see `test/ratings/trust-graph.test.ts`,
which encodes that example verbatim, including the sign-inverted
"enemy-of-my-enemy" variant). If you change anything in this file, those
tests are the ones that must keep passing unmodified.

**1. §4.5's prose formula doesn't literally match its own worked example.**
The traversal step is written as `import_weight(P) = composite_affinity(U,
P, D) × decay^H` — but Appendix B's Step 4 computes the hop-2 weight as
`import_weight(Alice→Bob) × composite_affinity(Bob, Carol) × decay¹`,
chaining multiplicatively through the previous hop. Read literally, the
prose formula would be circular for exactly the nodes the traversal exists
to reach: `composite_affinity(Alice, Carol)` is 0/undefined for a node
Alice has never rated anything related to, which is the whole point of
needing indirect traversal. Implemented per the worked example, which is
unambiguous: each hop's relay weight is the previous hop's accumulated
contribution into that node, times one additional decay factor. The
prose formula is best read as a loose gloss. **Consider tightening
ratings.md §4.5's wording to state the recursive form precisely** — not
a factual error (the appendix fully disambiguates it), but a documentation
gap worth closing; not done unilaterally here since it's a spec-prose
change rather than a correction of something false.

**2. The appendix's "effective_score" steps are really `effective_affinity`
with the post's author.** Appendix B Steps 5–6 present `effective_score(Alice,
Z) = 0.10` as if applying §5's post-score formula — but what's actually
computed there is Alice's effective affinity with Z's _author_, which
only equals the full §5 post score because the example's posts have no
tags and Alice never rated them directly (so §5's three-term mean
degenerates to its single author term). Both facts are pinned by tests
(`effective_score(Alice, Z) = +0.10` is checked via `effectivePostScore`,
confirming the equivalence rather than assuming it).

**3. "Rated by U on D" means: D must be explicitly present in the rating
record's `ratings` map.** §1.2 says an omitted dimension "is treated as
0," which would suggest every post U ever rated counts toward every
dimension's mean with an implicit 0 — but §4.3 tracks `confidence`
_per dimension_, which would be a pointless feature if every dimension's
count were always identical for a given (U, N). Interpreted instead as an
explicit-opinion filter: a post U rated only on `good` doesn't dilute U's
`true`-dimension affinity with an implicit zero. Pinned by a dedicated
test; revisit only if the spec author says otherwise.

**4. Contributions to an already-visited user must be discarded
entirely** — not merely excluded from re-propagation. §4.5 step 3 says
"longer-path encounters are skipped"; an early version of this module
applied that only to whether a node becomes a _new relay_, still letting
the redundant longer-path contribution inflate the node's own
accumulator (Carol's `effective_affinity` came out 0.9 instead of 0.4 in
a case where she's both a direct hop-1 relation of Alice _and_
reachable through Bob). Fixed, and pinned by a test asserting Carol's
own value specifically — notably, the first version of that test only
checked Dave's downstream value, which happens to be insensitive to the
bug (Carol's relay weight is fixed at frontier-construction time, before
the redundant contribution arrives); that was a real test-design lesson:
**check the value you suspect is wrong, not just a downstream value that
might hide it.** Tags are exempt from this gating (they're never relay
sources, so there's no "shortest path to a tag" concept — every path's
contribution to a tag legitimately accumulates).

**5. The accumulator is keyed by `(nodeType, nodeId)`, not bare `nodeId`.**
ratings.md §2.1 notes "the same string could in principle identify
different things" (that's why `item_type` exists on rating records), so a
node's user-role and tag-role affinities must stay independent
throughout derived, direct, composite, and effective computation.

**6. Not a bug, worth knowing:** a user's own direct rating of a post
also counts as a "post relating to its author/tags" for derived-affinity
purposes, which can loop back and affect that same post's own effective
score. ratings.md has no carve-out excluding "the post being scored" from
derived-affinity bookkeeping, and it's arguably correct — rating a post
genuinely does update your affinity with its author. The "three equal
terms" test documents this explicitly with a hand-computed expected value
(0.3, not the naive 0.5) rather than pretending the three terms are
independent; a second test uses separate posts to isolate them cleanly.

**7. Two redundant `visited.has(...)` guards were removed rather than
tested.** Coverage flagged them uncovered; analysis showed both are
provably unreachable (upstream invariants — `compositeAffinitiesOf`'s
Map-based dedup and an earlier guard in the same loop — already
guarantee what they checked). Deleting provably-dead code beats
contriving a test that has to break the invariant to exercise it.

## IPNS derivation: what to know before touching it

This is the one module in the library where getting a detail wrong would
be invisible until tested against real IPFS/libp2p tooling, not just
against this codebase's own tests — so it's worth recording exactly how it
was verified, not just what it does.

- **The initial plan was wrong, and a search caught it before any code was
  written.** The natural assumption — SHA2-256-hash the protobuf-encoded
  public key, like a normal multihash — is what _every_ other multihash in
  this library's domain does, but libp2p peer IDs specifically use the
  "identity" multihash (function code `0x00`, no hashing, payload wrapped
  as-is) for any key small enough to not need hashing, which an Ed25519
  key's 36-byte protobuf encoding always is. Hashing here would have
  produced a value that looks plausible (right length, right alphabet) but
  doesn't match any real IPFS tool's output — the worst kind of bug, since
  nothing in this codebase's own tests would have caught it.
- **Verified against an independently-sourced worked example**, not
  memory: a forum post gave the exact byte layout for one real Ed25519 key
  (`0172002408011220cb3111...`), which was decoded by hand (see the test
  file's comment) to confirm the CIDv1/libp2p-key/identity-multihash/
  protobuf structure byte-for-byte, and the resulting base36 string was
  computed independently in Python before any TypeScript was written. That
  computed string — `k51qzi5uqu5dl8wlbw09j1cpr1i456yb3mv0r5wnpx3wz6qq8pnppkvgqdepc8`
  — is now a hardcoded known-answer test. It also starts with
  `k51qzi5uqu5d`, matching every illustrative IPNS name already used
  throughout the spec's own examples — a nice confirmation that those
  examples were at least shaped correctly.
- **Only the Ed25519/identity-multihash path is implemented.** libp2p also
  defines a SHA2-256 path for keys too large to inline (RSA, mainly); this
  library only ever produces Ed25519 keys, so that path is simply never
  needed and isn't built. `deriveIpnsName` rejects anything that isn't
  exactly 32 bytes, rather than silently taking a wrong path for a key of
  a different size.
- **The protobuf encoding is hand-rolled, deliberately**, not pulled in via
  a protobuf library: the libp2p `PublicKey` message has exactly two fixed
  fields with lengths that always fit a single varint byte for this
  library's inputs, so a general-purpose encoder would be a dependency
  for four lines of code.

## Channels: what to know before touching it

- **No validator, no wire schema — and that's correct, not an oversight.**
  ratings.md §6.4 calls a channel "a private taxonomic assertion that
  affects only their own view"; it is never signed or published. Every
  other object in this library (`PostMetadata`, `RatingRecord`,
  `IdentityDocument`...) has a `validateX`/`isValidX` pair because it
  crosses the wire; `Channel` doesn't, so it doesn't.
- **Matching composes directly with `tags.ts`**, unchanged:
  `matchesChannel` is `matchesTagQuery(tag, rootTag)` (the ordinary prefix
  rule — no taxonomy entry needed for `#philosophy.epistemology` to match a
  `#philosophy` channel) `||` a local-taxonomy component matching anywhere
  (the same non-exact `matchesTagQuery` semantics, applied to each entry).
- **Suggestions extract the _immediate_ child only**, however much deeper
  the observed tag goes — `#philosophy.epistemology.reliabilism` suggests
  `epistemology`, never `reliabilism` — since a confirmed `epistemology`
  subchannel already reaches the deeper tag through the ordinary prefix
  rule. This wasn't obvious from the spec's single two-level example, and
  the first implementation got it wrong (required an _exact_ one-level
  child, so a three-level observed tag silently produced zero suggestions);
  a test using a three-level tag catches a regression here. ratings.md
  §6.5 now says this explicitly.
- **The disclosure field is generated, not left to the caller**, because
  §6.5 treats accurate scope disclosure as a requirement ("the client
  cannot know whether the suggestion is a good one"), not a UI nicety.
- **`corpus` carries no affinity information** — every function here takes
  a plain tag-lists-per-post array and assumes the _caller_ already
  filtered it to trusted content, exactly like the version-aggregation
  module's `known` map takes already-validated data. Composing with
  `effectiveAffinity` to build that filter is the caller's job and is
  shown in the README, not reimplemented here.

## Linked-identity aggregation: what to know before touching it

- **The core trust graph algorithm was not touched.** Aggregation is a
  pre-processing step: compute clusters from identity documents, resolve
  the viewer's mode into an id→canonical-id mapping, remap `rater` and
  (for `item_type: 'user'`) `item` on rating records and `author` on
  `PostInfo`, then call `buildTrustGraph` exactly as before. This keeps the
  heavily-verified traversal code (see its own section above) unchanged
  while still merging a cluster into one node — a rater, an author, and an
  affinity target all become the same thing once remapped.
- **Clusters are connected components, not cliques.** identity.md §7.1 says
  "if any identity in a mutually-verified cluster..." without fully
  specifying the graph structure; requiring every pair among N linked
  identities to separately declare each other (O(N²) link records) seemed
  clearly impractical, so transitive grouping was chosen and the spec text
  now says so explicitly.
- **Three separate functions, not one.** `computeLinkedClusters` (the
  facts: who's linked, and the owner-side preference) is kept apart from
  `computeIdentityMapping` (the viewer's mode applied on top) and
  `applyIdentityMapping` (actually remapping data), so a client can show a
  user their link graph independent of whichever mode is currently active.
- **`item_type` still disambiguates during remapping.** A rating's `item`
  is only remapped when `item_type === 'user'` — a `post` or `tag` item is
  left alone even if its string happens to match a mapped identity, same
  principle as elsewhere in this codebase (ratings.md §2.1).

## Identity: what to know before touching it

- **Validators enforce things the schema only implies**, each now stated in
  identity.md §5.2/§7: `recovery_threshold` is at least 1 (0 would authorize
  a rotation on no signatures); recovery keys are distinct and differ from
  the identity's own key; `operator` exists only on proxies and isn't the
  proxy itself; link records can't self-link or repeat. A `nid1`-looking
  identifier must actually be a valid one.
- **Rotation signatures cover five fields, not "everything but
  `signature`".** `signObject` strips only a field named `signature`, but a
  rotation has `old_signature`, `new_signature`, and `recovery_signatures`,
  so rotation signs an explicit payload (`neusnet_version`, `type`,
  `old_id`, `new_id`, `timestamp`). A declaration carries exactly one
  authorization form.
- **Recovery quorums count distinct keys, and ignore junk entries.** A key
  listed twice must not satisfy a threshold of 2 (a test pins this — it is
  the obvious way to get the verifier wrong), and entries from unregistered
  keys or with bad signatures are ignored rather than fatal, because
  `recovery_signatures` is outside every signature's coverage.
- **The library reports facts; it doesn't invent policy.** Forked rotations
  come back `contested`. The authorized recovery set is an _input_ to
  verification. Both are open questions in identity.md §8, because a
  compromised primary key can issue its own rotation and can swap in its own
  recovery keys — and the spec doesn't yet say how clients should defend
  against either. Don't "fix" these in code before the spec decides.
- **Link-record signatures are redundant inside a signed document** (the
  document signature already covers them) but are specified, and checked by
  `verifyMutualLink`, so a record can be transported on its own.
- **Platform tokens prove nothing in text the account owner doesn't
  control.** `extractNeusnetIds`'s doc comment says so; callers must pass
  bios or designated posts only.

## Spec revisions made during the identity work

- **identity.md §6.3 had a hole:** rotation declarations were to be
  published under "the user's IPNS directory", but a recovery rotation
  exists because the old key is lost — and only the old key can write to
  the old identity's directory. Declarations now live under the **new**
  identity's `/rotations/` (a standard rotation may also be mirrored under
  the old one), with propagation as the discovery path for followers of
  the old identity.
- **§6.1/§6.2** now state what is signed, the exactly-one-authorization
  rule, chains and contested identities, and the distinct-key,
  ignore-junk counting rule for recovery quorums.
- **§5.2/§7** now state the constraints the validator enforces (above).
- **New §8 Open Questions:** (8.1) which identity document is
  authoritative for recovery keys, given that a compromised primary key can
  rewrite them (suggested direction: a grace period before a recovery-key
  change can authorize anything); (8.2) competing rotations; (8.3) finding
  a successor from the old identity alone.
- The cross-reference checker used on the spec suite now also understands
  bold-labelled items like `**8.1 ...**` (open questions use that style).

## Version history and aggregation: what to know before touching it

`src/metadata/version-history.ts`, `content-identity.ts`, and
`src/ratings/aggregate.ts` implement metadata.md §4.3/§5.2/§6.2 and
ratings.md §2.5. As with the trust graph, the written spec underdetermined
several things; each was settled (and the spec text revised to match — see
below) rather than silently guessed.

- **Inputs are a `known` map plus a current version id; nothing is
  fetched.** A version identifier is the content address of a metadata
  file, so it can't live inside the file; the caller supplies a
  `Map<versionId, PostMetadata>` and says what the stable id currently
  resolves to (the hosting layer's job). Dangling `previous` links come
  back in `missing` so a client knows what to fetch.
- **Author-signature verification is injectable.** The native check
  (`nid1` author + Ed25519) is the default; AT Protocol DIDs, Nostr keys
  etc. need the caller's own `isAuthorSigned`. With only the native check,
  a non-`nid1` author never produces a canonical chain.
- **The walk goes _through_ non-author-signed versions** (so a stray copy
  mid-chain doesn't truncate history) but only through files claiming the
  same `id`; it stops at unknown files, foreign-id files (whose links are
  not followed), and cycles. Only author-signed versions by the canonical
  author join the chain.
- **No canonical author → the current version is the "anchor"** (the
  normal bridged-post state). It isn't anomalous; others are categorized
  against its claimed author, and introductions are confirmed against it.
  Without this, bridged posts could never be rated at all.
- **"Unsigned copy" is a fifth category** the original §5.2 table lacked,
  and **"false claimant" was broadened** to mean any file naming a
  different author or none, however signed. It describes the claim, not
  intent. Introductions are confirmed only against _author-signed_
  versions (or the anchor) — one introduction can't vouch for another
  (pinned by a test whose fixture matches _only_ another introduction; an
  earlier draft of that test didn't actually test the property).
- **A signature doesn't say who signed an introduction**, so history
  construction can't distinguish a real introduction from a garbage
  signature; vetting introducers is the caller's job.
- **Inline content identity is by text, not URI** (all inline refs share
  the URI `inline:`). Cross-form matching (inline vs. hashed) needs an
  explicit `hash` on the inline reference. Magnet links match by infohash;
  hex-vs-base32 infohash spellings are _not_ normalized (documented gap).
- **Aggregation takes each rater's latest record _whole_** (not
  per-dimension), treats a retraction as a record (so it can't be undone by
  resurrecting an older rating of another version), and breaks timestamp
  ties by version order so results don't depend on arrival order.
- **A gap found and fixed while writing the spec text:** after
  cross-version dedupe, a viewer who rated v2 and then the older v1 had
  only the v1 record left, so `effectivePostScore` for v2 silently lost
  their own direct rating. Fix: `PostInfo.stableId` groups the versions of
  one post, and the direct-rating lookup takes the viewer's latest rating
  across the group. The test uses numbers chosen so the bug changes the
  result (a first-draft choice would have given the same score either way).
- **Rating signatures are never checked here** — callers must have
  verified records (identity.md §4.4) before aggregating. Documented in
  the module header.
- **Open question (metadata.md §7.2):** `buildTrustGraphFromPosts` credits
  whatever `author` a file names, even for unconfirmed third-party
  attributions, which lets an introducer put words in someone's mouth. The
  spec now lists this as open; clients can implement a stricter policy
  because attribution is caller-supplied to the trust graph.

## Spec revisions made during the version-history work

The spec author authorized refining the spec alongside implementation
("nobody else is even reading this spec yet"). Changes, all in files under
`spec/`:

- **ratings.md §4.5** rewritten to state the traversal precisely (the
  recursive import-weight rule, "shortest path only" semantics including
  same-length convergence, tags exempt) — resolving the prose-vs-example
  mismatch noted in the trust graph section above.
- **ratings.md Appendix B** rewritten to go through the real mechanism
  (affinity first, post score last) with its assumptions (no tags, no
  direct ratings) stated; Steps renumbered 1–7, and the test labels in
  `test/ratings/trust-graph.test.ts` match.
- **ratings.md §2.5** made precise (inclusion rules, no-canonical-history
  case, whole-record dedupe, retractions, ties); **§5** notes how a
  viewer's direct rating works across versions; **§7** now requires
  `records` entries to be the owner's and forbids `public: false` records
  in either array (and `validateRatingCollection` enforces both); a stale
  pointer to "README §Client Implementation Recommendations" now points to
  client-recommendations.md.
- **metadata.md**: §2 pointed to the wrong section (5.3 vs 5.2) and said
  ratings are "summed" (they're deduplicated); the `hash` description
  listed magnet links as mutable, contradicting §4.1 and hosting.md §3.2;
  new **§4.3 Content Identity**; **§5.2** rewritten (precise algorithm,
  anchor case, unsigned-copy row, broadened false-claimant, how anomalous
  files are discovered); **§6.2** clarified; new open question **§7.2**;
  the intro's reference to a nonexistent "Section 8" fixed.
- A scripted cross-reference check over all six spec files found one
  dangling reference (that "Section 8") and now finds none. Worth
  re-running after any renumbering.

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
- **The README's code samples are tests.** Documentation for newcomers
  is only useful if it works, and the first draft of this README told
  readers to import from paths (`neusnet-core/identity/keypair`) that the
  package's `exports` map doesn't expose — and there was no `src/index.ts`
  at all, so the package entry point was broken. Both fixed; the samples
  are now run by `test/readme-examples.test.ts`.
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
  minting one itself.** metadata.md §2 specifies the _form_ a stable
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
entirely, even though metadata.md §3 lists `type` as a _required_ field
and Appendices C and D (written in a later session) correctly include
it. Evidently a leftover from before `type` fields were retrofitted onto
every neusnet object type across the spec suite — these two appendices
just never got updated. Both are now fixed.

**metadata.md Appendix D** (originally titled "Unsigned Bridged Post")
had a `signature` field in its own example, despite the title. Per §6.1's
own trust-level table, a post with `author` naming one party and
`signature` naming a different one is **third-party attested**, not
unverified/unsigned — the example was actually (correctly) demonstrating
§6.3's _recommended_ bridging pattern ("should be signed by the
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
text itself — check it against the spec's _own_ other stated rules at
minimum, the actual external primary source (an RFC, a standard) where
one exists — and fix the spec rather than quietly making the test match
a possibly-wrong assumption. Three for three so far; check the next
appendix example this carefully too, not just the first time.

## Persistence / resumption notes

**Dependency advisories can appear between sessions even with no code
changes.** A clean-room verify of this exact session's own prior archive
flagged a high-severity transitive advisory (`vite`, via `vitest`'s
tooling) that an earlier identical install hadn't. `npm audit fix`
resolved it without touching `package.json`'s version ranges — only the
lockfile's resolved transitive versions — and all 669 tests still passed
afterward. Run `npm audit` as part of the normal verification sequence
(not just test/typecheck/lint/format/build), not only when something
seems off; a transitive dependency's own newly-published patch or
newly-disclosed advisory doesn't require any change on this project's
side to appear.

**Scratch space can be wiped mid-turn, not just between turns.** It happened
during the version-history work: only the file created after the reset
survived; every new file from earlier in the same turn was gone. Outputs
(including spec files edited directly there) survived. What worked:
`cp -r /mnt/user-data/outputs/neusnet-core/. /home/claude/neusnet-core/`
(note the `/.` — it includes dotfiles), `npm install`, confirm the last
synced test count, then re-create what was lost. **So: sync to outputs
after finishing each module, not once at the end of a turn.** Edit spec
files in outputs directly, as has been the practice.

**How to sync (and how not to):** use
`tar -C /home/claude/neusnet-core --exclude=node_modules --exclude=dist --exclude=coverage -cf - . | tar -C /mnt/user-data/outputs/neusnet-core -xf -`.
`rsync` isn't installed, and `cp -r . dest && rm -rf dest/node_modules` is
a trap: `cp` fails on the symlinks in `node_modules/.bin`, so the `&&`
short-circuits and the cleanup never runs — the copy and the archive end
up containing a partial `node_modules`, and a "clean-room" run from that
archive isn't clean. Check the file count (~45 files, ~95 KB archive) and
that the extracted archive has no `node_modules` before trusting a
verification.

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

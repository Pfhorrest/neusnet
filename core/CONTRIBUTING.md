# Contributing to neusnet-core

## Workflow

This codebase is built test-first. For a new piece of behavior:

1. Read the relevant section of the spec (`../spec/*.md`) closely — don't
   implement from memory or from how a similar protocol works elsewhere.
   Where the spec is ambiguous, that's worth noting explicitly (see
   below), not silently resolving in whichever direction is easiest to
   code.
2. Write the test file first, including the spec's own worked examples
   verbatim where it gives any (as parameterized cases), before writing
   any implementation. A test suite that was written by looking at the
   implementation to see what it does tends to just confirm whatever bugs
   are already there.
3. Implement against the test file. Run it. If something fails, figure
   out whether the test's expectation or the implementation is wrong —
   don't assume it's always the implementation. (This codebase has at
   least one case, in `test/ratings/tags.test.ts`, where a first-draft
   test's own expectation was the bug — the git history is worth a look
   if you want a concrete example of what that looks like.)
4. Run the full verification sequence (below) before considering
   anything done, not just the one test file you were working on.

## Before submitting anything

Run all of these — not just the tests. A green test suite with lint
errors or coverage gaps isn't done:

```bash
npm test              # all tests pass
npm run typecheck      # tsc --noEmit, zero errors
npm run lint            # eslint, zero errors (strict type-aware rules)
npm run format:check    # prettier, zero diffs
npm run test:coverage   # coverage thresholds met (see vitest.config.ts)
npm run build            # tsc actually emits without error
```

If a coverage threshold fails, the right response is almost always to add
a test for whatever branch is uncovered (usually an error path — a
malformed-input case, a thrown exception) rather than lower the
threshold. Lowering a threshold should be rare and should say why in the
commit message.

## Verifying against external specs and tools, not just memory

Where a piece of behavior depends on an external spec (RFC 8785's
canonical number formatting, RFC 4648's base64url alphabet, Unicode's
general category assignments) or a cryptographic primitive (Ed25519),
prefer:

- A well-maintained, widely-used library over a hand-rolled
  implementation, when one exists — see the "Design notes" section of
  [README.md](README.md) for the reasoning and the specific libraries
  already chosen for canonicalization and signing.
- Checking the actual primary source (the RFC text, not a summary of it)
  when a test's expected behavior is unclear or surprising, rather than
  trusting recollection of what the spec "probably" says. This matters
  more than it might seem: an earlier mistaken belief about RFC 8785
  (that it performs Unicode NFC normalization — it explicitly does not)
  had already made it into the written spec before any code existed to
  test it against. Writing the test caught it; trusting memory wouldn't
  have.

## Code style

- Prettier handles formatting; don't hand-format anything, run `npm run
format` and commit the result.
- ESLint's strict, type-aware rule sets are enabled
  (`strictTypeChecked`, `stylisticTypeChecked`) plus a small number of
  project-specific overrides explained inline in `eslint.config.js` —
  read the comments there before assuming a rule is being ignored by
  accident.
- Exported functions have explicit return types (enforced by lint) and a
  doc comment that cites the specific spec section they implement.
- Where a non-null assertion (`!`) is used, it should come with a short
  comment explaining why the indexing/access is safe — not just "trust
  me." See `src/encoding/base64url.ts` for the pattern.

## Scope

This package is the protocol's pure-logic core: canonicalization,
encoding, identity, signing, tag/metadata/rating object validation, trust
graph computation. It has no network, storage, or persistence code, and
pull requests that add any should probably be a different package
instead (a future `neusnet-node`, `neusnet-client`, or similar — nothing
like that exists yet). If you're not sure which side of that line
something falls on, open an issue/discussion before writing code.

## Updating PROGRESS.md

If your change adds or finishes a module, update
[PROGRESS.md](PROGRESS.md) to reflect it — what's implemented, what's
tested, what's explicitly deferred. It's the single source of truth for
project status; let it drift from reality and it stops being useful to
the next person (human or otherwise) who picks this up.

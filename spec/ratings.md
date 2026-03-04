# neusnet Specification Layer 1: Rating Protocol

*Working draft — design phase*

This document specifies the neusnet ratings and trust graph protocol in enough detail to guide implementation and invite critique. It is a companion to [README.md](README.md) (overview and motivation), [metadata.md](metadata.md) (Layer 2: Content Metadata), [identity.md](identity.md) (Layer 3: Identity), and [hosting.md](hosting.md) (Layer 4: Content Hosting and Distribution). Where the README describes *what* and *why*, this document describes *how*.

---

## 1. Fundamental Concepts

### 1.1 Nodes and Edges

The neusnet trust graph contains three kinds of **nodes**:

- **Users** — identified by a stable user identifier (see Layer 3 spec)
- **Posts** — identified by a content identifier (URL, IPFS CID, magnet link, platform-specific ID, etc.)
- **Tags** — identified by their normalized string value (see Section 6)

**Edges** are ratings: directed, weighted, and multidimensional. An edge runs from a rater (always a user) to a target (a post, a tag, or another user directly). The weight of an edge is the rating value on each dimension.

Posts are the central mediating objects in the graph. They connect users (as authors) to tags (as categorizations), and ratings of posts propagate derivatively to both. This is described in detail in Section 3.

### 1.2 Rating Dimensions

Every rating is expressed independently on each of the following core dimensions:

| Dimension | Positive meaning | Negative meaning |
|-----------|-----------------|-----------------|
| **True** | Accurate, well-evidenced | Inaccurate, misleading |
| **Good** | Worthwhile, enjoyable | Unpleasant, harmful |
| **Important** | Significant, deserving attention | Trivial, not worth the time |
| **New** | Original, novel | Derivative, redundant |

Additional dimensions may be defined by communities or individual clients. The protocol treats all dimensions identically; the core four have no special status beyond being the recommended defaults.

Rating values on each dimension are real numbers in the range **[-1, +1]**, where:
- `+1` is the strongest possible positive rating on that dimension
- `-1` is the strongest possible negative rating on that dimension
- `0` is explicit neutrality, equivalent to omitting the dimension from the record
- Omission of a dimension from a rating record is treated as `0` (no opinion expressed)

The recommended default user interface presents only three choices — **+1, 0, −1** — consistent with research showing that users gravitate toward extremes in rating systems and rarely use intermediate values meaningfully. Client software may optionally expose finer-grained input for users who want more precision. The protocol accepts any value in [-1, +1] regardless of how it was entered.

### 1.3 The Independence Principle

Each rating dimension is **fully independent**. The system operates as a set of parallel one-dimensional rating systems, one per dimension, that share the same graph topology but never cross-contaminate. A user's *True* affinity with a peer has no effect on how that peer's *Good* ratings are applied, and vice versa. All formulas in this specification apply independently per dimension; the dimension subscript is omitted for brevity but is always implied.

---

## 2. Rating Records

### 2.1 Schema

A rating record is a signed data structure with the following fields:

```json
{
  "neusnet_version": 1,
  "type":       "rating",
  "rater":      "<user-identifier>",
  "item":       "<item-identifier>",
  "item_type":  "<post | user | tag>",
  "ratings":    { "<dimension>": <value>, "...": "..." },
  "timestamp":  <unix timestamp, integer seconds>,
  "public":     <boolean>,
  "signature":  "<cryptographic signature over all other fields>"
}
```

**`neusnet_version`** — integer. Must be `1` for records conforming to this specification. Allows future versions to be distinguished.

**`type`** — string. Must be `"rating"`. Distinguishes rating records from other neusnet JSON objects.

**`rater`** — the user identifier of the person issuing this rating.

**`item`** — the identifier of the thing being rated. For posts, this is a content identifier (CID, URL, etc.). For users, this is a user identifier. For tags, this is the normalized tag string.

**`item_type`** — disambiguates the type of the item identifier, since the same string could in principle identify different things.

**`ratings`** — a map from dimension name to value in [-1, +1]. Omitted dimensions are treated as 0. An empty ratings map is a valid retraction (see Section 2.3).

**`timestamp`** — Unix timestamp of when the rating was issued. Used for ordering within a user's rating history. Not used for recency weighting in affinity calculation (see Section 4.2).

**`public`** — if `false`, this record is stored locally only and never transmitted to other peers. It still influences the local user's graph traversal and effective scores. If `true`, it is published and may be retrieved by other peers during graph traversal.

**`signature`** — a cryptographic signature over all other fields, using the rater's private key, proving authenticity and preventing tampering. The exact signature scheme is specified in the Layer 3 (Identity) document.

### 2.2 Rating Records as a Collection

Each user's public rating records are published as a single retrievable collection — an array of rating record objects ordered by timestamp ascending. The wire format is JSON (see Section 7 for format rationale and alternatives).

The collection should support retrieval in full. For most users the collection will be small enough (a few hundred to a few thousand records) that full retrieval is not burdensome. For prolific raters with very large collections, clients should support **cursor-based pagination** using timestamp as the cursor: a request may include an `after` parameter specifying a Unix timestamp, and the response returns only records with `timestamp` strictly greater than that value, up to a page size limit. The recommended default page size is 500 records. A response that returns fewer records than the page size indicates the end of the collection.

The collection object's `generated` field serves as a freshness indicator; clients should re-fetch if the cached copy's `generated` timestamp is older than their staleness threshold.

### 2.3 Updating and Superseding Ratings

A user may issue a new rating record for an item they have previously rated. The most recent record (by timestamp) for a given `(rater, item, item_type)` tuple supersedes all earlier records for that tuple. Clients should discard older records for the same tuple when a newer one is available.

A rating may be retracted by issuing a new record with an empty `ratings` map. A retracted rating is treated identically to no rating having been issued.

### 2.4 Self-Rating Convention

When a user publishes a post, the client should automatically issue a synthetic self-rating of +1 for that post on all active dimensions — a normal rating record in every respect, signed by the author and included in their public collection. This gives the author's own posts a baseline positive score before any external ratings arrive.

Self-ratings are fully overridable. An author who wishes to disavow a previous post can retract or replace the self-rating with a lower value, and the post will be treated accordingly by the scoring algorithm with no special cases. No implicit algorithmic rule grants posts a baseline score; the self-rating record is the entire mechanism.

### 2.5 Rating Aggregation Across Versions

Because rating records reference version identifiers rather than stable post identifiers (see metadata.md §2), computing an aggregate score for a post requires collecting ratings across all relevant versions. The procedure is:

1. Build the canonical version history for the post's stable `id` (see metadata.md §5.2).
2. Collect all rating records whose `item` field matches any version identifier in the canonical history, plus any memory-holed versions (whose ratings count against the author per metadata.md §5.2).
3. Collect ratings from any third-party introductions of the same content, where content identity is confirmed via matching immutable content URIs or hash fields (see metadata.md §6.2). These are included in the aggregate.
4. Exclude ratings whose `item` field matches a false claimant version (different author signed as themselves).
5. **Deduplicate by rater**: for each rater, retain only their most recent rating record across all collected versions (by timestamp). This prevents score inflation from a rater re-rating multiple versions of the same post, and prevents authors from self-boosting by publishing many near-identical versions each carrying a self-rating of +1.
6. Apply the trust graph algorithm (Sections 4–5) to the deduplicated rating set.

The default feed view shows the current version with the aggregate score. Clients should additionally:
- Provide per-version score breakdowns in the version history view.
- Visually flag posts where ratings are substantially concentrated on a version other than the current one, as this may indicate content was materially changed after attracting significant attention.

---

## 3. Derivative Ratings: Posts as Mediators

Posts connect users (as authors) to tags (as categorizations). Ratings flow through posts in both directions, producing derivative signals about authors and tags from post ratings, and derivative signals about posts from author and tag affinities.

### 3.1 From Post Ratings to Author and Tag Affinity

When user U rates a post P on dimension D with value V:

- **Author affinity**: U's rating contributes V to U's affinity with P's author on dimension D.
- **Tag affinity**: U's rating contributes V to U's affinity with **each** tag attached to P on dimension D, at full value V per tag.

No dilution is applied across tags. If a post is tagged #funny, #cat, and #cute, a rating of +1 contributes +1 to each of those three tag affinities independently. The tags are all genuinely applicable and the rating is a genuine endorsement of all of them. If U dislikes #cat but likes #funny and #cute, the post will receive two positive and one negative tag contribution when its effective score is computed — the correct behavior, achieved without any dilution.

### 3.2 From Author and Tag Affinities to Post Scores

When computing the effective score of a post P for user U on dimension D, there are up to three contributing terms:

- U's **direct rating** of P (if any)
- U's **effective affinity with P's author** on dimension D
- The **mean of U's effective affinities with each tag** attached to P on dimension D — all tag affinities averaged together into a single term

These three terms are themselves averaged to produce the effective post score. This ensures that tags collectively carry the same weight as the author signal and the direct rating, regardless of how many tags a post has. See Section 5 for the full formula.

### 3.3 Direct User and Tag Ratings

A user may rate another user or a tag directly, without reference to any specific post. These direct ratings are combined with post-derived signals in affinity computation, as described in Section 4.

---

## 4. Affinity

Affinity is the relationship between user U and any other node (user or tag) in the trust graph on a given dimension. It is a value in [-1, +1] representing the strength and direction of U's expressed preference relationship with that node.

### 4.1 Two Components: Derived and Direct

A user or tag may have two sources of affinity signal from U:

- **Derived affinity**: the simple average of U's ratings of all posts relating to the node in question (authored by, or tagged with, that node), on dimension D.
- **Direct affinity**: any explicit direct rating U has issued for that user or tag on dimension D.

These are combined into a **composite affinity** using a configurable weight ratio. The suggested default is **2:1 derived-to-direct**:

```
composite_affinity(U, N, D) =
    (2 × derived_affinity(U, N, D) + 1 × direct_affinity(U, N, D)) / 3
```

When only one signal is present, it is used as-is (no phantom zero is injected for the missing signal).

The 2:1 default reflects the intuition that consistent behavior across many posts represents more deliberate accumulated judgment than a single explicit declaration. The ratio is user-configurable; a user who trusts their own explicit declarations more may increase the direct weight, while one who prefers their behavior to speak for itself may reduce it.

This design produces natural **redemption and fall-from-grace dynamics**: an author you have explicitly downrated can accumulate enough positive post ratings over time to rise above your visibility threshold, while an author you have explicitly uprated can fall below it through sustained poor content.

The same logic applies symmetrically to tags.

### 4.2 Derived Affinity Calculation

```
derived_affinity(U, N, D) = mean({ rating(U, P, D) : P is a post authored by or tagged with N, rated by U on D })
```

If U has issued no ratings contributing to this set, `derived_affinity(U, N, D) = 0`.

**No recency weighting is applied.** All ratings contribute equally regardless of age. This produces reputational inertia: a long positive track record is not easily overturned by a single recent negative rating, and a first bad impression does not persist indefinitely in the face of sustained positive behavior.

### 4.3 Confidence

The number of data points underlying derived affinity is tracked as a **confidence** value:

```
confidence(U, N, D) = count({ ratings contributing to derived_affinity(U, N, D) })
```

Confidence does not gate the use of affinity in computation — a single data point produces a valid affinity value. Confidence is available to client software as a display signal (e.g. a "limited data" indicator). The protocol does not mandate any confidence threshold.

### 4.4 Unknown Nodes

U's affinity with any node they have never directly or derivatively rated is `0`. Effective affinity (Section 4.5) may be non-zero due to graph traversal. This is the correct behavior: U has no personal opinion, but their network does, and that opinion is imported at appropriately decayed weights.

At cold start, when U has rated nothing, all effective affinities are 0 and all effective post scores are 0. The graph fills in as U rates content, initially producing values near {−1, 0, +1} and gradually averaging into more nuanced values as more data accumulates.

### 4.5 Effective Affinity via Graph Traversal

U's **effective affinity** with any node N incorporates not only U's own composite affinity but also the composite affinities of peers at greater graph distances, decayed by distance.

Effective affinity is computed by a **breadth-first traversal** of the trust graph outward from U:

1. **Hop 0**: U's own composite affinity with each directly-related node contributes at weight 1.
2. **Hop H** (H = 1, 2, 3, ...):
   - For each peer P whose shortest path from U is H hops:
     - Retrieve P's public rating collection (or a cached copy from a proximal peer).
     - Compute the **import weight** for P: `composite_affinity(U, P, D) × decay^H`
     - For each node N in P's rating collection: add `import_weight(P) × composite_affinity(P, N, D)` to the accumulator for N.
3. Each node is visited **at most once**. When a node would be reached via multiple paths, only the shortest path counts; longer-path encounters are skipped.
4. Traversal continues until the compute/bandwidth budget is exhausted or the full reachable graph is visited.

The **decay factor** is user-controlled in [0, 1], configurable per dimension. Suggested default: `0.5`.

### 4.6 Sign Inversion and the Enemy-of-My-Enemy Principle

No special handling is required for negative affinity. Because affinity is a signed multiplier applied to rating values, negative affinity automatically inverts imported signals:

- Peer with affinity +0.8 endorses something → positive contribution to U's view.
- Peer with affinity −0.8 endorses something → negative contribution (their endorsement is a warning).
- Peer with affinity −0.8 condemns something → positive contribution (their condemnation is a mild endorsement).

The enemy-of-my-enemy effect emerges from the arithmetic with no additional logic.

---

## 5. Effective Post Scores

The effective score of a post P for user U on dimension D is the mean of up to three terms: direct rating, author affinity, and the mean of tag affinities. Tags are averaged among themselves first, so that the collective tag signal counts as one term regardless of how many tags a post has — equal in weight to the direct rating and author affinity.

```
terms = []

if direct_rating(U, P, D) ≠ 0:
    terms.append(direct_rating(U, P, D))

if effective_affinity(U, author(P), D) ≠ 0:
    terms.append(effective_affinity(U, author(P), D))

tag_affinities = [effective_affinity(U, T, D) for T in tags(P)
                  if effective_affinity(U, T, D) ≠ 0]
if len(tag_affinities) > 0:
    terms.append(mean(tag_affinities))

effective_score(U, P, D) = mean(terms)   // 0 if terms is empty
```

A post tagged #funny, #cat, and #cute where U has affinity +1 for #funny, +1 for #cute, and −0.5 for #cat produces a single tag term of mean(+1, +1, −0.5) = +0.5, which then averages with the author affinity and direct rating on equal footing. A post with fifty tags is not dominated by its tag signals any more than a post with two tags.

Division by zero (empty terms list) returns 0.

### 5.1 Visibility Threshold

Each user configures a **visibility threshold** per dimension. Posts whose effective score falls below the threshold on a given dimension are excluded from the default feed view.

Suggested default: `0` on all dimensions (only net-positive posts appear).

The threshold applies to the **default feed view only**. Posts below the threshold remain accessible via direct link, explicit author search, explicit tag search, or parent-post navigation. The system models user preferences, not user permissions.

### 5.2 Combined Score Across Dimensions

For display purposes, client software may present a single combined score as a user-configured weighted average of per-dimension scores. The protocol does not mandate a combination formula; displaying per-dimension scores separately is equally valid.

---

## 6. Tag Normalization

Tag strings must be normalized before use as identifiers. The normalization procedure is:

1. Apply Unicode NFKC normalization.
2. Lowercase all characters.
3. Strip leading and trailing whitespace and punctuation.
4. Remove all punctuation characters except hyphens.
5. Convert runs of whitespace to a single hyphen.
6. Collapse runs of hyphens to a single hyphen.
7. Strip any remaining leading or trailing hyphens.

The result matches `[a-z0-9][a-z0-9-]*[a-z0-9]` or a single `[a-z0-9]` character. Tags normalizing to the empty string are invalid and must be rejected.

Examples:

| Input | Normalized |
|-------|-----------|
| `"Funny"` | `funny` |
| `"Science Fiction"` | `science-fiction` |
| `"#cat"` | `cat` |
| `"C++"` | `c` |
| `"well-being"` | `well-being` |

---

## 7. Wire Format

Rating record collections are encoded as **JSON**. JSON is human-readable, universally supported, easy to debug, and the natural choice for a project likely to attract web developers. The main costs — verbosity from repeated field names, and base64 encoding of binary signatures — are negligible at typical collection sizes.

If compactness becomes important in a later version, **CBOR** is the recommended migration path: it uses an identical data model to JSON and is a near-drop-in replacement with significantly smaller output and native binary support.

A rating record collection is a JSON object:

```json
{
  "neusnet_version": 1,
  "type":    "rating_collection",
  "owner":   "<user-identifier>",
  "generated": <unix timestamp>,
  "records": [ <rating-record>, ... ],
  "cached": [ <rating-record>, ... ]
}
```

**`records`** — the owner's own public rating records, in ascending timestamp order.

**`cached`** — cached copies of rating records retrieved from the owner's peers, included to enable fast approximate graph traversal. Each cached record retains its original signature so recipients can verify authenticity and later cross-check against the original source. See README §Client Implementation Recommendations for the rationale.

---

## 8. Open Questions

**8.1 Derived-to-direct weight ratio.** The suggested 2:1 default has not been empirically validated. Community feedback and argument about this default are welcome.

**8.2 Non-Latin tag normalization.** The normalization rules in Section 6 handle Latin-script tags well. Tags in other scripts (Arabic, CJK, Cyrillic, etc.) are not excluded but their behavior under these rules should be tested and the rules extended if needed. The recommended direction is Unicode NFKC normalization as a baseline (which handles compatibility equivalences across scripts) followed by script-specific lowercasing using Unicode's locale-independent case folding rules. CJK tags are likely to be case-insensitive by nature but may need whitespace and punctuation stripping rules analogous to those in Section 6. Contributions from native speakers of non-Latin-script languages are especially welcome here.

---

## Appendix A: Notation Summary

| Symbol | Meaning |
|--------|---------|
| U | The local user whose view is being computed |
| P | A post |
| Q | A peer user |
| N | Any node (user or tag) |
| D | A rating dimension |
| H | Graph distance (hops) from U |
| decay | User-configured decay factor ∈ [0, 1] |
| `derived_affinity(U, N, D)` | Mean of U's post ratings relating to node N on D |
| `direct_affinity(U, N, D)` | U's explicit direct rating of node N on D |
| `composite_affinity(U, N, D)` | Weighted combination of derived and direct affinity |
| `effective_affinity(U, N, D)` | Graph-traversal-weighted affinity incorporating peer signals |
| `effective_score(U, P, D)` | Composite score of post P for user U on dimension D |

---

## Appendix B: Worked Example

Alice, Bob, Carol, and Dave are users. `decay = 0.5` throughout. All calculations are on the **True** dimension.

**Setup:**
- Alice rated Bob's post X: True +1
- Alice rated Bob's post Y: True −0.5
- Bob rated Carol's post Z: True +0.8
- Carol rated Dave's post W: True −1.0
- No other ratings exist.

---

**Step 1: Alice's derived affinity with Bob.**

Alice has rated two of Bob's posts: +1 and −0.5.

```
derived_affinity(Alice, Bob) = mean(+1, −0.5) = +0.25
```

No direct rating of Bob exists, so `composite_affinity(Alice, Bob) = +0.25`.

---

**Step 2: Alice's import weight for Bob's ratings of others (hop 1).**

```
import_weight(Alice → Bob) = composite_affinity(Alice, Bob) × decay¹
                           = 0.25 × 0.5
                           = +0.125
```

---

**Step 3: Bob's composite affinity with Carol.**

Bob has rated one of Carol's posts at +0.8.

```
derived_affinity(Bob, Carol) = +0.8
composite_affinity(Bob, Carol) = +0.8
```

---

**Step 4: Alice's import weight for Carol's ratings of others (hop 2).**

Carol is two hops from Alice, reached through Bob. Her import weight chains through Bob's affinity for her and an additional decay:

```
import_weight(Alice → Bob → Carol) = import_weight(Alice → Bob) × composite_affinity(Bob, Carol) × decay¹
                                   = 0.125 × 0.8 × 0.5
                                   = +0.05
```

---

**Step 5: Effective score of Carol's post Z for Alice.**

Bob rated Z at +0.8. Alice's import weight for Bob's ratings is +0.125.

```
effective_score(Alice, Z) = import_weight(Alice → Bob) × rating(Bob, Z)
                          = 0.125 × 0.8
                          = +0.10
```

Z scores +0.10 for Alice — positive but modest, being two hops away through a moderate-affinity chain.

---

**Step 6: Effective score of Dave's post W for Alice.**

Carol rated W at −1.0. Alice's import weight for Carol's ratings is +0.05.

```
effective_score(Alice, W) = import_weight(Alice → Bob → Carol) × rating(Carol, W)
                          = 0.05 × (−1.0)
                          = −0.05
```

W scores −0.05 for Alice — slightly below the default threshold of 0, so it would not appear in her default feed. She can still retrieve it directly if she chooses.

---

**The enemy-of-my-enemy demonstrated.**

Suppose instead Alice had rated Bob's posts negatively: mean −0.25.

```
composite_affinity(Alice, Bob) = −0.25
import_weight(Alice → Bob)     = −0.25 × 0.5 = −0.125
```

Bob rated Z at +0.8:
```
effective_score(Alice, Z) = −0.125 × 0.8 = −0.10
```
Bob's endorsement of Z is now a negative signal for Alice.

And for W, chained through Carol:
```
import_weight(Alice → Bob → Carol) = −0.125 × 0.8 × 0.5 = −0.05
effective_score(Alice, W)          = −0.05 × (−1.0) = +0.05
```

Carol's condemnation of W, filtered through Alice's distrust of Bob who trusts Carol, becomes a mild positive signal. No special logic required — the signed arithmetic handles it automatically.
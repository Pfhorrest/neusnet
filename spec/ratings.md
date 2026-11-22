# neusnet Specification Layer 1: Rating Protocol

*Working draft — design phase*

This document specifies the neusnet ratings and trust graph protocol. It is a companion to [README.md](../README.md) (overview and motivation), [metadata.md](metadata.md) (Layer 2: Content Metadata), [identity.md](identity.md) (Layer 3: Identity), [hosting.md](hosting.md) (Layer 4: Content Hosting and Distribution), and [client-recommendations.md](client-recommendations.md) (client implementation recommendations).

Where the README describes *what* and *why*, this document describes *how*.

---

## 1. Fundamental Concepts

### 1.1 Entities and Categories

The neusnet graph contains three kinds of entities:

- **Users** — identified by stable user identifiers (see `identity.md`).
- **Posts** — identified by content identifiers and associated version histories (see `metadata.md`).
- **Categories** — identified by normalized category names (see Section 6).

These are all ordinary graph entities. No entity type has special ownership, authority, or taxonomy privileges.

A **rating** expresses the degree to which a user associates a target with a category. Its value is a signed number in the range [-1, +1].

The same operation serves two closely related purposes:

- **Categorization:** describing what a target is, concerns, or is associated with.
- **Evaluation:** expressing how positively or negatively a target is regarded along a particular category.

These are not separate protocol operations. Only context and presentation differentiate between a client treating a rating action as categorical or as evaluative. Of particular note, users may globally filter by a selection of categories (see §5.8), and in doing so make a target's effective ratings in those categories the criteria for its inclusion or exclusion in the user's view, and thus in practice evaluative of its worth in the dimensions expressed by those categories (such as `informative`, `enjoyable`, `important`, and `original`, the recommended defaults).

A category is itself an entity and may be rated in another category. This allows users to express relationships between categories using the same mechanism used to categorize posts and users. Categories may be associated with multiple other categories, and those associations may be positive, negative, or neutral.

There are no protocol-defined fixed rating dimensions. Every category is user-defined, and any category may be used to rate any eligible target. Clients may offer conventional defaults, but those defaults have no special status in the protocol.

### 1.2 Rating Values

A rating value is a real number in the range **[-1, +1]**:

- `+1` is the strongest positive association.
- `-1` is the strongest negative association.
- `0` is explicit neutrality.
- `null` serves as a retraction of a prior rating, not a numerical rating itself.

Zero and null are distinct. A zero is an active rating that expresses neutrality; null says that the user has withdrawn any rating of that target in that category.

A missing rating record means that the user has not issued a current rating for that target and category. It is not equivalent to zero, but rather to null: a user issuing a null rating of a target in a category indicates to treat that target as though the user has not rated it in that category.

Clients may expose a simple multiple-choice interface (positive, negative, neutral, and null) or allow finer-grained values. The protocol accepts any numeric value in the permitted range.

### 1.3 Conventional Categories

Clients may offer conventional categories as defaults. The suggested defaults are:

- `informative`
- `enjoyable`
- `important`
- `original`

These are ordinary categories, not reserved protocol dimensions. Users may use other categories, rate categories themselves, and configure their own filters.

There is no protocol-level distinction between a category used for broad feed filtering and one used for a specific subject or quality. That distinction is a client presentation choice.

### 1.4 Unified Graph

Ratings form a unified graph connecting users, posts, and categories. Relationships can be explicit or inferred from patterns of ratings, and can be traversed to derive affinities, taxonomies, and aggregate ratings.

The graph is category-relative: the same entities may be related differently in different categories. Relationships between categories can also allow information to propagate from one category into another.

The graph does not have separate, independent networks for fixed rating dimensions. Categories are entities within the graph, and their relationships are part of the graph itself.

---

## 2. Rating Records

### 2.1 Record Schema

A rating record is a signed data structure representing one user's current or historical rating of one target in one category.

```json
{
  "neusnet_version": 1,
  "type":       "rating",
  "rater":      "<user-identifier>",
  "target":     "<target-identifier>",
  "target_type":"<post | user | category>",
  "category":   "<normalized-category-name>",
  "value":      <number in [-1, +1] | null>,
  "timestamp":  <unix timestamp, integer seconds>,
  "public":     <boolean>,
  "signature":  "<cryptographic signature over all other fields>"
}
```

**`neusnet_version`** — integer. Must be `1` for records conforming to this specification.

**`type`** — string. Must be `"rating"`.

**`rater`** — the user identifier of the person issuing the rating.

**`target`** — the identifier of the entity being rated.

**`target_type`** — identifies the target as a post, user, or category. This disambiguates identifiers that might otherwise have the same string representation.

**`category`** — the normalized category name along which the target is being rated.

**`value`** — a number in [-1, +1], or `null` to retract the rating.

**`timestamp`** — the Unix timestamp at which the rating was issued. Used to determine which record is current for a given user, target, and category. It is not used as a recency weight in aggregation.

**`public`** — if `false`, the record is private and is not transmitted to peers. It still affects the issuing user's local graph and aggregates. If `true`, the record is eligible for distribution to peers.

**`signature`** — a cryptographic signature over all other fields, using the user's private key. The exact signature scheme is specified in `identity.md`.

The tuple `(user, target, category)` identifies the logical rating being updated. A user may have only one current value for a given tuple, although historical superseded records may be retained.

### 2.2 Record Discovery and Exchange

Rating records are discovered and exchanged lazily as clients traverse the graph and request information relevant to their own calculations.

The default exchange should return complete matching rating records rather than requiring a separate inventory request followed by a second request for each record's payload. Rating records are lightweight enough that this two-stage process would often waste bandwidth.

Clients may bundle additional records or cached records when useful, but such bundling is an optimization, not a requirement. A receiving client verifies records locally and determines their current status according to the rules in §2.3.

A client need not retrieve every record belonging to every user. It may limit discovery and exchange according to its available resources and the user's configured preferences. Any resulting aggregates are provisional with respect to the records and graph currently known to that client.

Private records must never be included in peer exchanges, including cached collections.

### 2.3 Updating and Superseding Ratings

A newer record for the same `(user, target, category)` tuple supersedes the older record.

The comparison is based on timestamps:

- A strictly later timestamp supersedes an earlier timestamp.
- Equal timestamps do not establish an ordering.
- A client may retain whichever equal-timestamp record it encountered first. Different clients may consequently disagree until the user issues a record with a clearly later timestamp.

Records are taken whole. A newer record replaces the previous value entirely; fields are not merged.

A retraction is a normal rating record whose `value` is `null`. It supersedes an earlier numeric value just as any other newer record does. It must remain available as the current version of the rating so that older values are not inadvertently resurrected when records are exchanged.

A later numeric record reinstates a rating after retraction.

There are therefore three relevant states:

1. **No record:** the user has not issued a rating for this target and category.
2. **Numeric value:** the user has an active rating, including an explicit neutral value of zero.
3. **Null value:** the user has explicitly retracted the rating.

Historical superseded records may be retained for auditing or recovery, but only the newest known record determines the current rating. The normative default is to share and request only the newest known record for each tuple.

### 2.4 Visibility and Privacy

Visibility determines whether a record may be distributed; it does not change the record's timestamp precedence.

A private rating affects only the issuing user's local graph and calculations. It is not shared with peers. This applies equally to private numeric ratings and private retractions.

A user's private records may affect inferred relationships, paths, affinities, and aggregates in that user's local graph. Those derived results must also remain private: clients must not transmit inferred relationships, path results, or aggregates that depend on private records.

Peers exchange rating records, not computed aggregates or inferred relationships. Each peer computes its own graph and derived results from the records it has received.

Changing a previously public rating to private does not recall copies that other peers have already received. If the newest record is private, the issuing client must not distribute it, and must not continue distributing an older public record for the same tuple.

Consequently:

- A newer private record suppresses future sharing of the earlier public record.
- Peers that already received the earlier public record may continue using it until they receive a newer public record.
- A private retraction of a previously public rating does not notify peers that the rating was withdrawn.
- To publicly withdraw a previously published rating, the user must issue a public null-valued record.
- To make a rating public again after a newer private record, the user must issue a new, later numeric record with public visibility.

A public null-valued record informs peers that the rating has been retracted. Conforming clients must prefer it over an older numeric record once received. There is no guarantee that every peer will receive the retraction, or that peers will erase historical copies.

Visibility controls distribution, not precedence. A public record does not take precedence over a newer private record merely because it is public.

### 2.5 Timestamp Plausibility

Timestamps are supplied by the user and are not globally synchronized. Their ordering is meaningful only within the same user's records for the same `(target, category)` tuple.

Clients may apply plausibility checks to future timestamps. An implausibly future-dated record may be temporarily withheld from current calculations and reconsidered later. Such records should not be permanently discarded solely because their timestamps appear to be in the future.

The tolerance for future timestamps is a client policy. The protocol does not require a global clock or a network-wide timestamp authority.

### 2.6 Rating Aggregation Across Post Versions

Rating records reference post versions rather than an abstract stable post identity (see `metadata.md`). Computing an aggregate for a post therefore requires collecting ratings across its relevant versions.

The procedure is:

1. Build the canonical version history for the post's stable identity and categorize the other metadata files that claim it (`metadata.md` §5.2).
2. Collect rating records whose targets are versions in the canonical history, including memory-holed versions. Ratings of a memory-holed version still count: an author cannot erase the response to their own words by skipping a version.
3. Collect ratings of third-party introductions and unsigned copies that name the claimed author, but only where content identity is confirmed (`metadata.md` §4.3) against an author-signed version. Introductions are confirmed against author-signed versions only, never against one another. A post with no author-signed version at all (a bridged post whose author has not joined neusnet) has no canonical history; its current version, the *anchor*, stands in for it. The anchor's own ratings are collected, and introductions are confirmed against it.
4. Exclude ratings whose targets are false-claimant versions. A false claimant's version remains a post in its own right, and ratings of it may contribute to relationships involving that post and its named author. It is simply not included in the canonical post's aggregate.
5. **Deduplicate by user and category:** for each user and category, retain only their most recent record across all collected versions. This prevents repeated ratings of different versions from counting as separate evidence. Records are taken whole, consistent with §2.3. A null-valued record is treated like any other newest record and withdraws that user's rating; an earlier rating of another version is not resurrected. If records for the same user and category have equal timestamps, use the same tie-handling rule as §2.3; clients may disagree until a later record resolves the ambiguity.
6. Apply the graph and aggregation rules in Sections 3–5 to the resulting current ratings.

This procedure assumes every rating record has already been validated and its signature verified (`identity.md` §4.4). Ratings of versions that are not part of the post, and records that are not ratings of posts, are not collected.

The default feed view shows the current version with the aggregate score. Clients should additionally:

- Provide per-version score breakdowns in the version history view.
- Visually flag posts where ratings are substantially concentrated on a version other than the current one, as this may indicate that content was materially changed after attracting significant attention.

---

## 3. Inferred Relationships

### 3.1 The Three-Entity Structure of a Rating

Every rating connects three entities:

- The **user** issuing the rating.
- The **target** being rated.
- The **category** in which the target is being rated.

Two ratings can imply a relationship between the entities that differ when they share exactly two of these three fields.

These inferences apply uniformly regardless of the entity types involved. No special rules apply merely because an entity is a user, post, or category.

### 3.2 Shared Target and Category: User Relationships

When two different users rate the same target in the same category, their ratings imply a relationship between those users.

- Similar ratings imply positive affinity.
- Opposing ratings imply negative affinity.
- The magnitude of the relationship reflects the degree of agreement or disagreement.

For example, two users who both rate a post positively in `philosophy` exhibit positive affinity with one another in that category. If one rates it positively and the other negatively, the implied affinity is negative.

The inferred relationship is bidirectional. The shared ratings do not establish which user should influence the other more.

An explicit rating of one user as a target by another user is different: it establishes a directed relationship.

### 3.3 Shared User and Target: Category Relationships

When the same user rates the same target in two different categories, the ratings imply a relationship between those categories.

For example, if a user rates a post positively in `philosophy` and positively in `important`, that is evidence of a positive relationship between those categories. If the ratings have opposing signs, the inferred relationship is negative.

This inferred relationship is bidirectional. The two ratings establish an association but do not establish a direction of implication between the categories.

An explicit rating of one category as a target in another category is different: it establishes a directed relationship, as described in §3.6.

### 3.4 Shared User and Category: Target Relationships

When the same user rates two different targets in the same category, the ratings imply a relationship between those targets.

For example, if a user rates two posts positively in `philosophy`, that is evidence of a positive relationship between those posts in that category. If the ratings have opposing signs, the inferred relationship is negative.

This inference applies to any target types, including users, posts, and categories. The inferred relationship is bidirectional.

### 3.5 Combining Evidence

The three shared-field rules above describe pairwise inferred relationships. If two ratings share fewer than two fields, they do not imply a pairwise relationship under these rules. If all three fields are identical, they refer to the same logical rating and are handled by the record update rules in §2.3.

Multiple pieces of evidence may imply relationships between the same ordered pair of entities. Their contributions are combined using the aggregation mechanism in Section 5 to produce one effective relationship for that ordered pair.

Inferred relationships are bidirectional: the same inferred evidence contributes equally in both directions.

Explicit directed relationships and inferred bidirectional relationships are separate sources of evidence. Neither automatically overrides the other. They are combined through the same aggregation mechanism, with the result potentially differing by direction because explicit relationships may be one-way.

### 3.6 Explicit Category Relationships

A user may explicitly rate a category as a target in another category.

For example, a rating of category `philosophy` in category `important` expresses a directed relationship:

`philosophy → important`

This means that a rating or association expressed in `philosophy` may contribute to an evaluation in `important`. It does not imply the reverse relationship.

Explicit category relationships are directed. They are not automatically mirrored. An inferred relationship between the same categories may still contribute bidirectionally, independently of the explicit relationship.

There is no separate category hierarchy protocol. A client may present categories in nested or hierarchical interfaces, but those presentations are derived from category relationships and are not encoded by punctuation, prefixes, or a special taxonomy structure.

### 3.7 Transitive Inference Through Users

Relationships can propagate through users.

If user A has an effective affinity `a` for user B in category C, and B rates target T with value `r` in category C, the path implies a contribution of:

`a × r`

to A's evaluation of T in category C.

The relationship is category-relative. A's affinity for B in another category does not automatically apply.

This is ordinary graph-path inference, not a new rating record. The contribution is derived from the relationships and rating already present in the graph.

### 3.8 Transitive Inference Through Categories

Relationships can also propagate through categories.

If user A rates target T in category C1 with value `r`, and there is an effective directed relationship `a` from C1 to C2, the path implies a contribution of:

`a × r`

to A's evaluation of T in category C2.

Direction matters. A relationship from C1 to C2 permits propagation from C1 into C2. It does not automatically permit propagation from C2 into C1.

The relationship may be explicit or inferred. An inferred category relationship is bidirectional; an explicit relationship is directed as described in §3.6.

This is also ordinary graph-path inference, not a new rating record.

### 3.9 No Special Authorship Relationship

Authorship is provenance, not a special rating or graph relationship. The protocol does not create an automatic edge between an author and a post.

An author may publish a completely unrated post. If the author chooses to rate their own post, that is an ordinary rating record and participates in inference and aggregation exactly like any other rating.

Clients may encourage authors to categorize their posts, particularly in the conventional categories the author has selected for their own feed filters. Such encouragement is client behavior, not a protocol requirement, but highly recommended to initiate some connection of a new post to the existing trust graph.

---

## 4. Graph Paths and Effective Relationships

### 4.1 Directed Relationship Graph

The relationships described in Section 3 form a directed graph over users, posts, and categories.

Explicit relationships are directed. Inferred pairwise relationships are bidirectional. The graph may therefore contain directed paths, bidirectional edges, and cycles.

The effective relationship between two entities in a particular category context is derived from the current relevant records and the graph paths connecting them.

The graph is not restricted to user-to-user paths. Paths may pass through posts and categories, and all entity types participate under the same rules.

### 4.2 Edge Strength

Each direct or inferred relationship has a signed strength in [-1, +1].

When multiple pieces of evidence contribute to the same ordered pair, they are combined using the direct relationship aggregation rules in Section 5. This produces one effective directed edge for that ordered pair.

An inferred bidirectional relationship contributes to both directions. An explicit directed relationship contributes only in its specified direction unless independent evidence establishes a relationship in the reverse direction.

A path may traverse an edge only in its permitted direction.

### 4.3 Path Strength

The strength of a path is the product of the strengths of its edges.

For a path containing edges with strengths `e1`, `e2`, ..., `en`:

`path_strength = e1 × e2 × ... × en`

Negative strengths invert the sign of subsequent contributions. This naturally produces effects such as the enemy-of-my-enemy principle without special-case logic.

Path strength is independent of graph distance discounting. The distance parameter in Section 5 is applied during aggregation, not while discovering or evaluating individual paths.

### 4.4 Shortest Paths

Only shortest paths between two entities are used to determine their effective relationship.

Shortest-path discovery is structural: it depends on the graph's edges and directions, not on their numeric strengths. A path with zero strength still counts as a path and may be among the shortest paths.

If several distinct shortest paths connect the same ordered pair, calculate the strength of each path and take their arithmetic mean.

Longer paths do not contribute when a shorter path exists. This prevents arbitrarily long cycles and detours from accumulating influence.

Zero-strength paths must not be pruned during traversal. They remain part of the structural graph and count when averaging equally short paths.

### 4.5 Effective Relationship

The effective relationship from entity A to entity B is the arithmetic mean of the strengths of all distinct shortest directed paths from A to B.

If no directed path exists, the entities have no effective relationship through the currently known graph. This is not evidence of a zero relationship; it means the relationship is unknown or unreachable.

If the shortest paths average to zero, the effective relationship is explicitly zero. This is distinct from no path.

Only one effective relationship is used for each ordered pair in subsequent graph traversal and aggregation.

---

## 5. Aggregate Ratings

### 5.1 Overview

An aggregate rating estimates how an evaluator regards a target in a particular category, using the evaluator's own ratings and the ratings of reachable sources in their graph.

The calculation is category-specific. A source's rating of a target in another category is not direct evidence for the category currently being evaluated, although it may contribute to graph relationships that affect the current calculation.

No computed aggregate is transmitted as a protocol rating. Each client derives aggregates locally from the rating records and graph it currently knows.

### 5.2 Sources

For an evaluator A, target T, and category C, a **source** is any entity that has a current, non-null rating of T in C and is reachable from A through the directed graph.

A source may be a user, post, or category. There are no entity-type exceptions.

The evaluator's own current rating is also a source, with self-affinity +1 and graph distance zero.

Each distinct source contributes at most once to a given aggregation. Multiple paths to the same source are combined into one effective relationship before its rating contributes.

A source that is unreachable does not contribute. It is not treated as a zero-affinity source.

A source whose effective affinity is zero contributes neither signed evidence nor influence mass.

A source whose rating is explicitly zero does contribute influence mass if its effective affinity is nonzero. Its rating contributes zero to the signed sum, thereby moderating the aggregate toward neutrality.

A source with a current null-valued record contributes nothing.

### 5.3 Source Contributions

For each source `i`:

- `r_i` is the source's current rating of target T in category C.
- `a_i` is the evaluator's effective relationship to that source in the context of C.
- `d_i` is the shortest directed graph distance from the evaluator to the source.

The source contributes:

`a_i × r_i`

to the signed evidence at its distance layer.

Its influence mass is:

`|a_i|`

A source's affinity is category-relative. The same source may have different effective relationships to the evaluator in different categories.

### 5.4 Distance Layers and Aggregation Parameters

Two configurable parameters control aggregation:

- **α (alpha)** controls how the amount of evidence within each distance layer affects that layer's contribution.
- **δ (delta)** controls how much influence more distant layers receive relative to nearer layers.

Both parameters are in [0, 1].

Increasing α corresponds to giving greater weight to averaging within a layer, rather than allowing large numbers of contributions to accumulate.

Decreasing δ corresponds to giving lesser weight to more distant layers, rather than treating ratings at every distance with the same weight as the evaluator's own.

The default client interface should present a single inverse-binding control (increasing α decreases δ, and vice versa); advanced clients may expose α and δ separately, as well as category-specific settings.

For each distance layer `d`, calculate:

`S_d = Σ (a_i × r_i)` for all sources at distance d

`W_d = Σ |a_i|` for all sources at distance d

For layers where `W_d > 0`, calculate:

`C_d = S_d / W_d^α`

Then calculate the shared normalizer:

`M = max(W_d^(1 - α))` over all layers where `W_d > 0`

Normalize each layer:

`A_d = C_d / M`

Finally, calculate the aggregate:

`R = [Σ (δ^d × A_d)] / [Σ δ^d]`

The sums in the final expression include only layers where `W_d > 0`.

The shared normalizer is intentional: a large layer can affect the relative influence of all other layers. It is not a separate normalization performed independently for each distance layer.

Only calculate powers for layers with `W_d > 0`; implementations must not rely on `0^0`.

If every layer has zero influence mass, the aggregate is null.

### 5.5 Parameter Behavior

The endpoints of α have useful interpretations:

- **α = 0:** contributions within each layer are summed before the shared normalization. Larger layers can exert greater influence because they contain more total evidence.
- **α = 1:** each layer is effectively averaged by its total influence mass before the shared normalization. The shared normalizer is 1, and each represented distance layer receives equal weight before δ is applied.
- **0 < α < 1:** intermediate behavior between summation and averaging.

The endpoints of δ determine distance weighting:

- **δ = 0:** only distance-zero evidence contributes.
- **δ = 1:** every represented distance layer receives equal weight.
- **0 < δ < 1:** more distant layers receive progressively less weight.

The distance-zero layer has weight 1. The next layer has weight δ, the following layer δ², and so on.

The protocol permits α = 0 and δ = 0, including their combination. Implementations must handle these values without undefined arithmetic.

### 5.6 Null and Zero Aggregates

An aggregate is **null** when no usable contribution exists. This includes cases where:

- No relevant current ratings are known.
- All relevant sources are unreachable.
- All relevant ratings have been retracted.
- All reachable sources have zero effective affinity.

A numerical aggregate of zero is different: it means usable evidence exists, but the signed contributions balance to neutrality.

Null must not be silently converted to a numerical zero in the underlying aggregation result. Clients may substitute zero when performing threshold comparisons, as specified in §5.8.

### 5.7 Open-World and Provisional Results

The graph is open-ended. There is no global completeness test, and clients cannot establish that they have discovered every relevant record or path.

An aggregate is therefore provisional with respect to the records and graph currently known to the client.

Discovering a new record may:

- Introduce a new source.
- Change an effective direct relationship.
- Introduce a new path or a shorter path.
- Change the average of multiple shortest paths.
- Change a category relationship and thereby affect propagation into other categories.
- Change affinities and aggregates for other targets.

These changes may cascade through multiple graph paths, categories, targets, and users.

Clients are responsible for invalidating cached results and recomputing derived values when relevant records or relationships change. The protocol does not prescribe a particular caching or recomputation implementation.

Different clients may temporarily calculate different aggregates because they know different portions of the graph. Given the same relevant records, graph, and settings, conforming clients should calculate the same result, allowing for ordinary floating-point tolerances.

The mathematical result should not depend on record-discovery order. Implementations should make path averaging and aggregation order-independent apart from negligible floating-point differences.

### 5.8 Filtering and Thresholds

Clients may filter results using aggregate ratings in one or more categories.

The normative default comparison is an inclusive minimum threshold:

`aggregate >= threshold`

Thresholds are in [-1, +1].

For threshold comparisons only, a null aggregate is treated as zero. This does not change the underlying aggregate from null to zero.

For example, with an inclusive minimum threshold:

| Threshold | Null aggregate |
|-----------|----------------|
| `-1` | Passes |
| `-0.5` | Passes |
| `0` | Passes |
| `+0.25` | Fails |
| `+1` | Fails |

An inclusive maximum threshold uses the same null-as-zero substitution:

`aggregate <= threshold`

Thus a null aggregate fails a maximum threshold of `-0.25`, but passes a maximum threshold of `+0.25`.

Clients may additionally support exclusive comparisons and intervals. Under those comparisons, null is still substituted with zero:

- `> 0` excludes both explicit zero and null.
- `< 0` excludes both explicit zero and null.
- `>= 0` includes both explicit zero and null.
- `<= 0` includes both explicit zero and null.

When multiple filter categories are selected, the normative default is to combine them with **AND**: a result must satisfy every selected category's threshold. Clients may offer OR or more elaborate Boolean expressions as optional features.

The normative simple interface should use one global threshold for all selected categories. Advanced clients may allow separate thresholds per category.

Selecting no filter categories means no category-based filtering.

A category with no ratings has a null aggregate and is handled by the same null-as-zero comparison rules. It receives no special exemption from filtering.

---

## 6. Category Normalization

### 6.1 Category Identifiers

Categories are identified by normalized strings. The normalized identifier is globally shared: two users referring to the same normalized name refer to the same category, even if they intended different meanings or use the word differently.

Categories have no owners, creators with privileged control, authoritative definitions, or registration process. A category becomes known when a valid rating record references it as a target or category.

There is no protocol-level alias, translation, or competing-definition mechanism. Users who disagree about whether a category applies to something may express that disagreement through their own ratings.

### 6.2 Canonical Form

A canonical category identifier:

- Uses Unicode NFKC normalization.
- Uses locale-independent Unicode case folding.
- Uses hyphens to separate words.
- Contains only Unicode letters, numbers, combining marks, and hyphens.
- Has no leading or trailing hyphen.
- Has no consecutive hyphens.

The Unicode version used for normalization and case folding must be specified consistently by conforming implementations. Implementations must not rely on locale-sensitive casing.

Whitespace runs in user input are normalized to a single hyphen. Consecutive hyphens are collapsed, and leading or trailing hyphens are removed.

Punctuation, symbols, and emoji are not permitted in canonical category identifiers. Clients may offer user-facing normalization of punctuation where the intended word boundaries are clear, but must not silently assign arbitrary semantic meaning to punctuation.

Examples of intended normalization include:

| Input | Canonical form |
|-------|----------------|
| `Funny` | `funny` |
| `Science Fiction` | `science-fiction` |
| `well-being` | `well-being` |
| `bob’s burgers` | `bobs-burgers` |
| `will.i.am` | `will-i-am` |
| `bits&bobs` | `bits-bobs` |

A category identifier that cannot be normalized to a valid canonical form must be rejected.

### 6.3 Canonical Record Values

Rating records must contain canonical category identifiers. Clients should normalize user input before creating records.

Receivers must validate canonical identifiers and reject noncanonical values rather than silently normalizing them. This ensures that all clients interpret the same record as referring to the same category.

### 6.4 No Encoded Hierarchy

Category identifiers do not encode hierarchy. Dots, prefixes, punctuation, and other string patterns have no structural meaning in the protocol.

A category relationship must be expressed through an ordinary rating of one category as a target in another category, or inferred from the shared-rating rules in Section 3.

Clients may present related categories in nested or hierarchical interfaces, but those structures are derived from graph relationships and remain client-side presentation choices.

There is no protocol-defined containment relation, taxonomy depth, parent category, or exclusive parent-child structure. A category may be related to multiple other categories, and those relationships may be bidirectionally positive or negative (a la `A iff B` or `A xor B`), or directed (a la `if A then B` and not `if B then A`).

---

## 7. Wire Format

Rating records are encoded as **JSON**. JSON is human-readable, widely supported, and easy to debug. The main costs — repeated field names and base64 encoding of binary signatures — are negligible for typical record sizes.

If compactness becomes important in a later version, **[CBOR](https://cbor.io)** is the recommended migration path. It uses a compatible data model and supports native binary values.

A collection of rating records may be represented as:

```json
{
  "neusnet_version": 1,
  "type":     "rating_collection",
  "owner":    "<user-identifier>",
  "generated": <unix timestamp>,
  "records":  [ <rating-record>, ... ],
  "cached":   [ <rating-record>, ... ]
}
```

**`owner`** — the user identifier associated with the collection.

**`generated`** — the Unix timestamp at which the collection representation was generated. Clients may use this as a freshness indicator.

**`records`** — the owner's own public rating records. Every entry's `rater` must equal `owner`.

**`cached`** — optional cached copies of rating records obtained from other users. Each cached record retains its original signature so recipients can verify its authenticity. Cached records are an exchange optimization, not a separate source of authority or a substitute for local verification.

Neither array may contain a record with `public: false`. Private ratings and derived information that depends on them must never be transmitted.

The collection representation does not imply that all records must be retrieved at once. Clients may exchange matching records incrementally as they discover and traverse the graph.

---

## 8. Open Questions

**8.1 Unicode version.** The canonicalization rules require a common Unicode version for normalization and case folding. The specific version should be selected and stated explicitly before implementations are expected to interoperate.

**8.2 Category normalization of punctuation.** The canonical form excludes punctuation and symbols, but clients may provide convenient transformations when the intended word boundaries are clear. Further implementation experience may help refine the recommended user-input behavior without changing the canonical wire format.

**8.3 Default aggregation parameters.** The α and δ controls are configurable. Recommended defaults and user-interface presentation can be refined through client experimentation and community feedback.

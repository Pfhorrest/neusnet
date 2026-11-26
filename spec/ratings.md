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

These are not separate protocol operations. Only context and presentation differentiate between a client treating a rating action as categorical or as evaluative.

Of particular note, users may globally filter by a selection of categories (see §5.9), and in doing so make a target's effective ratings in those categories the criteria for its inclusion or exclusion in the user's view. This makes the ratings evaluative in practice, expressing the target's worth along the dimensions expressed by those filter categories (such as `informative`, `enjoyable`, `important`, and `original`, the recommended defaults).

A category is itself an entity and may be rated as a target in another category. This allows users to express relationships between categories using the same mechanism used to categorize posts and users. Categories may be associated with multiple other categories, and those associations may be positive, negative, or neutral.

There are no protocol-defined fixed rating dimensions. Every category is user-defined, and any category may be used to rate any eligible target. Clients may offer conventional defaults, but those defaults have no special status in the protocol.

### 1.2 Rating Values

A rating value is a real number in the range **[-1, +1]**:

- `+1` is the strongest positive association.
- `-1` is the strongest negative association.
- `0` is explicit neutrality.
- `null` serves as a retraction of a prior rating, not a numerical rating itself.

Zero and null are distinct. A zero is an active rating that expresses neutrality; null says that the user has withdrawn any rating of that target in that category.

A missing rating record means that the user has not issued a rating for that target and category. Like a null-valued current record, it supplies no active rating to inference or aggregation. Unlike a null-valued record, however, its absence is not a retraction record and cannot supersede an older record during synchronization.

A null-valued record is a tombstone: it explicitly withdraws any earlier rating and must be retained as the newest known state so that an older numeric value is not inadvertently resurrected.

Clients may expose a simple multiple-choice interface (positive, negative, neutral, and null) or allow finer-grained values. The protocol accepts any numeric value in the permitted range.

### 1.3 Conventional Categories

Clients may offer conventional categories as defaults. The suggested defaults are:

- `informative`
- `enjoyable`
- `important`
- `original`

These are ordinary categories, not reserved protocol dimensions. Users may use other categories, rate categories themselves, and configure their own filters.

There is no protocol-level distinction between a category used for broad feed filtering and one used for a specific subject or quality. That distinction is a client presentation choice.

### 1.4 The Unified Rating Graph

Every rating connects three entities in three distinct roles:

1. The **user** issuing the rating.
2. The **target** being rated.
3. The **category** in which the target is being rated.

These three roles form a conceptual **rating triangle**. The rating user can also be referred to as the *rater*: they are the user evaluating the target or associating it with something. The category can likewise also be understood as the rating's *destination*: it is the category in which the target is being associated or evaluated.

The target may be a user, post, or category. The rater is always a user, and the destination is always a category.

The role positions remain distinct even when an entity occupies more than one role, as with a user rating themselves. A rating triangle is a conceptual three-role relationship, not a requirement that all three entity identifiers be different.

The graph is built from these rating triangles. Valid combinations of two triangles can imply additional, derived rating triangles. Those derived triangles can in turn participate in further inferences, creating paths through users, posts, and categories.

There are no separate graph systems for ratings, categorization, trust, or taxonomy. These are different interpretations and uses of the same rating operation and its resulting graph.

The graph is category-relative: the same entities may be related differently in different categories. Relationships between categories can also allow information to propagate from one category into another.

---

## 2. Rating Records

### 2.1 Record Schema

A rating record is a signed data structure representing one user's current or historical rating of one target in one category.

```json
{
  "neusnet_version": 1,
  "type":        "rating",
  "rater":       "<user-identifier>",
  "target":      "<target-identifier>",
  "target_type": "<post | user | category>",
  "category":    "<normalized-category-name>",
  "value":       <number in [-1, +1] | null>,
  "timestamp":   <unix timestamp, integer seconds>,
  "public":      <boolean>,
  "signature":   "<cryptographic signature over all other fields>"
}
```

**`neusnet_version`** — integer. Must be `1` for records conforming to this specification.

**`type`** — string. Must be `"rating"`.

**`rater`** — the user identifier of the person issuing the rating.

**`target`** — the identifier of the entity being rated.

**`target_type`** — identifies the target as a post, user, or category. This disambiguates identifiers that might otherwise have the same string representation.

**`category`** — the normalized category name along which the target is being rated. This is the rating triangle's destination.

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

The first and third states have the same meaning for inference and aggregation: a retracted rating makes it as though the user has not issued a rating; but it explicitly tells other clients that any earlier rating has been withdrawn, with a timestamped record that prevents older ratings from being resurrected when records are exchanged.

Historical superseded records may be retained for auditing or recovery, but only the newest known record determines the current rating. The normative default is to share and request only the newest known record for each tuple.

Only current non-null numeric ratings form rating triangles for inference and aggregation. A current null-valued record is retained for synchronization but does not form a triangle.

### 2.4 Visibility and Privacy

Visibility determines whether a record may be distributed; it does not change the record's timestamp precedence.

A private rating affects only the issuing user's local graph and calculations. It is not shared with peers. This applies equally to private numeric ratings and private retractions.

A user's private records may affect inferred relationships, paths, and aggregates in that user's local graph. Those derived results must also remain private: clients must not transmit inferred relationships, derived rating triangles, path results, or aggregates that depend on private records.

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
6. Apply the graph-path and aggregation rules in Sections 3–5 to the resulting current ratings.

This procedure assumes every rating record has already been validated and its signature verified (`identity.md` §4.4). Ratings of versions that are not part of the post, and records that are not ratings of posts, are not collected.

The default feed view shows the current version with the aggregate score. Clients should additionally:

- Provide per-version score breakdowns in the version history view.
- Visually flag posts where ratings are substantially concentrated on a version other than the current one, as this may indicate that content was materially changed after attracting significant attention.

---

## 3. Inference Rules

### 3.1 Rating-Triangle Notation

For clarity, this specification uses the notation:

`R(u, t, c; v)`

to represent a rating triangle in which:

- `u` is the user/rater.
- `t` is the target.
- `c` is the category/destination.
- `v` is the rating value or derived strength.

For example:

`R(Alice, Bob, philosophy; +0.8)`

means Alice rates Bob +0.8 in `philosophy`.

Likewise:

`R(Alice, philosophy, important; +0.7)`

means Alice rates the category `philosophy` +0.7 in the category `important`.

A valid rating triangle always has one user/rater role, one target role, and one category/destination role. The target may itself be a user, post, or category.

The role of an entity in a triangle matters. Two triangles sharing the same entity identifiers do not necessarily form a valid inference: the roles those entities occupy must also match one of the inference rules below.

### 3.2 The Four Valid Inference Rules

Only the following four rules produce inferred rating triangles. Each rule combines two valid rating triangles that share two entities in the required roles, producing one or two additional triangles.

The strength of each inferred triangle is the product of the strengths of the two input triangles.

#### Rule 1: User Affinity Through a Shared Target and Category

When two different users rate the same target in the same category, their ratings imply an affinity between those users in that category.

Given:

```text
R(u1, t, c; a)
R(u2, t, c; b)
```

where `u1` and `u2` are different users, infer:

```text
R(u1, u2, c; a × b)
R(u2, u1, c; a × b)
```

The inferred relationship is bidirectional because the two ratings establish agreement or disagreement but do not establish which user should influence the other more.

- Similar ratings imply positive affinity.
- Opposing ratings imply negative affinity.
- The magnitude reflects the degree of agreement or disagreement.

For example, two users who both rate a post positively in `philosophy` exhibit positive affinity in that category. If one rates it positively and the other negatively, the implied affinity is negative.

An inferred user relationship remains associated with the category in which the shared ratings occurred. It is not an unconditional relationship that must apply equally in every category.

#### Rule 2: Category Affinity Through a Shared User and Target

When the same user rates the same target in two different categories, their ratings imply an affinity between those categories in the context of that user.

Given:

```text
R(u, t, c1; a)
R(u, t, c2; b)
```

where `c1` and `c2` are different categories, infer:

```text
R(u, c1, c2; a × b)
R(u, c2, c1; a × b)
```

The inferred relationship is bidirectional. The two ratings establish an association between the categories but do not establish a direction of implication.

- Similar ratings imply positive affinity.
- Opposing ratings imply negative affinity.
- The magnitude reflects the degree of agreement or disagreement.

For example, if a user rates a post positively in `philosophy` and positively in `important`, that is evidence of a positive relationship between those categories for that user's ratings. If the ratings have opposing signs, the inferred relationship is negative.

The inferred triangles retain the shared user as their rater. The inference does not remove that user and turn the result into an unqualified, user-independent category relationship.

#### Rule 3: Transitivity Through a User

When one user rates another user in a category, and that second user rates a target in the same category, the first user's rating can propagate through the second user.

Given:

```text
R(u1, u2, c; a)
R(u2, t, c; b)
```

infer:

```text
R(u1, t, c; a × b)
```

This inference is directed. It transfers the second user's rating to the first user, weighted by the first user's relationship to the second user.

For example, if Alice rates Bob positively in `philosophy`, and Bob rates a post positively in `philosophy`, Alice receives a positive inferred rating of that post in `philosophy`.

The reverse inference does not follow automatically.

The user relationship may be explicit or inferred through Rule 1. In either case, its category/destination role must align with the category in which rating is being propagated.

#### Rule 4: Transitivity Through a Category

When a user rates a target in one category and also rates that category as a target in another category, the first rating can propagate into the second category.

Given:

```text
R(u, t, c1; a)
R(u, c1, c2; b)
```

infer:

```text
R(u, t, c2; a × b)
```

This inference is directed. A relationship from `c1` to `c2` permits propagation from `c1` into `c2`; it does not automatically permit propagation in the reverse direction.

For example, if Alice rates a post positively in `philosophy` and rates `philosophy` positively in `important`, Alice receives a positive inferred rating of that post in `important`.

The reverse inference does not follow automatically.

The category relationship may be explicit or inferred through Rule 2. In either case, its user/rater role must align with the user whose rating is being propagated.

### 3.3 No Other Pairwise Inferences

The four rules in §3.2 are exhaustive. Two rating triangles do not imply an additional rating merely because they share two entities or because the remaining vertices could be arranged into a structurally valid rating triangle.

In particular, **there is no target-to-target inference**.

If the same user rates two different targets in the same category, the ratings establish that the user associates both targets with that category. They do not establish a relationship between the targets themselves.

For example:

```text
R(Alice, Post1, important; +1)
R(Alice, Post2, important; +1)
```

does not imply either:

```text
R(Alice, Post1, Post2; ...)
```

or:

```text
R(Alice, Post2, Post1; ...)
```

Neither would be a meaningful inference from the original ratings. The fact that a resulting triangle might be structurally interpretable as a rating is not sufficient to make it semantically justified.

Role alignment is essential. For example:

```text
R(Alice, Bob, philosophy; +1)
R(Bob, philosophy, important; +1)
```

does not imply that Alice rates Bob in `important`, nor that Alice rates `philosophy` in `important`.

Although the two triangles share Bob and `philosophy`, those entities exchange their roles between the triangles. This is neither transitivity through a user nor transitivity through a category as defined by Rules 3 and 4.

More generally:

- Sharing a target and destination permits the user-affinity inference in Rule 1.
- Sharing a rater and target permits the category-affinity inference in Rule 2.
- Sharing a user as both rater and target in the roles required by Rule 3 permits transitivity through that user.
- Sharing a category as both destination and target in the roles required by Rule 4 permits transitivity through that category.
- Other combinations do not imply a rating.

These restrictions prevent unsupported substitutions of one role for another. The user who issued a rating, the target being rated, and the category in which it is rated are not interchangeable.

### 3.4 Strength of Inferences

For every inference in §3.2, the inferred strength is the product of the strengths of its two input triangles.

For input strengths `a` and `b`:

`inferred_strength = a × b`

This applies equally to positive, negative, and zero strengths.

Examples:

| First rating | Second rating | Inferred strength |
|---:|---:|---:|
| `+1.0` | `+1.0` | `+1.0` |
| `+0.8` | `+0.5` | `+0.4` |
| `+0.8` | `-0.5` | `-0.4` |
| `-0.8` | `-0.5` | `+0.4` |
| `+0.7` | `0` | `0` |

A negative relationship reverses the sign of the subsequent contribution. Two negative relationships produce a positive contribution.

A zero-strength inferred triangle remains structurally identifiable as a possible relationship, but it supplies no influence mass in aggregation. It must not be confused with the absence of a path.

### 3.5 No Special Authorship Relationship

Authorship is provenance, not a special rating or graph relationship. The protocol does not create an automatic edge between an author and a post.

An author may publish a completely unrated post. If the author chooses to rate their own post, that is an ordinary rating record and participates in inference and aggregation exactly like any other rating.

Clients may encourage authors to categorize their posts, particularly in the conventional categories the author has selected for their own feed filters. Such encouragement is client behavior, not a protocol requirement, but is highly recommended to initiate some connection of a new post to the existing trust graph.

---

## 4. Derived Triangles and Paths

### 4.1 Derived Rating Triangles

Applying one of the four rules in §3.2 to two valid rating triangles produces one or more **derived rating triangles**.

A derived triangle has the same three roles as an ordinary rating:

- A user/rater.
- A target.
- A category/destination.

Its strength is the product of the strengths of the input triangles.

A derived triangle is a graph structure, not a new rating record. It is not signed by the user occupying its rater role, does not update that user's logical rating tuple, and must never be represented to peers as though that user had explicitly issued it.

Every derived triangle retains the provenance of the input triangles from which it was inferred. If an input triangle is itself derived, its provenance is carried forward recursively.

Derived triangles may be used as inputs to further applications of the four inference rules. This allows relationships to propagate through multiple users and categories without introducing any additional inference rules.

### 4.2 Separate Paths and Separate Evidence

Different valid paths remain distinct even when they produce triangles with the same user, target, and category.

An explicit rating is never merged with inferred relationships into a single edge or averaged together with them to produce one effective direct relationship.

For example, Alice might:

- Explicitly rate Bob `+1` in `important`.
- Have a long history of agreement and disagreement with Bob, implying only `+0.1` affinity through shared ratings in `important`.

These are separate paths of evidence. The explicit rating remains a direct one-triangle relationship. The agreement history remains one or more longer inferred paths.

The inferred affinity does not reduce or dilute the explicit rating. Both may contribute to Alice's evaluation of something Bob rates, at their respective graph distances.

Likewise, multiple inferred relationships are not averaged into one edge before aggregation. Each distinct path retains its own strength, provenance, and distance.

### 4.3 Simple Paths and Provenance

A **path** is a finite sequence of valid rating-triangle joins, following the four inference rules in §3.2. A path may use original rating triangles and derived triangles, but every inference must be justified by the roles and directions of its input triangles.

A path is **simple** when:

- No underlying current rating record is used more than once within that path.
- The same underlying rating evidence is not counted twice merely because it appears in more than one derived triangle.
- A path does not revisit the same directed derived-rating state and thereby close a cycle.

When two derived triangles are joined, their underlying rating-record provenance must be disjoint. Their combined result carries the union of their provenance.

The same user, post, or category may appear repeatedly as a shared context where required by the inference rules. Reusing a category as the common destination of several ratings, for example, does not by itself constitute a cycle. What must not recur is the same underlying rating evidence or the same directed derived relationship state within a single path.

Two paths are distinct when they represent different valid sequences of rating-triangle connections and underlying rating evidence. Swapping the operands of a symmetric inference rule does not create an additional path.

A single current rating record may participate in many different paths, but it may appear only once within any one path.

### 4.4 All Simple Paths Contribute

All distinct simple paths contribute, regardless of their length.

A longer path is not discarded merely because a shorter path also reaches the same user or produces a relationship between the same entities.

This is essential to preserving the distinction between direct trust and inferred affinity. An explicit relationship can provide one path while numerous independent inferred relationships provide additional paths at greater distances.

For example:

- Alice's direct rating of Bob provides a one-triangle relationship path.
- Two ratings of the same target and category by Alice and Bob provide a two-triangle inferred relationship path.
- A further rating by Bob can extend either relationship path to another target.

The paths remain independent contributions. Their distances determine how they are combined during aggregation in Section 5.

There is no shortest-path-only rule, and no single effective relationship is calculated for each ordered pair before aggregation.

### 4.5 Zero-Strength and Retracted Triangles

A zero-strength numeric rating is still a valid rating triangle. It may participate in inference and may form part of a structurally valid path.

A path whose supporting relationships multiply to zero has zero influence. It contributes neither signed evidence nor influence mass in aggregation, but it must not be treated as though the underlying rating records were absent.

A null-valued record is different. It is a retraction, not a numeric rating. It does not form a triangle, cannot be used as an input to inference, and cannot support a path.

If a newer null record supersedes an earlier numeric record, the earlier triangle is no longer part of the current graph.

### 4.6 No Transmission of Derived Graph Data

Peers exchange signed rating records, not derived triangles, inferred relationships, paths, or aggregates.

Each client derives its own graph from the original records it has received. This avoids treating another client's inferences as authoritative and allows each client to account for its own private ratings and configured preferences.

A derived result that depends on any private rating remains private to the client that calculated it.

---

## 5. Aggregate Ratings

### 5.1 Overview

An aggregate rating estimates how an evaluator regards a target in a particular category, using their own ratings and ratings reachable through the graph.

The calculation is category-specific. A rating of a target in another category is not direct evidence for the category currently being evaluated, although it may contribute to a valid path that carries influence or a rating into the current category.

No computed aggregate is transmitted as a protocol rating. Each client derives aggregates locally from the rating records and graph it currently knows.

### 5.2 Contribution Paths

For an evaluator `A`, target `T`, and category `C`, an aggregate is built from all distinct simple paths that validly derive a rating of `T` in `C` for `A`.

Each contribution path has:

- One **terminal rating record**, which is a current, non-null rating of target `T` by some user in some category.
- A **supporting prefix**, consisting of zero or more other current rating records that, through valid applications of the inference rules, connect the evaluator to the terminal rater and/or carry the terminal rating into the category being evaluated.

The terminal rating record is not also used in the supporting prefix. No underlying rating record may be reused within the path.

The terminal rater is the source of the terminal rating. Only users can issue rating records, so terminal sources are users. Posts and categories can still participate as targets and as intermediate entities in paths.

The supporting prefix may contain explicit ratings, inferred user relationships, inferred category relationships, and further transitive inferences. It must form a valid path under the four inference rules in Section 3.

The path may have an empty supporting prefix. This is the evaluator's own current rating of the target in the category being evaluated.

A path with a nonempty supporting prefix represents indirect evidence. For example:

- Alice's direct rating of Bob in `important`, followed by Bob's rating of a post in `important`, is a one-record supporting prefix and has distance 1.
- An inferred affinity between Alice and Bob through a shared target and category requires two supporting rating records. Bob's rating of another post can therefore reach Alice through a path at distance 2.
- Alice's rating of a post in `philosophy`, together with her rating of `philosophy` as a target in `important`, can carry the post rating into `important` through a one-record supporting prefix and has distance 1.

The number of supporting rating records determines the path's distance. The terminal rating record itself is not counted toward that distance.

### 5.3 Path Strength and Contributions

For each contribution path `p`:

- `r_p` is the value of its terminal rating record.
- `a_p` is the product of the values of all rating records in its supporting prefix.
- `d_p` is the number of distinct underlying rating records in its supporting prefix.

If the supporting prefix is empty:

`a_p = +1`

and:

`d_p = 0`

The path contributes:

`a_p × r_p`

to the signed evidence at distance `d_p`.

Its influence mass is:

`|a_p|`

The path's supporting strength is therefore distinct from its terminal rating:

- A nonzero supporting strength combined with a terminal rating of zero contributes influence mass but no signed evidence.
- A zero supporting strength contributes neither signed evidence nor influence mass, regardless of the terminal rating.
- A null terminal rating contributes nothing because null-valued records do not form rating triangles.

A current terminal rating may be reached through more than one distinct simple path. Each path contributes separately, with its own supporting strength and distance.

A source's rating is therefore not counted only once after collapsing all paths to that source. The same rating can contribute through a direct relationship, an inferred relationship, or several independent paths at different distances.

### 5.4 Distance Layers and Aggregation Parameters

Two configurable parameters control aggregation:

- **α (alpha)** controls how the amount of evidence within each distance layer affects that layer's contribution.
- **δ (delta)** controls how much influence more distant layers receive relative to nearer layers.

Both parameters are in [0, 1].

Increasing α corresponds to giving greater weight to averaging within a layer, rather than allowing large numbers of contributions to accumulate.

Decreasing δ corresponds to giving lesser weight to more distant paths, rather than treating ratings at every distance with the same weight as the evaluator's own.

The default client interface should present a single inverse-binding control (increasing α decreases δ, and vice versa); advanced clients may expose α and δ separately, as well as category-specific settings.

For each distance layer `d`, calculate:

`S_d = Σ (a_p × r_p)` for all paths p at distance d

`W_d = Σ |a_p|` for all paths p at distance d

Here, `S_d` is the signed evidence and `W_d` is the total influence mass at that distance.

Define the distance weight:

`w(d, δ) = 1` when `d = 0`

`w(d, δ) = δ^d` when `d > 0`

Only layers satisfying both `W_d > 0` participate in the final aggregate. Call this set of layers `L`.

If `L` is empty, the aggregate is null.

For each layer in `L`, calculate:

`C_d = S_d / W_d^α`

Then calculate the shared normalizer:

`M = max(W_d^(1 - α))` over all layers `d` in `L`

Normalize each layer:

`A_d = C_d / M`

Finally, calculate the aggregate:

`R = [Σ (w(d, δ) × A_d)] / [Σ w(d, δ)]`

where both sums include only layers in `L`.

The shared normalizer is intentional: a large layer can affect the relative influence of all other participating layers. It is not a separate normalization performed independently for each distance layer.

Only calculate powers for layers where `W_d > 0`; implementations must not rely on `0^0`.

The shared normalizer is calculated only over layers that actually participate in the final aggregate.

### 5.5 Parameter Behavior

The endpoints of α have useful interpretations:

- **α = 0:** contributions within each participating layer are summed before the shared normalization. Larger layers can exert greater influence because they contain more total evidence.
- **α = 1:** each participating layer is effectively averaged by its total influence mass before the shared normalization. The shared normalizer is 1, and each represented distance layer receives equal weight before δ is applied.
- **0 < α < 1:** intermediate behavior between summation and averaging.

The endpoints of δ determine distance weighting:

- **δ = 0:** only distance-zero evidence contributes. If no usable distance-zero evidence exists, the aggregate is null even if indirect paths exist.
- **δ = 1:** every represented distance layer receives equal weight.
- **0 < δ < 1:** more distant layers receive progressively less weight.

The distance-zero layer has weight 1. The next layer has weight δ, the following layer δ², and so on.

The protocol permits α = 0 and δ = 0, including their combination. Implementations must handle these values without undefined arithmetic.

### 5.6 Null and Zero Aggregates

An aggregate is **null** when no usable contribution exists. This includes cases where:

- No relevant current ratings are known.
- No valid path connects the evaluator to any relevant rating.
- All relevant ratings have been retracted.
- All available paths have zero supporting strength.

A numerical aggregate of zero is different: it means usable evidence exists, but the signed contributions balance to neutrality.

Null must not be silently converted to a numerical zero in the underlying aggregation result. Clients may substitute zero when performing threshold comparisons, as specified in §5.9.

### 5.7 Worked Example

The following example is illustrative and non-normative.

Suppose Alice is evaluating `PostY` in `important`.

**Direct rating**

Alice has rated `PostY` +0.2 in `important`:

```text
R(Alice, PostY, important; +0.2)
```

This has an empty supporting prefix:

- `a_p = +1`
- `r_p = +0.2`
- `d_p = 0`
- Signed contribution: `+0.2`
- Influence mass: `1`

**Explicit trust in Bob**

Alice has also rated Bob +1 in `important`, and Bob has rated `PostY` +0.5 in `important`:

```text
R(Alice, Bob, important; +1.0)
R(Bob, PostY, important; +0.5)
```

This gives Alice a path to Bob's rating of `PostY`:

- `a_p = +1`
- `r_p = +0.5`
- `d_p = 1`
- Signed contribution: `+0.5`
- Influence mass: `1`

**Inferred affinity for Bob**

Alice and Bob have both rated another post, `PostX`, in `important`:

```text
R(Alice, PostX, important; +1.0)
R(Bob, PostX, important; +0.8)
```

By Rule 1, these imply a bidirectional affinity of `+0.8` between Alice and Bob in `important`.

That inferred relationship can be used in a further path through Bob's rating of `PostY`:

```text
R(Bob, PostY, important; +0.5)
```

The path has:

- Supporting strength `a_p = +1.0 × +0.8 = +0.8`
- Terminal rating `r_p = +0.5`
- Distance `d_p = 2`
- Signed contribution: `+0.4`
- Influence mass: `0.8`

This contribution remains separate from the explicit trust path at distance 1. The inferred affinity does not dilute Alice's explicit +1 rating of Bob.

If Alice and Bob had rated many shared posts, each distinct simple path through a shared target and category could contribute separately at its own distance. α and δ determine how those contributions combine with one another and with nearer evidence.

**Category propagation**

Suppose Alice has also rated `PostY` +0.9 in `philosophy`, and rated `philosophy` +0.8 in `important`:

```text
R(Alice, PostY, philosophy; +0.9)
R(Alice, philosophy, important; +0.8)
```

By Rule 4, these imply a rating of `PostY` in `important` with:

- Supporting strength `a_p = +0.8`
- Terminal rating `r_p = +0.9`
- Distance `d_p = 1`
- Signed contribution: `+0.72`
- Influence mass: `0.8`

This is another distinct path, even though it has the same evaluator, target, and destination as the direct rating and the other paths.

**Explicit neutrality**

Suppose Alice rates Bob +1 in `important`, and Bob rates another post, `PostZ`, exactly zero in `important`:

```text
R(Alice, Bob, important; +1.0)
R(Bob, PostZ, important; 0)
```

The path contributes:

- `a_p = +1`
- `r_p = 0`
- `d_p = 1`
- Signed contribution: `0`
- Influence mass: `1`

The explicit zero therefore counts as evidence and moderates the aggregate toward neutrality.

A null-valued current rating of `PostZ` would not contribute at all. It would mean Bob has withdrawn his rating, rather than explicitly expressed neutrality.

### 5.8 Open-World and Provisional Results

The graph is open-ended. There is no global completeness test, and clients cannot establish that they have discovered every relevant record or path.

An aggregate is therefore provisional with respect to the records and graph currently known to the client.

Discovering a new record may:

- Introduce a new terminal rating contribution.
- Introduce a new direct or inferred path.
- Extend an existing path through another user or category.
- Change the strength of a derived triangle.
- Introduce additional paths at new distances.
- Change the influence mass and signed evidence in one or more distance layers.
- Change aggregates for other targets, categories, or users through further valid paths.

These changes may cascade through multiple graph paths, categories, targets, and users.

Clients are responsible for invalidating cached results and recomputing derived values when relevant records or relationships change. The protocol does not prescribe a particular caching or recomputation implementation.

The number of simple paths can grow rapidly as the graph expands. Clients may use resource limits and incremental computation, but a result that omits paths because of such limits is partial with respect to the currently known graph and should be treated accordingly.

Different clients may temporarily calculate different aggregates because they know different portions of the graph or have explored different portions of its paths. Given the same relevant records, the same set of paths, and the same settings, conforming clients should calculate the same result, allowing for ordinary floating-point tolerances.

The mathematical result should not depend on record-discovery order. Implementations should make path enumeration, path deduplication, and aggregation order-independent apart from negligible floating-point differences.

### 5.9 Filtering and Thresholds

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

### 6.3 Unicode Version Compatibility

Category normalization depends on Unicode normalization and case-folding data. The protocol does not include a Unicode-version field in individual rating records.

Clients must validate category identifiers using a Unicode version they support. A client may accept an identifier if it can establish that the identifier is canonical under a supported version.

If a client cannot validate an identifier under any Unicode version it supports, it must reject the record rather than store or forward an unvalidated category identifier.

Clients must not silently rewrite a received record's category identifier during validation.

Consequently, older clients may reject identifiers that use characters or normalization behavior introduced in newer Unicode versions, while newer clients may be able to validate, retain, and share those records. This compatibility limitation does not require every client to adopt a single Unicode version in advance.

### 6.4 Canonical Record Values

Rating records must contain canonical category identifiers. Clients should normalize user input before creating records.

Receivers must validate canonical identifiers and reject noncanonical values rather than silently normalizing them. This ensures that all clients interpret an accepted record as referring to the same category.

### 6.5 No Encoded Hierarchy

Category identifiers do not encode hierarchy. Dots, prefixes, punctuation, and other string patterns have no structural meaning in the protocol.

A category relationship must be expressed through an ordinary rating of one category as a target in another category, or inferred through the rules in Section 3.

Clients may present related categories in nested or hierarchical interfaces, but those structures are derived from graph relationships and remain client-side presentation choices.

There is no protocol-defined containment relation, taxonomy depth, parent category, or exclusive parent-child structure. A category may be related to multiple other categories, and those relationships may be bidirectionally positive or negative (such as `A iff B` or `A xor B`), or directed (such as `if A then B` without implying `if B then A`).

---

## 7. Wire Format

Rating records are encoded as **JSON**. JSON is human-readable, widely supported, and easy to debug. The main costs — repeated field names and base64 encoding of binary signatures — are negligible for typical record sizes.

If compactness becomes important in a later version, **[CBOR](https://cbor.io)** is the recommended migration path. It uses a compatible data model and supports native binary values.

The rating protocol defines the individual rating record as its wire-format unit. It does not require a `rating_collection` envelope or distinguish an owner's own records from cached records.

Transport implementations may batch multiple rating records into a message or response for efficiency. Such batching is a transport-level choice and does not change the identity, provenance, visibility, or validation requirements of the individual records.

Every record retains its original `rater` and signature so that recipients can verify its authenticity. A recipient determines the current record for each `(rater, target, category)` tuple according to §2.3.

No batch or transport representation may contain a record with `public: false`. Private ratings and derived information that depends on them must never be transmitted.

---

## 8. Open Questions

**8.1 Category input normalization.** The canonical category format is specified in Section 6. Clients may provide convenient user-facing transformations of punctuation where the intended word boundaries are clear. Further implementation experience may help refine recommended input behavior without changing the canonical wire format.

**8.2 Default aggregation parameters.** The α and δ controls are configurable. Recommended defaults and user-interface presentation can be refined through client experimentation and community feedback.

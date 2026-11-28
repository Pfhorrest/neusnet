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

A category is itself an entity and may be rated as a target in another category. This allows users to express relationships between categories using the same mechanism used to categorize posts and users. Categories may be associated with multiple other categories, and those associations may be positive, negative, or neutral.

There are no protocol-defined fixed rating dimensions. Every ordinary category is user-defined, and any category may be used to rate any eligible target. Clients may offer conventional defaults, but those defaults have no special status in the protocol.

One category has a special protocol role: the **root category**, whose identifier is the empty string `""`. Ratings in the root category express general, rather than subject-specific, relevance or evaluation. The root category is still an ordinary category entity for purposes of the rating graph and inference rules; its special role is in how clients interpret it for global visibility.

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

An explicit zero is a genuine evidential contribution. It participates in inference like any other numeric rating. Any valid derivation containing a zero-strength input has strength zero, but that derivation still counts as one contribution during aggregation. This distinguishes an explicitly neutral rating from an absent or retracted rating.

### 1.3 Conventional Categories

Clients may offer conventional categories as defaults. The suggested defaults are:

- `informative`
- `enjoyable`
- `important`
- `original`

These are ordinary categories, not reserved protocol dimensions. Users may use other categories, rate categories themselves, and express preferences about categories through ordinary ratings in the root category.

The root category serves as the mechanism for selecting global filter categories. There is one global threshold, applied to aggregate ratings in the root category. A user's preferences for particular categories are represented by ratings of those categories in the root category, rather than by a separate client-side filter configuration.

### 1.4 The Unified Rating Graph

Every rating connects three entities in three distinct roles:

1. The **user** issuing the rating, called the *rater*.
2. The **target** being rated.
3. The **category** in which the target is being rated, called the *destination*.

These three roles form a conceptual **rating triangle**.

The *target* may be a user, post, or category. The *rater* is always a user, and the *destination* is always a category, with those terms used as necessary to clarify those roles when a second user or category may be involved as the target.

The role positions remain distinct even when an entity occupies more than one role, as with a user rating themselves. A rating triangle is a conceptual three-role relationship, not a requirement that all three entity identifiers be different.

The graph is built from these rating triangles. Valid combinations of two triangles can imply additional, derived rating triangles. Those derived triangles can in turn participate in further inferences, creating derivations through users, posts, and categories.

There are no separate graph systems for ratings, categorization, trust, or taxonomy. These are different interpretations and uses of the same rating operation and its resulting graph.

The graph is category-relative: the same entities may be related differently in different categories. Relationships between categories can also allow information to propagate from one category into another.

The root category participates in the same graph and inference rules. For example, a user may rate another user in the root category to express a general relationship, rate a post in the root category to express a general evaluation, or rate a category in the root category to express a general preference about that category.

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
  "destination": "<normalized-category-name>",
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

**`destination`** — the normalized category name along which the target is being rated. The empty string `""` identifies the root category.

**`value`** — a number in [-1, +1], or `null` to retract the rating.

**`timestamp`** — the Unix timestamp at which the rating was issued. Used to determine which record is current for a given rater, target, and destination. It is not used as a recency weight in aggregation.

**`public`** — if `false`, the record is private and is not transmitted to peers. It still affects the issuing user's local graph and aggregates. If `true`, the record is eligible for distribution to peers.

**`signature`** — a cryptographic signature over all other fields, using the user's private key. The exact signature scheme is specified in `identity.md`.

The tuple `(rater, target, destination)` identifies the logical rating being updated. A user may have only one current value for a given tuple, although historical superseded records may be retained.

### 2.2 Record Discovery and Exchange

Rating records are discovered and exchanged lazily as clients traverse the graph and request information relevant to their own calculations.

The default exchange should return complete matching rating records rather than requiring a separate inventory request followed by a second request for each record's payload. Rating records are lightweight enough that this two-stage process would often waste bandwidth.

Clients may bundle additional records or cached records when useful, but such bundling is an optimization, not a requirement. A receiving client verifies records locally and determines their current status according to the rules in §2.3.

A client need not retrieve every record belonging to every user. It may limit discovery and exchange according to its available resources and the user's configured preferences. Any resulting aggregates are provisional with respect to the records and graph currently known to that client.

Private records must never be included in peer exchanges, including cached collections.

### 2.3 Updating and Superseding Ratings

A newer record for the same `(rater, target, destination)` tuple supersedes the older record.

The comparison is based on timestamps:

- A strictly later timestamp supersedes an earlier timestamp.
- Equal timestamps do not establish an ordering.
- A client may retain whichever equal-timestamp record it encountered first. Different clients may consequently disagree until the user issues a record with a clearly later timestamp.

Records are taken whole. A newer record replaces the previous value entirely; fields are not merged.

A retraction is a normal rating record whose `value` is `null`. It supersedes an earlier numeric value just as any other newer record does. It must remain available as the current version of the rating so that older values are not inadvertently resurrected when records are exchanged.

A later numeric record reinstates a rating after retraction.

There are therefore three relevant states:

1. **No record:** the rater has not issued a rating for this target and destination.
2. **Numeric value:** the rater has an active rating, including an explicit neutral value of zero.
3. **Null value:** the rater has explicitly retracted the rating.

The first and third states have the same meaning for inference and aggregation: a retracted rating makes it as though the user has not issued a rating; but it explicitly tells other clients that any earlier rating has been withdrawn, with a timestamped record that prevents older ratings from being resurrected when records are exchanged.

Historical superseded records may be retained for auditing or recovery, but only the newest known record determines the current rating. The normative default is to share and request only the newest known record for each tuple.

Only current non-null numeric ratings form rating triangles for inference and aggregation. A current null-valued record is retained for synchronization but does not form a triangle.

### 2.4 Visibility and Privacy

Visibility determines whether a record may be distributed; it does not change the record's timestamp precedence.

A private rating affects only the issuing user's local graph and calculations. It is not shared with peers. This applies equally to private numeric ratings and private retractions.

A user's private records may affect inferred relationships, derivations, and aggregates in that user's local graph. Those derived results must also remain private: clients must not transmit inferred relationships, derived rating triangles, derivation results, or aggregates that depend on private records.

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

Timestamps are supplied by the user and are not globally synchronized. Their ordering is meaningful only within the same user's records for the same `(target, destination)` tuple.

Clients may apply plausibility checks to future timestamps. An implausibly future-dated record may be temporarily withheld from current calculations and reconsidered later. Such records should not be permanently discarded solely because their timestamps appear to be in the future.

The tolerance for future timestamps is a client policy. The protocol does not require a global clock or a network-wide timestamp authority.

### 2.6 Rating Aggregation Across Post Versions

Rating records reference post versions rather than an abstract stable post identity (see `metadata.md`). Computing an aggregate for a post therefore requires collecting ratings across its relevant versions.

The procedure is:

1. Build the canonical version history for the post's stable identity and categorize the other metadata files that claim it (`metadata.md` §5.2).
2. Collect rating records whose targets are versions in the canonical history, including memory-holed versions. Ratings of a memory-holed version still count: an author cannot erase the response to their own words by skipping a version.
3. Collect ratings of third-party introductions and unsigned copies that name the claimed author, but only where content identity is confirmed (`metadata.md` §4.3) against an author-signed version. Introductions are confirmed against author-signed versions only, never against one another. A post with no author-signed version at all (a bridged post whose author has not joined neusnet) has no canonical history; its current version, the *anchor*, stands in for it. The anchor's own ratings are collected, and introductions are confirmed against it.
4. Exclude ratings whose targets are false-claimant versions. A false claimant's version remains a post in its own right, and ratings of it may contribute to relationships involving that post and its named author. It is simply not included in the canonical post's aggregate.
5. **Deduplicate by rater and destination:** for each rater and destination, retain only their most recent record across all collected versions. This prevents repeated ratings of different versions from counting as separate evidence. Records are taken whole, consistent with §2.3. A null-valued record is treated like any other newest record and withdraws that user's rating; an earlier rating of another version is not resurrected. If records for the same rater and destination have equal timestamps, use the same tie-handling rule as §2.3; clients may disagree until a later record resolves the ambiguity.
6. Apply the graph derivation and aggregation rules in Sections 3–5 to the resulting current ratings.

This procedure assumes every rating record has already been validated and its signature verified (`identity.md` §4.4). Ratings of versions that are not part of the post, and records that are not ratings of posts, are not collected.

The default feed view shows the current version with the aggregate score. Clients should additionally:

- Provide per-version score breakdowns in the version history view.
- Visually flag posts where ratings are substantially concentrated on a version other than the current one, as this may indicate that content was materially changed after attracting significant attention.

---

## 3. Inference Rules

### 3.1 Rating-Triangle Notation

For clarity, this specification uses the notation:

`R(r, t, d; v)`

to represent a rating triangle in which:

- `r` is the rater.
- `t` is the target.
- `d` is the destination.
- `v` is the rating value or derived strength.

For example:

`R(Alice, Bob, philosophy; +0.8)`

means Alice rates Bob +0.8 in the destination `philosophy`.

Likewise:

`R(Alice, philosophy, important; +0.7)`

means Alice rates the category `philosophy` +0.7 in `important`.

A valid rating triangle always has one rater role, one target role, and one destination role. The rater is always a user, the destination is always a category, and the target may be a user, post, or category.

The role of an entity in a triangle matters. Two triangles sharing the same entity identifiers do not necessarily form a valid inference: the roles those entities occupy must also match one of the inference rules below.

The root category is represented by the empty string in the destination position. For example:

`R(Alice, philosophy, ""; +0.8)`

means Alice rates the category `philosophy` +0.8 in the root category.

### 3.2 The Four Valid Inference Rules

Only the following four rules produce inferred rating triangles. Each rule combines two valid rating triangles that share two entities in the required roles, producing one or two additional triangles.

The strength of each inferred triangle is the product of the strengths of the two input triangles.

#### Rule 1: User Affinity Through a Shared Target and Destination

When two different users rate the same target in the same category, their ratings imply an affinity between those users in that category.

Given:

```text
R(u1, t, d; a)
R(u2, t, d; b)
```

where `u1` and `u2` are different users, infer:

```text
R(u1, u2, d; a × b)
R(u2, u1, d; a × b)
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
R(r, t, c1; a)
R(r, t, c2; b)
```

where `c1` and `c2` are different categories, infer:

```text
R(r, c1, C2; a × b)
R(r, c2, c1; a × b)
```

The inferred relationship is bidirectional. The two ratings establish an association between the categories but do not establish a direction of implication.

- Similar ratings imply positive affinity.
- Opposing ratings imply negative affinity.
- The magnitude reflects the degree of agreement or disagreement.

For example, if a user rates a post positively in `philosophy` and positively in `important`, that is evidence of a positive relationship between those categories for that user's ratings. If the ratings have opposing signs, the inferred relationship is negative.

The inferred triangles retain the shared user as their rater. The inference does not remove that user and turn the result into an unqualified, user-independent category relationship.

The root category is not exempt from this rule. If a user rates the same target in an ordinary category and in the root category, those ratings can imply an affinity between the ordinary category and the root category.

#### Rule 3: Transitivity Through a User

When one user rates another user in a category, and that second user rates a target in the same category, the first user's rating can propagate through the second user.

Given:

```text
R(u1, u2, d; a)
R(u2, t, d; b)
```

infer:

```text
R(u1, t, d; a × b)
```

This inference is directed. It transfers the second user's rating to the first user, weighted by the first user's relationship to the second user.

For example, if Alice rates Bob positively in `philosophy`, and Bob rates a post positively in `philosophy`, Alice receives a positive inferred rating of that post in `philosophy`.

The reverse inference does not follow automatically.

The user relationship may be explicit or inferred through Rule 1. In either case, its destination role must align with the category in which the rating is being propagated.

#### Rule 4: Transitivity Through a Category

When a user rates a target in one category and also rates that category as a target in another category, the first rating can propagate into the second category.

Given:

```text
R(r, t, c1; a)
R(r, c1, c2; b)
```

infer:

```text
R(r, t, c2; a × b)
```

This inference is directed. A relationship from `c1` to `c2` permits propagation from `c1` into `c2`; it does not automatically permit propagation in the reverse direction.

For example, if Alice rates a post positively in `philosophy` and rates `philosophy` positively in `important`, Alice receives a positive inferred rating of that post in `important`.

The reverse inference does not follow automatically.

The category relationship may be explicit or inferred through Rule 2. In either case, its user/rater role must align with the user whose rating is being propagated.

The root category participates in this rule like any other category. For example, a positive rating of `philosophy` in the root category can carry positive ratings in `philosophy` into the root category. This is how a general preference for a category can influence the global visibility of targets associated with it.

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

For every inference in §3.2, the inferred strength is the product of the strengths of the two input triangles.

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

A zero-strength inferred triangle remains structurally valid and can participate in further inferences. Any derivation depending on it has strength zero. Such a derivation still counts as a contribution during aggregation, as specified in Section 5.

### 3.5 No Special Authorship Relationship

Authorship is provenance, not a special rating or graph relationship. The protocol does not create an automatic edge between an author and a post.

An author may publish a completely unrated post. If the author chooses to rate their own post, that is an ordinary rating record and participates in inference and aggregation exactly like any other rating.

Clients may encourage authors to categorize their posts, particularly in categories that the author has positively rated in the root category. Such encouragement is client behavior, not a protocol requirement, but is highly recommended to initiate some connection of a new post to the existing trust graph.

---

## 4. Derived Triangles and Derivations

### 4.1 Derived Rating Triangles

Applying one of the four rules in §3.2 to two valid rating triangles produces one or more **derived rating triangles**.

A derived triangle has the same three roles as an ordinary rating:

- A user/rater.
- A target.
- A category/destination.

Its strength is the product of the strengths of the two input triangles.

A derived triangle is a graph structure, not a new rating record. It is not signed by the user occupying its rater role, does not update that user's logical rating tuple, and must never be represented to peers as though that user had explicitly issued it.

Every derived triangle retains the provenance of the input triangles from which it was inferred. If an input triangle is itself derived, its derivation is carried forward recursively.

Derived triangles may be used as inputs to further applications of the four inference rules. This allows relationships to propagate through multiple users and categories without introducing any additional inference rules.

### 4.2 Separate Derivations and Separate Evidence

Different valid derivations remain distinct even when they produce triangles with the same rater, target, and destination.

An explicit rating is never merged with inferred relationships into a single edge or averaged together with them to produce one effective direct relationship.

For example, Alice might:

- Explicitly rate Bob `+1` in `important`.
- Have a history of agreement and disagreement with Bob, implying an affinity through shared ratings in `important`.

These are separate sources of evidence. The explicit rating remains a direct rating triangle. The agreement history remains one or more derived triangles.

The inferred affinity does not reduce or dilute Alice's explicit rating of Bob. Both may contribute to Alice's evaluation of something Bob rates, through their respective derivations.

Likewise, multiple inferred relationships are not averaged into one edge before aggregation. Each distinct derivation retains its own strength and distance.

### 4.3 Derivation Graphs and Provenance

A **derivation** is a finite directed acyclic graph (DAG) showing how a rating triangle is obtained from original rating records.

- Each **leaf** is an original, current, non-null rating record.
- Each **inference node** represents one application of one of the four rules in §3.2.
- Each inference node has two input triangles, which may themselves be original records or derived triangles.
- The root of the derivation is the resulting rating triangle.

A derivation must be acyclic: no inference may depend, directly or indirectly, on the result it is being used to derive.

The same original rating record may support multiple branches of a derivation. Shared evidence is not deduplicated merely because it appears in more than one branch. If a record's strength contributes to two separate input branches that are subsequently combined, its strength is multiplied into the resulting strength through both branches.

For example, if one original rating is used in two distinct inference branches, and those branches are later combined, the shared rating's strength may occur twice in the product. This is intentional: the record has played two distinct inferential roles in the derivation.

A derivation is distinct when its underlying evidence and sequence of inference applications produce a distinct valid derivation graph. Swapping the operands of a symmetric inference rule does not create an additional derivation.

A single original rating record may participate in many different derivations, and may support multiple branches within one derivation. It is not globally consumed or reserved by the first derivation that uses it.

### 4.4 All Distinct Valid Derivations Contribute

All distinct valid derivations contribute, regardless of their length or the existence of shorter derivations producing the same rating triangle.

A longer derivation is not discarded merely because a shorter derivation also produces the same rater, target, and destination.

This preserves the distinction between direct ratings and inferred evidence. An explicit rating can provide one derivation while numerous independent or overlapping inferred derivations provide additional evidence at greater distances.

For example:

- Alice's direct rating of Bob provides a derivation of a rating of Bob by Alice.
- Two ratings of the same target and destination by Alice and Bob provide a separate derivation of an inferred relationship between them.
- A further rating by Bob can extend either derivation to a rating of another target by Alice.

The derivations remain separate contributions. Their distances determine how they are combined during aggregation in Section 5.

There is no shortest-path-only rule, and no single effective relationship is calculated for each ordered pair before aggregation.

### 4.5 Derivation Strength and Distance

The strength of a derivation is calculated recursively.

- An original rating record has its recorded numeric value as its strength.
- An inference node has a strength equal to the product of the strengths of its two input triangles.

Thus, the strength of a complete derivation is the recursively calculated product implied by all of its inference nodes.

The **distance** of a derivation is the maximum number of inference steps along any branch from its resulting triangle back to an original rating record.

- An original rating record has distance `0`.
- An inference node whose two inputs have distances `d1` and `d2` has distance `1 + max(d1, d2)`.

Distance therefore measures the length of the longest inferential chain supporting the result, not the number of distinct original records in the derivation.

If a shared original rating supports multiple branches, it may occur at different depths along those branches. The derivation's distance is still determined by its longest branch.

Strength and distance are independent properties: strength is calculated by multiplication, while distance is calculated by maximum branch depth.

### 4.6 Zero-Strength and Retracted Triangles

A zero-strength numeric rating is still a valid rating triangle. It may participate in inference and may form part of a structurally valid derivation.

A derivation whose strength is zero remains a valid derivation and contributes one unit to the count of derivations at its distance layer. Its signed contribution is zero, but it still affects the normalization of that layer during aggregation.

A null-valued record is different. It is a retraction, not a numeric rating. It does not form a triangle, cannot be used as an input to inference, and cannot support a derivation.

If a newer null record supersedes an earlier numeric record, the earlier triangle is no longer part of the current graph.

### 4.7 No Transmission of Derived Graph Data

Peers exchange signed rating records, not derived triangles, inferred relationships, derivations, or aggregates.

Each client derives its own graph from the original records it has received. This avoids treating another client's inferences as authoritative and allows each client to account for its own private ratings and configured preferences.

A derived result that depends on any private rating remains private to the client that calculated it.

---

## 5. Aggregate Ratings

### 5.1 Overview

An aggregate rating estimates how an evaluator regards a target in a particular category, using all distinct valid derivations of that rating from the evaluator's currently known graph.

The calculation is category-specific. A rating of a target in another category is not direct evidence for the category currently being evaluated, although it may contribute to a valid derivation that carries a rating into the category being evaluated.

No computed aggregate is transmitted as a protocol rating. Each client derives aggregates locally from the rating records and graph it currently knows.

**Intermediate derived triangles are not aggregated before further inference.** Every valid derivation is propagated through subsequent inference steps with its own strength and distance. α and δ are applied only when calculating the aggregate for the final rater, target, and destination being evaluated.

This is important because aggregating an intermediate triangle could discard information about the separate strengths and distances of its supporting derivations. In particular, opposing derivations that aggregate to zero must remain distinct evidence when propagated further; they must not be collapsed into a zero-strength relationship that erases their evidential contribution.

### 5.2 Contributions

For an evaluator `A`, target `T`, and destination `D`, an aggregate is built from all distinct valid derivations that produce a rating triangle:

`R(A, T, D; v)`

Each such derivation is one **contribution** to the aggregate.

For each contribution `p`:

- `v_p` is the strength of the resulting rating triangle, calculated recursively by multiplying strengths at each inference step.
- `d_p` is the derivation's distance, defined as the maximum number of inference steps along any branch from the resulting triangle to an original rating record.

A direct rating by the evaluator is a derivation with one original-record leaf and no inference nodes. It therefore has distance `0` and contributes its recorded value.

A derivation with one inference step has distance `1` if both inputs are original records. A derivation with deeper branches has a distance equal to its longest branch.

Every distinct valid derivation contributes separately, even when multiple derivations produce the same rating triangle or share some of their original evidence.

The same original rating record may therefore affect an aggregate through multiple derivations. Its strength is included in each derivation's recursively calculated value, and each derivation counts once in its distance layer.

### 5.3 Distance Layers and Aggregation Parameters

Two configurable parameters control aggregation:

- **α (alpha)** controls how the number of contributions within each distance layer affects that layer's contribution.
- **δ (delta)** controls how much influence more distant layers receive relative to nearer layers.

Both parameters are in [0, 1].

Increasing α corresponds to giving greater weight to averaging within a layer, rather than allowing large numbers of contributions to accumulate.

Decreasing δ corresponds to giving lesser weight to more distant derivations, rather than treating evidence at every distance with the same weight as the evaluator's own.

The default client interface should present a single inverse-binding control (increasing α decreases δ, and vice versa); advanced clients may expose α and δ separately.

For each distance layer `d`, calculate:

`S_d = Σ v_p` for all derivations `p` at distance `d`

`N_d = number of distinct derivations at distance d`

Here, `S_d` is the signed sum of derivation strengths, and `N_d` is the derivation count. Every distinct derivation counts exactly once, regardless of its strength.

Define the set of represented distance layers:

`L = {d | N_d > 0}`

If `L` is empty, there are no valid derivations and the aggregate is null.

For each layer in `L`, calculate:

`C_d = S_d / N_d^α`

Then calculate the shared normalizer:

`M = max(N_d^(1 - α))` over all layers `d` in `L`

Normalize each layer:

`A_d = C_d / M`

Define the distance weight:

`w(d, δ) = 1` when `d = 0`

`w(d, δ) = δ^d` when `d > 0`

(For all nonzero `δ`, `δ^d` would be `1` when `d = 0` anyway, but because `δ` can be set to `0` and `0^0` is ambiguous, we specially define `w(d, δ) = 1` in *all* cases where `d = 0`, including when `δ` is set to `0`)

Finally, calculate the aggregate:

`R = [Σ (w(d, δ) × A_d)] / [Σ w(d, δ)]`

where both sums include only layers in `L`.

The shared normalizer is intentional: a large layer can affect the relative influence of all other layers. It is not a separate normalization performed independently for each distance layer.

The shared normalizer is calculated over every represented layer, including layers whose distance weight is zero. A layer with zero distance weight therefore contributes nothing directly to the final weighted sum, but can still affect the shared normalization when `α < 1`.

Only calculate powers for layers where `N_d > 0`; implementations must not rely on `0^0`.

If the denominator of the final expression is zero, the aggregate is null. This can occur when `δ = 0` and no distance-zero derivation exists, even if more distant derivations are available.

### 5.4 Parameter Behavior

The endpoints of α have useful interpretations:

- **α = 0:** contributions within each represented layer are summed before the shared normalization. Larger layers can exert greater influence because they contain more derivations.
- **α = 1:** each represented layer is effectively averaged by its derivation count before the shared normalization. The shared normalizer is 1, and each represented distance layer receives equal weight before δ is applied.
- **0 < α < 1:** intermediate behavior between summation and averaging.

The endpoints of δ determine distance weighting:

- **δ = 0:** only distance-zero evidence contributes directly. If no distance-zero derivation exists, the aggregate is null even if indirect derivations exist.
- **δ = 1:** every represented distance layer receives equal weight.
- **0 < δ < 1:** more distant layers receive progressively less weight.

The distance-zero layer has weight 1. The next layer has weight δ, the following layer δ², and so on.

The protocol permits α = 0 and δ = 0, including their combination. Implementations must handle these values without undefined arithmetic.

When `δ = 0`, represented layers at positive distances still participate in the shared normalizer. For `α < 1`, they may therefore diminish the final aggregate through normalization even though their direct distance weight is zero. When `α = 1`, the shared normalizer is 1, so those zero-weight layers have no effect on the result.

### 5.5 Null and Zero Aggregates

An aggregate is **null** when no usable contribution exists under the selected aggregation settings. This includes cases where:

- No relevant current ratings are known.
- No valid derivation connects the evaluator to a relevant rating.
- All relevant ratings have been retracted.
- Only derivations at distances with zero final distance weight exist, leaving the final denominator zero.

A numerical aggregate of zero is different: it means one or more valid derivations exist and their signed contributions balance to neutrality, or that the available derivations have zero strength.

In particular, a zero-strength derivation is not discarded. It counts toward `N_d`, and if it is the only derivation in a represented layer, that layer's signed sum is zero but its derivation count is one. The resulting aggregate is numerical zero, not null, provided the final distance-weight denominator is nonzero.

Likewise, two or more nonzero derivations may cancel in the signed sum while still counting separately in the denominator. For example, contributions of `+1` and `-1` in the same layer produce:

`S_d = 1 - 1 = 0`

`N_d = 2`

This is a numerical zero representing balanced evidence, not an absence of evidence.

Null must not be silently converted to a numerical zero in the underlying aggregation result. Clients may substitute zero when performing threshold comparisons, as specified in §5.8.

### 5.6 Worked Example

The following example is illustrative and non-normative.

Suppose Alice is evaluating `PostY` in `important`.

**Direct rating**

Alice has rated `PostY` +0.2 in `important`:

```text
R(Alice, PostY, important; +0.2)
```

This is a direct derivation:

- Strength: `+0.2`
- Distance: `0`
- Signed contribution: `+0.2`
- Derivation count: `1`

**Explicit trust in Bob**

Alice has also rated Bob +1 in `important`, and Bob has rated `PostY` +0.5 in `important`:

```text
R(Alice, Bob, important; +1.0)
R(Bob, PostY, important; +0.5)
```

This derives a rating of `PostY` by Alice:

- Derivation strength: `+1.0 × +0.5 = +0.5`
- Distance: `1`
- Signed contribution: `+0.5`
- Derivation count: `1`

**Inferred affinity for Bob**

Alice and Bob have both rated another post, `PostX`, in `important`:

```text
R(Alice, PostX, important; +1.0)
R(Bob, PostX, important; +0.8)
```

By Rule 1, these imply a bidirectional affinity of `+0.8` between Alice and Bob in `important`.

That inferred relationship can be used in a further derivation through Bob's rating of `PostY`:

```text
R(Bob, PostY, important; +0.5)
```

The resulting derivation has:

- Strength: `+1.0 × +0.8 × +0.5 = +0.4`
- Distance: `2`
- Signed contribution: `+0.4`
- Derivation count: `1`

This contribution remains separate from the explicit trust derivation at distance 1. The inferred affinity does not dilute Alice's explicit +1 rating of Bob.

If Alice and Bob had rated many shared posts, each distinct valid derivation through a shared target and destination could contribute separately at its own distance. α and δ determine how those contributions combine with one another and with nearer evidence.

**Category propagation**

Suppose Alice has also rated `PostY` +0.9 in `philosophy`, and rated `philosophy` +0.8 in `important`:

```text
R(Alice, PostY, philosophy; +0.9)
R(Alice, philosophy, important; +0.8)
```

By Rule 4, these imply a rating of `PostY` in `important` with:

- Derivation strength: `+0.9 × +0.8 = +0.72`
- Distance: `1`
- Signed contribution: `+0.72`
- Derivation count: `1`

This is another distinct derivation, even though it has the same evaluator, target, and destination as the direct rating and the other derivations.

**Shared evidence in separate branches**

Suppose an original rating record participates in two different inference branches, and those branches are later combined to derive a rating of `PostY`.

The shared record's strength is included in the strength calculation of each branch. When the branches are combined, the two branch strengths are multiplied. The shared record's strength therefore affects the resulting derivation through both branches.

This is intentional. The derivation is not reduced by deduplicating shared provenance, because the original rating played two distinct inferential roles.

**Explicit neutrality**

Suppose Alice rates Bob +1 in `important`, and Bob rates another post, `PostZ`, exactly zero in `important`:

```text
R(Alice, Bob, important; +1.0)
R(Bob, PostZ, important; 0)
```

The resulting derivation has:

- Strength: `+1 × 0 = 0`
- Distance: `1`
- Signed contribution: `0`
- Derivation count: `1`

The zero-strength derivation therefore counts as evidence and moderates the aggregate toward neutrality.

A null-valued current rating of `PostZ` would not contribute at all. It would mean Bob has withdrawn his rating, rather than explicitly expressed neutrality.

### 5.7 Open-World and Provisional Results

The graph is open-ended. There is no global completeness test, and clients cannot establish that they have discovered every relevant record or derivation.

An aggregate is therefore provisional with respect to the records and graph currently known to the client.

Discovering a new record may:

- Introduce a new original rating contribution.
- Introduce a new direct or inferred derivation.
- Extend an existing derivation through another user or category.
- Change the strength of a derived triangle.
- Introduce additional derivations at new distances.
- Change the derivation count or signed sum in one or more distance layers.
- Change aggregates for other targets, destinations, or raters through further valid derivations.

These changes may cascade through multiple derivations, destinations, targets, and raters.

Clients are responsible for invalidating cached results and recomputing derived values when relevant records or relationships change. The protocol does not prescribe a particular caching or recomputation implementation.

The number of valid derivations can grow rapidly as the graph expands. Clients may use resource limits and incremental computation, but a result that omits derivations because of such limits is partial with respect to the currently known graph and should be treated accordingly.

Different clients may temporarily calculate different aggregates because they know different portions of the graph or have explored different portions of its derivations. Given the same relevant records, the same set of valid derivations, and the same settings, conforming clients should calculate the same result, allowing for ordinary floating-point tolerances.

The mathematical result should not depend on record-discovery order. Implementations should make derivation enumeration, derivation identity, and aggregation order-independent apart from negligible floating-point differences.

### 5.8 Global Visibility and Threshold

The root category is the universal destination for global visibility and relevance.

A client's global view is determined by the aggregate rating of each candidate target in the root category:

`R(evaluator, target, ""; aggregate)`

The normative default comparison is an inclusive minimum threshold:

`aggregate >= threshold`

The threshold is in [-1, +1].

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

The global threshold applies to the root-category aggregate. There are no separate protocol-level global filters for individual categories, and no independent set of selected filter categories.

A category's rating in the root category expresses its general relevance or desirability. Because categories are targets and category relationships propagate through Rule 4, a positive root rating of a category can cause ratings of targets in that category to contribute positively to their root-category aggregates. A negative root rating can cause them to contribute negatively.

For example, a positive rating of `philosophy` in the root category can carry positive ratings in `philosophy` into the root category. A negative rating of `philosophy` in the root category can carry positive ratings in `philosophy` into negative contributions in the root category.

The root category also permits general ratings of users and posts:

- A positive root rating of a user expresses general trust or favor toward that user, and can influence the propagation of that user's ratings through Rule 3.
- A negative root rating of a user expresses general distrust or disfavor and can reduce or reverse the influence of that user's ratings.
- A positive root rating of a post directly contributes positive evidence toward its global visibility.
- A negative root rating of a post directly contributes negative evidence toward its global visibility.

These are all ordinary ratings and inferences. No separate global trust, vote, or category-filter mechanism is required.

Because category preferences are expressed as ordinary ratings in the root category, they can be shared and discovered through the same network and trust graph as other ratings. They are not limited to a user's private client configuration.

A client may provide interfaces for users to discover, rate, and adjust categories in the root category, but those are client presentation choices. The protocol requires only the ordinary rating records and aggregation rules.

---

## 6. Category Normalization

### 6.1 Category Identifiers

Categories are identified by normalized strings. The normalized identifier is globally shared: two users referring to the same normalized name refer to the same category, even if they intended different meanings or use the word differently.

Categories have no owners, creators with privileged control, authoritative definitions, or registration process. A category is simply the string used to refer to it. It becomes known to a client when a valid rating record references it as a target or destination.

There is no protocol-level alias, translation, or competing-definition mechanism. Users who disagree about whether a category applies to something may express that disagreement through their own ratings.

The empty string `""` is the unique root category identifier. It is the sole exception to the ordinary category normalization rules requiring a nonempty canonical identifier. It does not require a separate creation or registration process; it is simply the unique empty string, with the special root-category semantics defined in this specification.

### 6.2 Canonical Form

An ordinary canonical category identifier:

- Uses Unicode NFKC normalization.
- Uses locale-independent Unicode case folding.
- Uses hyphens to separate words.
- Contains only Unicode letters, numbers, combining marks, and hyphens.
- Has no leading or trailing hyphen.
- Has no consecutive hyphens.
- Is not empty.

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

The empty string is valid only as the root category identifier. A category identifier that cannot be normalized to a valid canonical form must be rejected.

### 6.3 Unicode Version Compatibility

Category normalization depends on Unicode normalization and case-folding data. The protocol does not include a Unicode-version field in individual rating records.

Clients must validate category identifiers using a Unicode version they support. A client may accept an identifier if it can establish that the identifier is canonical under a supported version.

If a client cannot validate an identifier under any Unicode version it supports, it must reject the record rather than store or forward an unvalidated category identifier.

Clients must not silently rewrite a received record's destination category identifier during validation.

Consequently, older clients may reject identifiers that use characters or normalization behavior introduced in newer Unicode versions, while newer clients may be able to validate, retain, and share those records. This compatibility limitation does not require every client to adopt a single Unicode version in advance.

The empty string root identifier is not affected by Unicode normalization or case folding.

### 6.4 Canonical Record Values

Rating records must contain canonical category identifiers as destinations. Clients should normalize user input before creating records.

Receivers must validate canonical identifiers and reject noncanonical values rather than silently normalizing them. This ensures that all clients interpret an accepted record as referring to the same destination category.

The empty string is valid as the root destination and must be preserved exactly.

### 6.5 No Encoded Hierarchy

Category identifiers do not encode hierarchy. Dots, prefixes, punctuation, and other string patterns have no structural meaning in the protocol.

A category relationship must be expressed through an ordinary rating of one category as a target in another category, or inferred through the rules in Section 3.

Clients may present related categories in nested or hierarchical interfaces, but those structures are derived from graph relationships and remain client-side presentation choices.

There is no protocol-defined containment relation, taxonomy depth, parent category, or exclusive parent-child structure. A category may be related to multiple other categories, and those relationships may be bidirectionally positive or negative (such as `A iff B` or `A xor B`), or directed (such as `if A then B` without implying `if B then A`).

The root category does not introduce a separate hierarchy. It is simply the special global category in which general preferences and evaluations are expressed.

---

## 7. Wire Format

Rating records are encoded as **JSON**. JSON is human-readable, widely supported, and easy to debug. The main costs — repeated field names and base64 encoding of binary signatures — are negligible for typical record sizes.

If compactness becomes important in a later version, **[CBOR](https://cbor.io)** is the recommended migration path. It uses a compatible data model and supports native binary values.

The rating protocol defines the individual rating record as its wire-format unit. It does not require a `rating_collection` envelope or distinguish an owner's own records from cached records.

Transport implementations may batch multiple rating records into a message or response for efficiency. Such batching is a transport-level choice and does not change the identity, provenance, visibility, or validation requirements of the individual records.

Every record retains its original `rater` and signature so that recipients can verify its authenticity. A recipient determines the current record for each `(rater, target, destination)` tuple according to §2.3.

No batch or transport representation may contain a record with `public: false`. Private ratings and derived information that depends on them must never be transmitted.

---

## 8. Open Questions

**8.1 Category input normalization.** The canonical category format is specified in Section 6. Clients may provide convenient user-facing transformations of punctuation where the intended word boundaries are clear. Further implementation experience may help refine recommended input behavior without changing the canonical wire format.

**8.2 Default aggregation parameters.** The α and δ controls are configurable. Recommended defaults and user-interface presentation can be refined through client experimentation and community feedback.
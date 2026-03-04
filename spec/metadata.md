# neusnet Specification Layer 2: Content Metadata

*Working draft — design phase*

This document specifies the neusnet content metadata format — the atomic unit of a neusnet post. It is a companion to [README.md](../README.md) (overview and motivation), [ratings.md](ratings.md) (Layer 1: Rating Protocol), [identity.md](identity.md) (Layer 3: Identity), and [hosting.md](hosting.md) (Layer 4: Content Hosting and Distribution).

The examples in this document use [IPFS](https://ipfs.tech)/IPNS terminology (CIDs, IPNS names) as the reference implementation. All concepts generalize to other hosting substrates; see Section 2 for the abstract model and Section 8 for notes on non-IPFS deployments.

---

## 1. Purpose and Role

Every neusnet post is represented by a small **metadata file**: a signed JSON document that identifies the post, its author, its place in the conversation graph, and where its content can be retrieved. The metadata file is designed to be lightweight enough that clients can retrieve and index many of them cheaply, deferring retrieval of actual content payloads until the user chooses to read a post.

The metadata file is the object that gets pinned, gossiped, and indexed. Content payloads — text, images, audio, video, and other media — live separately, referenced by the metadata file but not embedded in it (except for short inline text, as described in Section 4).

---

## 2. Identifiers: Stable ID and Version Identifier

Every neusnet post has two distinct identifiers serving different purposes.

**The stable identifier** (`id`) is an author-controlled address that persists across all edits. It is the anchor of a post's identity over its lifetime. The stable identifier:
- Is declared once at first publication and never changes across versions
- Is what clients navigate to in order to find the current version of a post
- Is the anchor from which canonical version history is constructed (see Section 5)

**The version identifier** is the content-addressed identifier of a specific metadata file — for example, an IPFS CID on IPFS-based deployments, or an equivalent immutable identifier on other substrates. The version identifier:
- Changes with every edit, uniquely identifying each revision
- Is what rating records reference as the `item` field, permanently recording which exact version of a post was rated
- Is what `parent` fields in reply posts reference, recording which exact version was being replied to
- Is what `previous` fields reference to form the version chain

Clients aggregate ratings across all versions of a post by building the canonical version history from the stable `id` (see Section 5.3) and summing ratings across all versions in that history.

### 2.1 Stable Identifier Forms

The stable identifier may take different forms depending on the hosting substrate:

| Substrate | Stable identifier form |
|-----------|----------------------|
| IPFS/IPNS | IPNS name (e.g. `ipns://k51qzi5...`) |
| [AT Protocol](https://atproto.com) | AT URI (e.g. `at://did:plc:abc.../app.bsky.feed.post/xyz`) |
| [Nostr](https://nostr.com) | Replaceable event identifier |
| HTTP | A canonical URL the author demonstrably controls |
| Other | Any stable, author-controlled address |

The stable identifier must be genuinely author-controlled: the author must be able to update what it points to, and no other party should be able to do so. This property is what makes the canonical version history trustworthy (see Section 5.2).

---

## 3. Metadata File Schema

A metadata file is a JSON object. Fields marked **required** must be present in every valid metadata file. Fields marked **optional** may be omitted.

```json
{
  "neusnet_version": 1,
  "type":           "post",
  "id":             "<stable identifier>",
  "author":         "<user identifier>",
  "subject":        "<string>",
  "summary":        "<string>",
  "tags":           ["<normalized tag>", "..."],
  "content":        [ <content-reference>, "..." ],
  "parent":         "<version identifier of parent post>",
  "previous":       "<version identifier of previous version of this post>",
  "timestamp":      <unix timestamp, integer seconds>,
  "signature":      "<cryptographic signature>"
}
```

### Required Fields

**`neusnet_version`** — integer. The version of the neusnet metadata format this file conforms to. Must be `1` for files conforming to this specification. Clients encountering an unrecognized version number should treat the file as opaque and not attempt to interpret it.

**`type`** — string. Must be `"post"`. Distinguishes post metadata files from identity documents and other neusnet JSON objects.

**`id`** — string. The stable identifier for this post (see Section 2). Must be present in every version of the post and must not change between versions.

**`author`** — string. The user identifier of the post's author (see identity.md). Must match the key used to produce the `signature`, if a signature is present. May be omitted only for unsigned bridged posts (see Section 6).

**`tags`** — array of strings. Zero or more tags, each normalized per ratings.md §6. An empty array is valid. Order is not significant.

**`content`** — array of one or more content reference objects (see Section 4). Must contain at least one entry.

**`timestamp`** — integer. Unix timestamp (seconds since epoch) of when this version was published.

### Optional Fields

**`subject`** — string. A short human-readable title. Analogous to an HTML document's `<title>`. Recommended for top-level posts and link aggregation posts; may be omitted for short replies where the content speaks for itself.

**`summary`** — string. A short human-readable excerpt or description for feed previews. Analogous to an HTML `<meta name="description">`. Recommended when content is a long document or an external URL. May be omitted when inline content is present and short enough to display directly.

At least one of `subject`, `summary`, or short inline content should be present so clients have something to display in feed views without fetching the full payload. This is a client recommendation, not a protocol requirement.

**`parent`** — string. The version identifier of the metadata file of the post this is a reply to. Omitted for top-level posts. References the specific version being replied to, not the stable identifier — permanently recording the exact content the reply was responding to.

**`previous`** — string. The version identifier of the immediately preceding version of this post's own metadata file. Omitted in the first published version. Forms a backwards-linked chain that clients can traverse to reconstruct version history. On hosting substrates with native versioning (e.g. IPFS/IPNS), this field is redundant but included for clients that do not query native version history. On substrates without native versioning, this field is the primary mechanism for version chain traversal.

**`signature`** — string. Cryptographic signature over all other fields in JCS canonical form ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785): keys sorted, no insignificant whitespace), using the author's private key. Unsigned posts are permitted in limited circumstances (see Section 6); unsigned posts must omit this field entirely rather than including an empty or null value.

### Field Length Guidance

No hard limits are specified at the protocol level for tag count, subject length, summary length, or inline content length. These are intentionally left as client implementation decisions — different clients may serve different contexts (mobile, desktop, archival, lightweight readers) with legitimately different constraints. Clients may truncate fields for display and may decline to propagate metadata files they consider excessively large.

As informal guidance: `subject` is analogous to an email subject line or HTML `<title>` and works best under 200 characters; `summary` is analogous to a meta description and works best under 500 characters; tag arrays of more than 20 tags are likely to dilute affinity signal and may be treated skeptically by clients. These are recommendations for authors and client implementors, not protocol requirements.

---

## 4. Content References

The `content` field is an array of content reference objects. Multiple references are encouraged for redundancy — a client retrieves content from whichever reference it can reach first. All references in the array must point to semantically identical content; they are mirrors, not alternatives.

Each content reference object:

```json
{
  "uri":            "<content URI>",
  "mime_type":      "<MIME type string>",
  "size":           <size in bytes>,
  "hash":           "<algorithm:hexdigest>",
  "inline_content": "<string>"
}
```

**`uri`** — string. Required. The location or identifier of the content. See Section 4.1 for URI types and their mutability properties.

**`mime_type`** — string. Optional but strongly recommended. A standard MIME type (e.g. `text/plain`, `text/html`, `image/jpeg`, `video/mp4`, `audio/ogg`). Allows clients to make display and prefetch decisions before fetching content.

**`size`** — integer. Optional. Size of the content payload in bytes. Allows clients to make informed prefetch decisions, particularly for large media files. Should reflect the size of the raw content, not any transport encoding.

**`hash`** — string. Optional but strongly recommended when `uri` is a mutable or non-content-addressed reference (HTTPS, IPNS, magnet links, etc.). A cryptographic digest of the content payload, expressed as `algorithm:hexdigest` (e.g. `sha256:abc123...`, `blake3:def456...`). Serves two purposes: integrity verification (confirming that retrieved content matches what the author published) and content identity confirmation across posts (enabling the aggregation described in Section 6.2 even when immutable CIDs are not used). For IPFS CID references, this field is redundant but may be included for cross-substrate compatibility. Recommended algorithm: SHA-256 for broad interoperability; [BLAKE3](https://github.com/BLAKE3-team/BLAKE3) for performance in implementations where it is available.

**`inline_content`** — string. Present only when `uri` is `inline:` (see Section 4.2).

### 4.1 URI Types and Mutability

Content URIs fall into two categories with importantly different trust properties:

**Immutable URIs** — the content at this URI is permanently fixed and cannot be changed after publication. The URI is typically a content-addressed hash of the content itself.

| URI form | Example |
|----------|---------|
| IPFS CID | `ipfs://bafybeig...` |
| Inline marker | `inline:` |
| [BitTorrent](https://www.bittorrent.org) magnet | `magnet:?xt=urn:btih:...` |

**Mutable URIs** — the content at this URI may change after publication. The author (or a server operator) may alter what is served at this address without any record of the change in the neusnet metadata file.

| URI form | Example | Notes |
|----------|---------|-------|
| IPNS name | `ipns://k51qzi5...` | Mutable IPFS pointer |
| HTTPS URL | `https://example.com/post` | Server-controlled |
| Other HTTP | `http://...` | Server-controlled |

This list is not exhaustive; other URI schemes may be used as neusnet deployments evolve.

Clients should warn users when a content reference uses a mutable URI, as the content may have changed since the post was published and since any ratings were given. Immutable URIs are strongly preferred for content payloads. (Note that mutable URIs are appropriate and expected for the post's `id` field — that is their purpose — but content payload URIs should be immutable wherever possible.)

### 4.2 Inline Content

For short text posts, content may be embedded directly in the metadata file by setting `uri` to `inline:` and including an `inline_content` field:

```json
{
  "uri":            "inline:",
  "mime_type":      "text/plain",
  "inline_content": "The actual text of the post goes here."
}
```

Inline content eliminates a separate content fetch for short posts. There is no hard size limit in the protocol; clients may apply their own limits and may decline to display or propagate metadata files they consider excessively large.

---

## 5. Version History and Integrity

### 5.1 Publishing an Edit

When an author publishes a revised version of a post:

1. They produce a new metadata file with the same `id`, updated fields, a new `timestamp`, and a `previous` field pointing to the prior version's identifier.
2. They sign the new metadata file with their author key.
3. They publish it to their hosting substrate, obtaining a new version identifier.
4. They update their stable `id` pointer to the new version.
5. Their client automatically issues a self-rating of +1 for the new version (per ratings.md §2.4).

Prior versions remain accessible at their original version identifiers as long as any peer retains them. Clients should not discard cached prior versions merely because a newer version exists.

### 5.2 Canonical Version History

The canonical version history of a post is scoped to a single author. It is constructed as follows:

1. Resolve the stable `id` to obtain the current version's metadata file.
2. Identify the **canonical author**: the `author` field value in this current version, whose key must match the `signature`. If the current version is not author-signed, walk backwards through `previous` links until an author-signed version is found; that author is the canonical author.
3. Follow `previous` links backwards, including only versions that are signed by the canonical author's key. Versions signed by any other key are excluded from the canonical chain regardless of their `id` or content.
4. The resulting ordered list of author-signed versions is the canonical version history.

Any metadata file that claims a given `id` but does not appear in the canonical version history is **anomalous**. Anomalous posts fall into distinct categories, distinguished by the relationship between their `author` field and their `signature`:

| Category | Author field | Signer | Treatment |
|----------|-------------|--------|-----------|
| **Canonical version** | Canonical author | Canonical author | In history; ratings included in aggregate |
| **Memory-holed version** | Canonical author | Canonical author | Not in chain (skipped by `previous`); ratings still included in aggregate |
| **Third-party introduction** | Canonical author | Different party | Not in chain; ratings may aggregate if content identity confirmed (see Section 6.2) |
| **False claimant** | Different author | That different author | Excluded from aggregate; shown only if directly linked, clearly flagged |

The key properties of this model:

- An author cannot erase community response to their own words by memory-holing a version — those ratings still count.
- A plagiarist who posts someone else's content under a different author identity gains affinity only from ratings explicitly given to their version. This is a social problem the protocol cannot fully solve, but the protocol does not amplify it: the true author's canonical history is unaffected by the plagiarist's post.
- Third-party introductions (where the `author` names the true author but the signer is an introducer) are a legitimate and expected pattern, not fraud, and are handled separately in Section 6.

Clients must:
- Build the canonical version history as the primary record for any post.
- Collect anomalous posts separately and categorize them per the table above.
- Verify lazily that any directly-linked post appears in the canonical history of its claimed `id`, and flag it clearly if it does not.
- Display memory-holed versions and false claimants in version history views, but visually distinguished from canonical versions and from each other.

### 5.3 Aggregating Scores Across Versions

The rules for aggregating ratings across versions of a post — including deduplication by rater, treatment of memory-holed versions, and inclusion of third-party introduction ratings — are specified in ratings.md §2.5, which is the authoritative location for all rating computation logic.

### 5.4 Disavowal

An author who wishes to disavow a post may publish a new version with a `subject` of `"[retracted]"`, an empty or minimal `content` array, and a self-rating of −1 for the new version. This does not delete prior versions — content-addressed storage is immutable — but records the author's explicit disavowal in the canonical version chain and signals to clients that the author no longer endorses the content.

---

## 6. Unsigned and Bridged Posts

### 6.1 Trust Levels

Every metadata file has a trust level determined by the relationship between its `author` field and its `signature`:

| Status | Condition | Meaning |
|--------|-----------|---------|
| **Author-verified** | Signed by the key matching `author` | The named author cryptographically attests to this content |
| **Third-party attested** | Signed by a key that does not match `author` | An introducer attests to having retrieved this content; authorship is attributed but unverified |
| **Unverified** | No `signature` field | No cryptographic attestation of any kind |

Clients must display trust level visibly and consistently. Author-verified posts are the default expected form. Third-party attested and unverified posts should carry clear indicators.

### 6.2 Third-Party Introductions

A third-party introduction is a metadata file where the `author` field names the true author of the content but the `signature` is from a different party (the introducer). This is a legitimate and expected pattern — it is how external content ([Bluesky](https://bsky.social) posts, web articles, etc.) enters the neusnet graph before or instead of the original author posting it themselves.

Third-party introductions are not part of any post's canonical version history (Section 5.2), since they are not signed by the canonical author. Their ratings may nonetheless be included in the aggregate score for a post when content identity is confirmed via matching immutable URIs or hash fields across the introduction and a canonical version — the full aggregation rules are specified in ratings.md §2.5.

This content-matching aggregation applies only to third-party introductions where the `author` field names the canonical author. It does not apply to false claimants (where a different author is named and signed), even if their content happens to match.

When the original author later publishes their own author-verified post for the same `id`, clients should:
- Promote that post to canonical status.
- Aggregate ratings from any prior third-party introductions of the same content, per ratings.md §2.5.
- Display clearly which ratings came from the introduction period and which from after author verification.

### 6.3 Bridged Posts

Posts originating on other platforms participate in the neusnet graph through third-party introductions or, preferably, through the original author publishing their own author-verified metadata file.

For bridged posts:
- The `id` field should be the platform's native stable identifier (e.g. an AT Protocol URI, a canonical URL the author controls).
- The `author` field should name the original author. If the author has a neusnet identity, use their neusnet user identifier. If not, a platform-scoped identifier (e.g. `at://did:plc:abc123`) may be used as an attribution hint, with the understanding that this produces a third-party attested post since no neusnet key exists to verify it against.
- The metadata file should be signed by the introducer, making it third-party attested.
- The `content` array should include a URI pointing to the original content location.

When a bridged post's original author establishes a neusnet identity, they may publish their own author-verified metadata file for the same `id`. Clients should prefer author-verified metadata files over third-party-attested ones for the same `id`.

---

## 7. Open Questions

**7.1 Third-party attestation scope.** The "third-party attested" status in Section 6.1 covers the case where an introducer signs a bridged post. It does not yet specify what claims the introducer's signature covers — for example, "I retrieved this content at this URI at this timestamp and its hash was X" versus simply "I attest this metadata file is accurate." A more precise attestation schema, possibly including a content hash snapshot, would strengthen the integrity guarantees of the introduction mechanism and make content identity confirmation (Section 6.2) more robust.

---

## Appendix A: Minimal Valid Metadata File

A top-level post with short inline text, no subject, no tags:

```json
{
  "neusnet_version": 1,
  "id":        "ipns://k51qzi5uqu5dh6lfh0....",
  "author":    "npub1abc123...",
  "tags":      [],
  "content":   [
    {
      "uri":            "inline:",
      "mime_type":      "text/plain",
      "inline_content": "Hello, neusnet."
    }
  ],
  "timestamp": 1740000000,
  "signature": "sig1abc..."
}
```

## Appendix B: Full-Featured Metadata File

A reply post with redundant content references, edit history, summary, and tags:

```json
{
  "neusnet_version": 1,
  "id":        "ipns://k51qzi5uqu5dh6lfh0....",
  "author":    "npub1abc123...",
  "subject":   "Re: The case for decentralized moderation",
  "summary":   "A counterargument focusing on the cold-start problem and Sybil resistance.",
  "tags":      ["decentralization", "moderation", "trust-graphs"],
  "content":   [
    {
      "uri":       "ipfs://bafybeig...",
      "mime_type": "text/html",
      "size":      142080,
      "hash":      "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    },
    {
      "uri":       "https://example.com/posts/counterargument.html",
      "mime_type": "text/html",
      "hash":      "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
    }
  ],
  "parent":    "<version identifier of parent post>",
  "previous":  "<version identifier of prior version of this post>",
  "timestamp": 1740003600,
  "signature": "sig1abc..."
}
```

## Appendix C: Unsigned Bridged Post

A Bluesky post introduced to neusnet by a third party:

```json
{
  "neusnet_version": 1,
  "id":        "at://did:plc:abc123.../app.bsky.feed.post/xyz",
  "author":    "at://did:plc:abc123...",
  "subject":   "Interesting thread on trust graphs",
  "tags":      ["trust-graphs", "bluesky"],
  "content":   [
    {
      "uri":       "https://bsky.app/profile/abc123.bsky.social/post/xyz",
      "mime_type": "text/html"
    }
  ],
  "timestamp": 1740007200,
  "signature": "sig_of_introducer_not_author..."
}
```
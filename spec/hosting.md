# neusnet Specification Layer 4: Content Hosting and Distribution

*Working draft — design phase*

This document specifies how neusnet content — post metadata files, content payloads, rating collections, and identity documents — is hosted, retrieved, and distributed across the network. It is a companion to [ratings.md](ratings.md), [metadata.md](metadata.md), [identity.md](identity.md), and [README.md](../README.md).

---

## 1. Design Principles

**No single hosting substrate is required.** neusnet content can be hosted on [IPFS](https://ipfs.tech), [BitTorrent](https://www.bittorrent.org), conventional web servers, or any other addressable storage system. The metadata format (Layer 2) abstracts over hosting by expressing content references as URIs, allowing any substrate to serve as the backing store.

**Immutability is strongly preferred for content payloads.** Content-addressed storage — where the identifier is derived from the content itself — provides integrity guarantees that server-hosted content cannot. Clients should prefer immutable references (IPFS CIDs, BitTorrent info hashes) and treat mutable references (HTTPS URLs, IPNS names used as content URIs) with appropriate caution.

**Distribution is a social act.** Content propagates through the network because peers who care about it pin and re-serve it. There is no central CDN, no mandatory infrastructure. A post's availability depends on whether people find it worth preserving — which aligns naturally with the trust graph: content that scores well in your trust graph is content your client helps keep available.

**Interoperability over replacement.** neusnet does not require participants to abandon existing platforms. The hosting layer is designed to overlay on [Fediverse](https://fediverse.info), [RSS](https://www.rssboard.org/rss-specification), [Matrix](https://matrix.org), [XMPP](https://xmpp.org), and other protocols as content sources and distribution channels, meeting users where they already are.

---

## 2. Substrate Taxonomy

Hosting substrates fall into four categories based on their role and properties:

| Category | Substrates | Primary role |
|----------|-----------|--------------|
| **Native decentralized storage** | IPFS, BitTorrent | Primary content hosting; immutable, resilient |
| **Federated server protocols** | [ActivityPub](https://www.w3.org/TR/activitypub/) (Fediverse), [NNTP](https://datatracker.ietf.org/doc/html/rfc3977) | Content source and publishing target |
| **Messaging and transport protocols** | Matrix, XMPP | Gossip and metadata distribution |
| **Syndication formats** | [RSS](https://www.rssboard.org/rss-specification), [Atom](https://datatracker.ietf.org/doc/html/rfc4287) | Lightweight content source and publishing |
| **Plain HTTP** | Any web server | Fallback; always supported |

These categories are not mutually exclusive — a single neusnet deployment may use several substrates simultaneously, and a given piece of content may be reachable via multiple substrate types.

---

## 3. Native Decentralized Storage

### 3.1 IPFS

**IPFS (InterPlanetary File System)** is the preferred hosting substrate for native neusnet content. Its central feature is content addressing: every file is identified by a CID (Content Identifier), a cryptographic hash of the file's contents. This means:

- The identifier guarantees integrity — a file retrieved at a given CID is provably the file the author published.
- The identifier is location-independent — any peer who has the file can serve it.
- Editing a file produces a new CID, making all versions independently retrievable forever.

**What is hosted on IPFS:**
- Post metadata files (each version as a distinct CID)
- Content payloads (text, images, audio, video, documents)
- Identity documents (each version as a distinct CID)
- Rating collections (periodically snapshotted as CIDs for caching)
- Key rotation declarations

**IPNS** (InterPlanetary Name System) provides mutable pointers over IPFS. An IPNS name is derived from a keypair and can be updated by the key holder to point to a new CID. The derivation formula for native neusnet identities is specified in identity.md §5.3. IPNS names serve as stable identifiers for:
- Post identity (`id` field in metadata files) — pointing to the current version's CID
- User identity documents — pointing to the current version's CID

IPNS is used for the *pointer* layer only. Content payloads referenced in metadata files should use IPFS CIDs, not IPNS names, so that retrieved content is immutable and integrity-verifiable (see metadata.md §4.1).

**IPNS propagation and real-time notification:** IPNS record updates can take minutes to propagate across the IPFS DHT, which is too slow for timely delivery of new posts. The recommended mitigation is to use **IPFS pubsub** as a real-time notification channel alongside IPNS for stable resolution: when a user publishes a new post, their client broadcasts the new CID to a pubsub topic derived from their IPNS name. Peers subscribed to that topic receive the new CID immediately and can fetch the content without waiting for IPNS propagation. IPNS remains the authoritative stable pointer for clients that connect later or miss the pubsub notification. This is the approach the broader IPFS ecosystem has converged on for latency-sensitive applications.

**Rating collection snapshots:** Rating collections should be snapshotted and published as IPFS CIDs whenever the collection changes, with a short debounce delay (recommended: 60 seconds) to batch rapid changes. A maximum staleness cap of 24 hours applies: even if no new ratings have been issued, the collection should be re-published at least daily so that peers can verify freshness via the `generated` timestamp. This mirrors the endorsement list publication policy in Section 8.1.

**Pinning:** Content on IPFS is only available as long as at least one peer is pinning it (keeping it in persistent storage). Clients should pin:
- All metadata files and identity documents for users with positive affinity
- Content payloads for posts above the user's visibility threshold, subject to local storage limits
- Key rotation declarations for known users
- Cached rating collections from proximal peers

Users may additionally configure remote pinning services ([Pinata](https://pinata.cloud), [web3.storage](https://web3.storage), etc.) to ensure their own content remains available independently of their local node's uptime.

### 3.2 BitTorrent

**BitTorrent** is a viable alternative or complement to IPFS for content payload hosting, particularly for large files (video, audio, large document archives). BitTorrent's swarm model is well-suited to popular content that many peers want simultaneously.

Content hosted via BitTorrent is referenced by **magnet links** (`magnet:?xt=urn:btih:...`) in metadata file content references. Magnet links are content-addressed (the info hash is a hash of the torrent metadata), providing the same integrity guarantees as IPFS CIDs for the payload.

BitTorrent is less well-suited than IPFS for small files (the overhead of torrent metadata is significant relative to a short text post) and for the metadata layer (post metadata files, identity documents). The recommended pattern is:
- Use IPFS for all metadata files, identity documents, and short content payloads
- Use BitTorrent (with an IPFS fallback reference where possible) for large media files

### 3.3 Client Pinning Policy

A client's pinning set determines what content it helps keep available on the network. The recommended default pinning policy:

| Content type | Pin when |
|-------------|----------|
| Post metadata files | Author has positive effective affinity |
| Identity documents | User has positive effective affinity |
| Key rotation declarations | User is known (any affinity) |
| Content payloads | Post scores above visibility threshold AND payload is below size limit |
| Rating collections (cached) | Rater has positive effective affinity |

Size limits for payload pinning are user-configurable and will vary by device and available storage. Clients should make pinning behavior transparent and allow users to adjust thresholds.

The client's pinning set also serves as its **endorsement list** for gossip: content that a client pins is content it will advertise to peers, creating a natural alignment between curation and distribution.

---

## 4. Federated Server Protocols

### 4.1 ActivityPub and the Fediverse

**ActivityPub** is the W3C-standardized protocol underlying the Fediverse — [Mastodon](https://joinmastodon.org), [Pixelfed](https://pixelfed.org), [PeerTube](https://joinpeertube.org), [Misskey](https://misskey-hub.net), [Lemmy](https://join-lemmy.org), and many others. It defines how actors (users) publish activities (posts, likes, follows) and how servers federate those activities to followers across instances.

ActivityPub integration allows neusnet to participate in the largest existing decentralized social ecosystem without requiring Fediverse users to adopt neusnet natively.

**Reading from the Fediverse:**
A neusnet client can subscribe to ActivityPub actors and ingest their posts as neusnet content, treating each post's canonical URL as its stable identifier. The neusnet trust graph then provides curation over the Fediverse feed in place of each instance's own algorithm. From the user's perspective, they see their Fediverse timeline filtered and ranked by their personal trust graph rather than by chronology or instance-level moderation.

**Publishing to the Fediverse:**
When a user publishes a native neusnet post, their client can simultaneously publish it as an ActivityPub `Note` or `Article` activity to a Fediverse actor they control. This cross-posts the content to the Fediverse, making it discoverable to users who have not adopted neusnet. The ActivityPub post's URL becomes an additional content reference in the neusnet metadata file.

**Bridging identity:**
A Fediverse actor URL (e.g. `https://mastodon.social/@user`) or [AT Protocol](https://atproto.com) DID may serve as the stable identifier for a neusnet user who has not established a native neusnet keypair identity. Ratings given to content published under that identifier accumulate against it in the trust graph.

**AT Protocol / Bluesky:**
[Bluesky](https://bsky.social) is built on AT Protocol, which has its own federation model distinct from ActivityPub. AT Protocol's feed generator feature allows third-party algorithms to rank and filter content; a neusnet trust graph exposed as an AT Protocol feed generator would let Bluesky users benefit from personal trust-graph curation without leaving the platform. AT Protocol DIDs are explicitly supported as neusnet user identifiers (see identity.md §2.1).

### 4.2 NNTP and Usenet

**NNTP (Network News Transfer Protocol)** is the protocol that powered classic Usenet — the distributed discussion network that directly inspired neusnet. While Usenet as a public discussion medium has largely faded, NNTP remains operational and the protocol is well-specified.

Mapping neusnet concepts onto NNTP is instructive:

| NNTP concept | neusnet equivalent |
|-------------|-------------------|
| Newsgroup | Tag |
| Article | Post |
| Message-ID header | Stable identifier |
| References header | `parent` field |
| From header | `author` field |
| Subject header | `subject` field |
| Server peering | Peer gossip |
| Killfile | Visibility threshold + negative affinity |

The trust graph and ratings layer had no equivalent in NNTP — this is precisely what neusnet adds. But the post model, threading model, and distributed hosting model map cleanly. It is worth noting that neusnet's architecture could have been implemented as an extension to NNTP in the 1990s: rating records and trust graph computation would have been a natural addition to the killfile concept that Usenet readers already supported. The technical foundation was there; what was missing was the formalization of trust-propagation that neusnet specifies.

NNTP interoperability today is a niche use case but is technically straightforward: a bridge service could expose a neusnet tag as an NNTP newsgroup, translating posts to articles and vice versa, with ratings expressed as conventional Usenet scoring headers. This is noted here for completeness and historical resonance rather than as a priority implementation target.

---

## 5. Messaging and Transport Protocols

### 5.1 Matrix

**Matrix** is a decentralized, federated protocol for real-time communication, with room state replicated across homeservers. Unlike ActivityPub (which is primarily a content publishing protocol), Matrix is designed for message transport and synchronization, making it well-suited as a **gossip and distribution substrate** for neusnet metadata.

Rating records, post metadata files, and identity documents are all small structured JSON objects — exactly the kind of data Matrix rooms handle efficiently. A neusnet deployment could use a Matrix room as a gossip channel: clients join the room and publish rating records and metadata file references there, while other clients monitor the room for new content from peers they trust.

This is not a replacement for IPFS-based hosting — the actual content payloads still need to be retrievable at their URIs — but Matrix provides a reliable, ordered, decentralized message bus for the notification layer: "here is a new post / rating / identity update you might care about."

Matrix's access control model (room membership, power levels) could also support moderated community spaces within the neusnet ecosystem, complementing the protocol-level trust graph with community-level governance where desired.

### 5.2 XMPP

**XMPP (Extensible Messaging and Presence Protocol)** is the older federated messaging protocol, still widely deployed. Its publish-subscribe extension (XEP-0060, PubSub) provides a mechanism for broadcasting structured data to subscribers — semantically similar to what Matrix rooms offer for neusnet's gossip use case.

XMPP PubSub nodes could serve as gossip channels for rating records and metadata file references, with neusnet clients subscribing to nodes maintained by users they follow. This is a viable alternative to Matrix for deployments that prefer XMPP infrastructure, though Matrix is the more actively developed ecosystem for new decentralized applications.

---

## 6. Syndication Formats

### 6.1 RSS and Atom

**RSS** (Really Simple Syndication) and its successor **Atom** are pull-based XML feed formats that describe a sequence of items, each with a title, link, summary, and publication date. Their structure maps closely onto neusnet post metadata:

| RSS/Atom field | neusnet equivalent |
|---------------|-------------------|
| `<link>` or `<id>` | `id` (stable identifier) |
| `<author>` | `author` |
| `<title>` | `subject` |
| `<summary>` / `<description>` | `summary` |
| `<category>` | `tags` |
| `<published>` | `timestamp` |
| `<content>` or `<enclosure>` | `content` references |

**Reading RSS/Atom as a content source:**
A neusnet client can subscribe to any RSS or Atom feed and ingest its items as neusnet posts, using each item's `<link>` or `<id>` as the stable identifier. The neusnet trust graph then provides curation over the feed. This is the lowest-friction path for bringing conventional web publishing (blogs, news sites, podcasts) into the neusnet ecosystem — no changes required on the publisher's side.

**Publishing neusnet content as RSS/Atom:**
A neusnet client or hosting service can expose a user's posts as a standard RSS or Atom feed, making them consumable by conventional feed readers with no neusnet software required. This provides a compatibility bridge for users who prefer traditional RSS readers while still participating in the neusnet graph.

The simplicity of this integration — RSS subscribers require no neusnet software, neusnet clients require no RSS-specific configuration beyond a feed URL — makes it one of the most immediately practical interoperability paths.

---

## 7. Plain HTTP

Any content hosted at a stable HTTPS URL is a valid neusnet content reference. Plain HTTP hosting is the most widely available and easiest to set up, and is fully supported as a content substrate, with the explicit caveat that it provides none of the resilience or integrity guarantees of content-addressed storage.

A post whose only content reference is an HTTPS URL depends entirely on that server remaining available and serving the same content. Clients should:
- Warn users when a post's only content references are mutable URIs (HTTPS, IPNS content pointers)
- Encourage authors to add IPFS CID references alongside HTTPS URLs for content they care about preserving
- Where possible, opportunistically cache retrieved content locally so that a post remains viewable even if the origin server goes offline

Plain HTTP hosting is appropriate for early experimentation, for bridging external content, and for publishers who control their own servers and are comfortable with the availability tradeoffs. It is not recommended as a sole hosting strategy for content intended to be durable.

---

## 8. Content Discovery and Gossip

Knowing a post exists is a prerequisite to retrieving it. neusnet uses several complementary mechanisms for content discovery:

**Rating collection gossip:** Each user's rating collection includes a `cached` section containing rating records from their peers (see ratings.md §7). Clients retrieve a peer's rating collection and discover content that peer has rated — new post identifiers propagate through the network as rating activity spreads.

**Identity document crawl:** When a client discovers a new user identifier, it lazily resolves their identity document (see identity.md §5.3) and may traverse their publicly-rated content to bootstrap discovery.

**Endorsement list:** A client's pinning set (Section 3.3) doubles as an endorsement list: the set of post metadata version identifiers a client has pinned is a machine-readable expression of what content it found worth preserving. Peers may request this list as a discovery feed — "what has this peer been pinning lately?" The format is specified in Section 8.1.

**Platform feeds:** For content sourced from Fediverse, RSS, or other external platforms, the platform's own feed mechanism serves as the discovery layer. The neusnet client subscribes to feeds of interest and ingests new items as they appear.

**Matrix / XMPP gossip rooms:** Peers participating in shared Matrix rooms or XMPP PubSub nodes receive real-time notifications of new posts and ratings from others in the room, complementing the pull-based rating collection gossip with a push-based notification channel.

### 8.1 Endorsement List Format

A client's pinning set is published as a signed **endorsement list** — a neusnet JSON object that peers may retrieve to discover what content a user has found worth preserving. It serves as both a content discovery feed ("what has this peer been pinning lately?") and a verifiable record of endorsement.

```json
{
  "neusnet_version": 1,
  "type":            "endorsement_list",
  "owner":           "<user identifier>",
  "generated":       <unix timestamp>,
  "entries": [
    {
      "id":          "<stable post identifier>",
      "version_id":  "<version identifier (CID or equivalent)>",
      "pinned_at":   <unix timestamp>
    }
  ],
  "signature":       "<signature over all other fields>"
}
```

**`neusnet_version`** — integer. Must be `1`.

**`type`** — string. Must be `"endorsement_list"`.

**`owner`** — string. The user identifier of the client publishing this list. Must match the key used to produce the `signature`.

**`generated`** — integer. Unix timestamp of when this snapshot of the pinning set was produced. Peers use this to assess freshness and decide whether to request an updated copy.

**`entries`** — array. The list of pinned items. Each entry contains:
- **`id`** — the stable post identifier (`id` field from the post's metadata file), allowing peers to associate this entry with a known post without fetching the version.
- **`version_id`** — the specific version identifier (CID or substrate equivalent) that is pinned. This is what peers use to actually retrieve the content.
- **`pinned_at`** — Unix timestamp of when this item was added to the pinning set.

**`signature`** — string. Cryptographic signature over all other fields in JCS canonical form, using the owner's identity substrate signing algorithm (see identity.md §4).

The endorsement list is published at a fixed path under the user's IPNS directory root (see identity.md §5.3):

```
ipns://<user's IPNS name>/endorsements.json
```

This makes it discoverable by any peer who knows the user's public key, using the same derivation formula as the identity document. No separate lookup or coordination is required.

Clients should regenerate and republish their endorsement list periodically as their pinning set changes. The appropriate frequency is a matter of implementation preference — more frequent updates give peers fresher discovery data at the cost of more IPNS writes. A reasonable default is to republish whenever the pinning set changes, batching rapid changes with a short debounce delay.

Peers should import endorsement lists from users with positive effective affinity, treating new entries as candidate content to fetch and evaluate. Entries from high-affinity peers carry more weight as discovery signals than those from lower-affinity peers, consistent with the trust graph model throughout the rest of the protocol.

---

## 9. Open Questions

**9.1 ActivityPub bridge specification.** The ActivityPub integration described in Section 4.1 is described at a high level. A concrete bridge specification — mapping ActivityPub activity types to neusnet metadata fields and vice versa, handling identity binding between ActivityPub actors and neusnet user identifiers, and specifying how ratings translate to ActivityPub likes or reactions — would be needed before implementation. This is complex enough to warrant its own future document.

**9.2 Matrix room conventions.** If Matrix is used as a gossip substrate (Section 5.1), conventions for room structure, event types, and access control need to be specified. The recommended direction is that gossip rooms should be invite-only, with membership seeded from the local user's positive-affinity peer set — joining a gossip room with a peer is itself an expression of trust, and open rooms would be vulnerable to spam and Sybil flooding. Each client would maintain one gossip room per proximal peer cluster rather than one global room. The mapping between trust graph topology and room membership structure needs fuller specification before implementation.
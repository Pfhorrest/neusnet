# neusnet

*A proposed decentralized discussion platform with user-sovereign curation*

The name combines "new" with "Usenet" and is pronounced "news net" — evoking both the platform that inspired it and what it aspires to become.

> **Project status:** An early, test-driven TypeScript reference implementation of core protocol primitives now lives in [`core/`](core/), alongside detailed specifications in [`spec/`](spec/). The project does not yet include a complete client or a functioning interoperable network; the core is not production-ready. See [`core/PROGRESS.md`](core/PROGRESS.md) for its implementation status.

---

## Why This Exists

The early internet was a **pull medium**: you chose what to look for and went to find it. That was sometimes hard, but the tools kept improving. Hyperlinks, directories, webrings, and search engines made discovery progressively easier while leaving the initiative with the user.

**[Usenet](https://en.wikipedia.org/wiki/Usenet)** embodied this ethos at the infrastructure level. It distributed posts among independently operated servers, while users curated their own reading with *killfiles* — personal filters for authors or topics. This demonstrated a useful separation of responsibilities: distribution was the network's job, and curation was the reader's.

In 1996, **[PointCast](https://en.wikipedia.org/wiki/PointCast_(company))** popularized **push technology**, delivering news to users' desktops without their asking for it. Microsoft's Active Desktop, Netscape's Netcaster, and a wave of startups followed. The pitch was that content would simply arrive, and the analogy invoked, approvingly, was television. People who remembered what television was — a few broadcasters deciding what hundreds of millions of people would see — were not enthused. The branded push wave collapsed within a few years, and [RSS](https://www.rssboard.org/rss-specification) emerged as a lighter, user-controlled alternative.

But the underlying model survived under a different name. Today's feeds often work as push in all but branding: a platform, a government, a moderation team, or an opaque ranking system decides what you see, using criteria you may not be able to inspect or override without leaving the service.

Meanwhile, the spaces that remain pull-oriented tend to face a dilemma. Without centralized moderation they can drown in spam and abuse; with it, they often quietly recentralize around a small group of administrators or moderators whose decisions affect everyone in the community. These are not the only possible ways to organize online discussion, but they expose a tension between shared infrastructure, community governance, and individual choice.

**Neusnet is an attempt to recover what was lost — personal control over curation — at the scale and ease of the modern internet.**

---

## Communities Without Owners

Community platforms suffer a recurring schism: a faction unhappy with administration policy leaves to found a rival space. That problem is a structural one: on platforms like Discord, Reddit, or any server- or group-based social network, someone has to be in charge. The server owner, the subreddit moderator, the group admin — their role is not incidental but architecturally mandated.

The community's shared history and membership list live on infrastructure they control, which means curation policy is necessarily centralized. When that policy becomes contested, the only recourse is to leave — and leaving means abandoning the shared history and dispersing the community. So servers splinter, subreddits fork, and communities scatter.

Neusnet's architecture aims to dissolve this problem not by improving how centralized moderation works, but by eliminating the structural necessity of it — removing the protocol-level requirement for one shared owner or moderator to determine everyone's feed.

The proposed solution is, in effect, to let you **"choose your own mod team"**: you borrow the judgments of people you trust, transitively and under your own control, rather than relying on a platform’s default ranking or manually configuring every filter yourself. Those people’s judgments shape only your view, not everyone else’s, so nobody has to leave to get different moderation.


---

## How It Works: A Trust Graph as Curation Engine

Each user can maintain a local record of how they have rated content: posts, links, articles, media, or other items with addressable identifiers. These ratings are multidimensional (see below). Public ratings may be shared for other people's graph calculations; ratings marked private are intended to remain local and influence only their owner's view. The privacy limits of that arrangement are described below.

When you rate a piece of content, the system can also treat that rating as a signal about its **author**. A user whose posts you have consistently rated positively may develop high **affinity** with you, an inferred preference signal; consistently negative ratings may contribute to negative affinity.

These affinities propagate through the graph:

- Ratings from people with positive affinity can increase an item's default score; ratings from people with negative affinity can decrease it.
- The design also includes a modest **enemy-of-my-enemy** effect: a rating from someone opposed by another person you distrust may receive some positive influence.
- Influence can propagate transitively through the graph, with clients fetching more distant ratings as bandwidth, storage, and compute allow.

Each additional graph step is weighted by a **decay factor** that you control. At 1, distance imposes no discount: a rating from anyone in your graph, however distant, can weigh as much as your own. At 0, only your own ratings count. Around 0.5, each additional hop halves a rating's weight.

You also control a **visibility threshold**: content whose aggregate weighted score falls below this threshold is excluded from your default feed. The default is 0, meaning only net-positive content is shown by default, but users who want to see critical or controversial material can lower this. Explicit search and direct navigation are intended to remain separate from this feed filter.

No imported rating ever outweighs your own explicit rating: at most, it can equal it. The graph supplies defaults for your feed; your explicit judgments can always override those defaults.

### Multidimensional Ratings

Inspired by [Slashdot](https://slashdot.org)'s moderation categories, ratings in neusnet are not a single number but a set of independent dimensions. The core proposed dimensions correspond to four fundamental questions you might ask about any piece of content:

| Dimension | Positive | Negative |
|-----------|----------|----------|
| **True** | Accurate, well-evidenced | Inaccurate, misleading |
| **Good** | Worthwhile, enjoyable | Unpleasant, harmful |
| **Important** | Significant, deserving attention | Trivial, not worth the time |
| **New** | Original, novel | Derivative, redundant |

The practical point is that different users can weight these dimensions differently. Someone who wants only accurate information and can tolerate unpleasant content sets a high threshold on *True* and a low one on *Good*. Someone who wants a pleasant reading experience and trusts their network to pre-filter for accuracy inverts those thresholds. A topic that is old and obscure but genuinely significant can score high on *Important* without scoring high on *New*; a viral shitpost scores the reverse.

The system supports **arbitrary rating dimensions** beyond this core vocabulary, so communities can define domain-specific axes (e.g., *Funny*, *Technically Sound*, *Legally Significant*) that participants in those communities can use and weight.

Decay and visibility threshold are configurable **per dimension**, not just globally.

### What Can Be Rated

The object of a rating is intentionally general. The obvious case is a post, but the rating schema is designed to accommodate:

- **Posts and content items** — the primary case, identified by CID, URL, or platform-specific ID
- **Tags** — rating a tag up or down lets you boost or suppress entire topics in your feed, and indirectly generates affinity signals for authors who use those tags heavily. Someone who posts prolifically under a tag you've downvoted will accumulate negative affinity with you accordingly.
- **Users directly** — explicit positive or negative ratings of a user by identifier, independent of any specific post, for cases where your opinion of someone is clear enough to state outright
- **Anything else with a stable identifier** — the schema leaves this open

This generality is intended to make the trust graph richer than a simple post-rating system. Downrating a tag associated with a harassment campaign, for example, may lower the default visibility of that topic and contribute negative affinity signals for prolific users of the tag.

Affinity flows through these relationships. Posts connect users and tags: a post has an author and carries tags, but users and tags are related to each other only through posts. Ratings of a post therefore affect both its author and its tags. Ratings of a user affect that user's posts, and through them, indirectly, the tags those posts carry. Ratings of a tag affect the posts carrying it, and through them, indirectly, their authors.

This means a tag can accumulate affinity without anyone rating the tag itself. If you, or people whose judgments you borrow, consistently downrate posts carrying a tag, that tag accumulates negative affinity in your view. If a cluster of authors you already distrust migrates to a new topic under a fresh tag, the new tag inherits their negative affinity without you taking any action. The graph learns the shape of communities, not just individuals. The same inference, however, *can* misfire: people who use a tag for different reasons, such as counter-speech or research, can be caught by it. The graph infers patterns from ratings; it does not know motives.

### Filters Are a Default, Not a Lock

Visibility thresholds and affinity-based filtering are intended as defaults for a general feed, not as rules that prohibit access. A client can be designed so that:

- Following a link or parent-post reference to a low-rated item attempts to retrieve it rather than silently applying the feed filter.
- Explicitly searching for posts by a downrated author, or tagged with a downrated tag, bypasses the default feed filter.
- Filtering controls what is surfaced unsolicited, rather than deciding what the user is permitted to read.

This distinction matters in practice: a highly rated post may rebut an item your feed normally hides, and a researcher may deliberately search a tag they usually suppress. The design aims to model preferences, not permissions.

---

## Tags as Communities

The proposed organizing unit of neusnet is not a room, server, or group — it is a **tag**. Tags are freeform, unowned, and unregistered at the protocol level. Anyone can publish under `#philosophy`; no single tag owner controls who may use the name. The community that forms around a tag is shaped by who uses it and how readers weight those contributors through their trust graphs.

This is inspired by Usenet's newsgroup model — `#philosophy` resembles a topic-centered forum without a required central registry or single tag owner. A subset of people wanting a more focused space can simply adopt a more specific tag. Tags support an optional dot notation for expressing explicit hierarchy: `#philosophy.epistemology` asserts that this post is about epistemology as a subtopic of philosophy, while `#philosophy-basement` is simply a flat tag whose name happens to contain "philosophy". A community can self-organize under `#philosophy.basement` to make that containment relationship explicit, or use a flat tag to remain independent. Either way, the community is owned by no one. Searching for `#epistemology` returns posts tagged `#philosophy.epistemology` and `#psychology.epistemology` alike — hierarchical tagging adds precision without creating silos or penalizing discoverability.

A client can let users save tag searches as **channels**. A user might configure:

- A `#music` channel
- A `#philosophy` channel
- A `#philosophy.epistemology` subchannel
- A `#philosophy.basement` channel for a specific community

Each channel is intended to be a personalized, trust-graph-filtered view of posts under those tags — a curated space assembled from content the client can discover and retrieve. Two members of the same tag-community can see different views based on their trust graphs. There need not be one authoritative feed or moderator whose decision changes every reader's view. Channels are specified in detail in ratings.md §6.4–6.6.

Because tags and personal feeds are not inherently owned by one administrator, community schisms are no longer forced by irreconcilable moderation disputes: one group can organize differently from another without requiring the original tag to be transferred or forked. Alongside curation by author, a group of users who want a more focused version of a community can coalesce around a subtag like `#philosophy.basement` or a purpose-named tag like `#philosophy.the-philosophy-basement` without anyone being expelled from anything. Posts tagged `#philosophy.basement` are automatically included in any `#philosophy` channel by virtue of containing `philosophy` as a tag segment — no manual configuration needed. Posts tagged with a flat tag like `#philosophy-basement` would need to be manually added to a user's `#philosophy` channel local taxonomy, and clients would offer that as a suggestion with a clear disclosure of its scope. The broader community can continue to exist while the sub-community gains a more specific identity. The two can coexist, with their relationship shaped more by individual trust-graph choices and channel configurations than by a single administrator's decision.

---

## Architecture: Separable Layers

Neusnet is designed as a stack of independent layers, each of which can in principle be swapped out for alternatives. This is deliberate: the project's ideas should be able to interoperate with other decentralized systems, not compete with them.

### Layer 1: Ratings

A rating record captures a single act of evaluation: who rated what, on which dimensions, with what values, and when. Records are signed by the rater's private key, making changes detectable and tying the record to that key. Each record may be marked public (shared with peers and used in others' graph traversal) or private (intended to remain local and used only in the owner's view). This can let users rate sensitive content — political, personal, or adult — without publishing the ratings themselves. It does not, however, hide the fact that you fetched the content; see [Design Goals and Limits](#design-goals-and-limits).

The rating layer is **platform-agnostic**. Item identifiers can be anything: a URL, a content hash, a magnet link, a post ID on another platform. This means the neusnet trust graph can in principle be applied as a curation layer on top of existing platforms — a browser extension that applies neusnet ratings to content on other sites is a natural early application. Within the [Bluesky](https://bsky.social) ecosystem specifically, [AT Protocol](https://atproto.com)'s "feed generator" feature allows third-party algorithms to rank and filter content; a neusnet trust graph exposed as a feed generator would let Bluesky users benefit from personal trust-graph curation without leaving the platform.

*Specified in detail in [ratings.md](spec/ratings.md).*

### Layer 2: Content Metadata

The atomic unit of a neusnet post is a small **metadata file**: a signed JSON document identifying the post, its author, its place in the conversation graph (via parent and version references), its tags, and where its content can be retrieved. The metadata file is designed to be lightweight enough that clients can retrieve and index many of them cheaply, deferring retrieval of actual content payloads — text, images, audio, video — until the user chooses to read a post.

The content reference can point to an off-platform URL (making the post function as a link aggregator entry, like early Reddit or Slashdot) or to content hosted within the platform itself.

*Specified in detail in [metadata.md](spec/metadata.md).*

### Layer 3: Identity

Users can be identified by a stable, verifiable identifier used to verify signatures on ratings and posts. One self-sovereign option is a **cryptographic keypair**: the public key identifies the signer and the private key signs content, without requiring a central registry to issue the identity.

Other identity mechanisms are possible and may be preferable in some deployments. AT Protocol (Bluesky's underlying protocol) provides a decentralized identity layer based on DIDs (Decentralized Identifiers) that could serve the same function while also enabling tighter integration with the Bluesky ecosystem. Other DID-based systems, or even federated identity providers, could plug into the same slot. The core requirement is that an identifier be stable and verifiable. Decentralization is strongly preferred for the long-term philosophy of the system, but it is not a hard technical requirement: platform-issued identifiers (including OAuth/SSO providers like Google, Apple, or GitHub) could in principle serve as user IDs, which might ease integration with existing platforms during early adoption even if they introduce a degree of central dependency that a mature deployment would want to avoid.

A major adversarial threat to a trust-graph system is the **Sybil attack**: one actor creating many identities to flood the graph with coordinated ratings. The design hopes to limit the influence of new or weakly connected identities because their ratings have zero influence until the graph gives them weight, which requires actually producing content that real humans find valuable. Coordinated inauthentic behavior remains a risk, and decay alone does not bound it. Decay attenuates influence per hop, but how much a cluster can accumulate through genuine endorsements, including from a single respectable account that vouches for many others, depends on how ratings are aggregated. These mitigations depend on the precise protocol rules and require adversarial testing.

#### Presence and Buddy Lists

The `status` field in the identity document (see identity.md §5.2) allows users to publish a short free-text presence signal — "writing", "away", "open to discussion" — updated as frequently as they like. This is not binary online/offline presence detection, which would require centralized infrastructure, but it is sufficient for the social function presence serves in most contexts: knowing whether someone is around and what they're up to.

Clients can compose this with the feed model to produce a **buddy list** for any tag-feed: the set of authors with posts in that feed who have positive affinity, ordered by recency of identity document update, with their current status displayed. No new protocol machinery is required — this falls entirely out of the trust graph, the tag system, and the identity document, composed by the client.

*Specified in detail in [identity.md](spec/identity.md).*

### Layer 4: Content Hosting and Distribution

This layer is **deliberately hosting-agnostic**. The metadata file (Layer 2) contains a content reference field that can point to content hosted anywhere. Different posts on the same network may be hosted in entirely different ways, and the rating and discovery layers above don't care.

#### [IPFS](https://ipfs.tech) (preferred for native neusnet content)

**IPFS** is the preferred hosting backend for neusnet's own content. Its central feature is *content addressing*: every file is identified by a cryptographic hash of its contents (a CID, or Content Identifier), not by where it is stored. This means:

- A content identifier is derived from the encoded content and addressing parameters rather than a server location, so matching CIDs can help identify identical encoded content across hosts.
- A change to the addressed bytes produces a different identifier, making unexpected changes detectable when the CID is verified. Equivalent-looking content does not necessarily have the same CID unless it is represented consistently.
- Content may be retrieved from any reachable provider that has it; no single server is inherently required by the addressing model.
- Link rot is replaced by a softer failure mode: content becomes unavailable only when *nobody reachable* is hosting it, not when a single server goes down.

Short text content (including the metadata file itself) can be stored directly as IPFS objects. Larger media — audio, video, high-resolution images — can also be stored on IPFS, which handles content of any size uniformly through its block-splitting architecture.

Users who want to ensure their content remains available can **pin** it to a local IPFS node or to one of several public or paid pinning services, without any involvement from a neusnet-specific infrastructure provider.

#### [BitTorrent](https://www.bittorrent.org) (supplementary, or as a wholesale alternative)

**BitTorrent** is well-suited as a supplementary transport for large media files. A metadata file hosted on IPFS can include a magnet link in its content reference field, directing clients to retrieve a large video or audio file via BitTorrent instead. BitTorrent's parallel-swarm download architecture is exceptionally efficient for large files at high demand, and it remains the most battle-tested decentralized file distribution protocol in existence.

For deployments that prefer not to use IPFS at all, BitTorrent can serve as a wholesale alternative hosting layer. In this configuration, content discovery requires an additional mechanism since BitTorrent has no native cross-torrent content addressing. The natural solution is the **gossip protocol** described below: your client periodically requests lists of known post magnet links from positive-affinity peers, who have compiled their lists from their own positive-affinity peers, and so on. This makes content discovery and social trust the same network operation — you find new content through the same relationships that filter it.

#### Conventional HTTP hosting

A neusnet metadata file can point to content on an ordinary web server. This may be less resilient than a well-replicated peer-to-peer deployment because a single server can go down or remove content, but it can be a practical choice for a publisher who controls their own server and wants to participate in the neusnet rating graph without migrating content.

#### Overlaying neusnet on existing social platforms

The most important consequence of hosting-agnosticism is that neusnet does not require anyone to abandon their existing online presence to participate.

Platforms like **[Mastodon](https://joinmastodon.org)** (built on [ActivityPub](https://www.w3.org/TR/activitypub/)) and **Bluesky** (built on AT Protocol) offer interfaces that third-party clients can use, subject to each platform's capabilities and rules. A neusnet-aware client could apply a personal trust graph to the content it can retrieve and present a unified view across services. The practical scope of each integration depends on available APIs, access conditions, and client support; neusnet cannot independently override a platform's access restrictions. Its proposed contribution is a portable curation layer that users can control.

Cross-posting works in the reverse direction: when you publish a native neusnet post, your client can simultaneously post to Mastodon, Bluesky, or other connected platforms, spreading your content to audiences who haven't yet adopted neusnet.

Posts on traditional platforms lack neusnet's native author identity metadata. This can be bridged through a mutual attestation convention: a user publishes their neusnet public key as a `[neusnet:nid1...]` token in their platform bio, and lists that platform profile URL in the `links` array of their neusnet identity document. When both are present, a neusnet client can verify the binding without any platform cooperation — no API access, no changes to how the platform works. Ratings given to content on that platform then flow into the trust graph against the author's verified neusnet identity. The convention follows the same pattern PGP users employed for decades, distributing key fingerprints in email signatures and forum profiles. The full verification procedure is specified in identity.md §2.2.

This suggests a realistic adoption path: neusnet begins as a curation and identity layer grafted onto platforms people already use, demonstrating value before asking anyone to change their habits. Native neusnet hosting (via IPFS or BitTorrent) becomes appealing over time as the network effects of the trust graph make it worth participating more fully.

**Rather than build every component from scratch, neusnet should seek to collaborate with and build on existing projects wherever possible.** Established multi-platform clients ([Ivory](https://tapbots.com/ivory/), [Mona](https://apps.apple.com/app/mona-for-mastodon/id1659154653), and others in the Mastodon ecosystem; clients being built on AT Protocol for Bluesky) are natural integration partners. IPFS and its tooling ecosystem are existing infrastructure, not something neusnet needs to reinvent. The novel contribution of this project is the trust graph protocol and the rating schema — the goal is to define those well and let them compose with whatever hosting and client infrastructure already exists.

*Specified in detail in [hosting.md](spec/hosting.md).*

### The Real-Time Layer

Neusnet was originally conceived in the context of forum-like platforms — asynchronous discussion where posts accumulate over hours or days. But the line between "forum" and "chat" has always been blurry: people have real-time exchanges on forums, and chat threads stretch across days. The underlying problem neusnet addresses applies equally to both, but real-time "chat" routinely utilizes features that asynchronous "forums" do not.

Neusnet does not attempt to replace the purely ephemeral layer of chat platforms — typing indicators, voice and video, instantaneous delivery guarantees. For those, [Matrix](https://matrix.org) and [XMPP](https://xmpp.org) are appropriate transports and neusnet is designed to interoperate with them (see hosting.md §5). The division of responsibility is clean: neusnet handles everything above the threshold of content worth persisting; real-time transient signaling is delegated to protocols built for it. A client could present both in a unified interface without either layer needing to subsume the other.

---

## Client Implementation Recommendations

Recommended (non-mandatory) client behaviors and interface patterns — including endorsed content pinning, the channel interface, cached rating distribution, rating dimension iconography, and a proposal for user-operated AI proxy identities — are collected in [client-recommendations.md](client-recommendations.md).

---

## Design Goals and Limits

- **Personal curation, not global moderation.** Neusnet is designed so a rating or feed filter changes an individual's default view rather than globally removing an item from the protocol. This is not a guarantee that every host will serve every item or every client will display it.
- **Pseudonymity, not built-in anonymity.** Posts and ratings may be signed with keys that are not linked to a legal identity, but signatures do not hide activity or network metadata. Private ratings are intended to stay local; they do not provide comprehensive protection against device access, network observation, or inference from other behavior. People who need strong anonymity require additional, appropriate protections beyond neusnet.
- **Decentralization as a design direction, not an absolute guarantee.** Content-addressing can help verify content, but not ensure it remains hosted. A protocol without a global administrator can still depend in practice on popular clients, gateways, hosting providers, or social endorsement patterns.
- **A work in progress.** The core implementation exercises selected protocol primitives, but does not constitute a complete, interoperable network or production system. The specifications and implementation will need further review and real-world testing.

---

## Project Status and How to Get Involved

The [`core/`](core/) directory contains an early TypeScript reference implementation covering identity and signing, canonicalization, tags, metadata, ratings, and trust-graph calculations; [`core/PROGRESS.md`](core/PROGRESS.md) records its current status.

The next broad priorities are to review and stabilize the specifications and core implementation, build the networking, storage, and client layers, and validate the design through integration and adversarial testing. Integrations with existing social clients and hosting projects remain a potential adoption path, not a completed capability.

If any of this resonates with you — whether you're interested in the philosophy, cryptography, distributed-systems engineering, client UX, testing, or just want to argue about the design — contributions and discussion are welcome.

To get in touch, contact **Forrest Cameranesi** at [forrest@cameranesi.com](mailto:forrest@cameranesi.com).
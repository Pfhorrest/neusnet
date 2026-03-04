# neusnet

*A decentralized discussion platform with user-sovereign curation*

The name combines "new" with "Usenet" and is pronounced "news net" — evoking both the platform that inspired it and what it aspires to become.

---

## Why This Exists

The early internet was a **pull medium**. You decided what to look for, and you went and found it. This was sometimes hard — you had to already know something existed before you could find it — but the tools kept improving. Hyperlinks, webrings, indices, and then proper search engines made it progressively easier to discover content without already knowing exactly where it lived. The user was in control.

Platforms like **Usenet** embodied this ethos at the infrastructure level: posts were distributed across many independent servers with no central host, and every server held a copy of everything, so no single entity could control what existed. Individual users managed their own experience with *killfiles* — personal blocklists that filtered out authors or topics they didn't want to see. It was crude, but the principle was right: distribution was the network's job, and curation was the user's job. Usenet wasn't designed to scale to a billion users, and it showed — but its instincts about where control should live were sound.

In 1996, a company called **[PointCast](https://en.wikipedia.org/wiki/PointCast_(company))** launched a product that turned idle PC screens into news tickers by pushing content directly to users' desktops without them asking for it. It was a sensation, and it triggered a wave of investment and imitation. Microsoft built "Active Desktop," Netscape built "Netcaster," and a cluster of startups including Marimba, BackWeb, and others competed to establish **push technology** as the next paradigm of the internet. The pitch was seductive: instead of the tiring, effortful experience of browsing the web, content would simply arrive. The analogy invoked, approvingly, was television.

People who remembered what television was — a medium where a small number of broadcasters decided what hundreds of millions of people would see — were not enthused. The backlash was pointed. By the late 1990s, "push" as a branded concept had quietly collapsed; PointCast, which had turned down a $450 million acquisition offer at its peak, was eventually sold for a few million dollars. [RSS](https://www.rssboard.org/rss-specification) emerged as a lightweight, user-controlled alternative to push channels, and the movement was declared dead.

Except it wasn't dead. It just stopped announcing itself. By the 2000s and 2010s, push had won — it just called itself **the algorithm** instead. Some central authority — a corporation, a government, a platform's moderation team, or increasingly an opaque machine learning system — decides what you should see and delivers it to you. You did not choose this curator. You cannot inspect their criteria. You cannot override their decisions except by leaving the platform entirely.

Meanwhile, the few remaining pull-oriented spaces on the internet are either drowning in spam and abuse (because centralized moderation has been removed without replacement) or have quietly recentralized moderation around a small number of powerful community members who are, again, not chosen by you and not accountable to you.

**neusnet is an attempt to recover what was lost, at the scale and ease of the modern internet.**

The goal is a discussion platform where content curation is entirely in the hands of each individual user — not their platform provider, not their government, not the most powerful members of their community — while still being usable by ordinary people who don't want to spend hours manually configuring filters.

The insight at the center of neusnet is that you don't need a central authority to have effective curation. You just need to be able to borrow the judgment of people you trust, automatically, transitively, and under your own control. Think of it as Usenet's distributed hosting and personal killfiles — updated, generalized, and scaled to the modern internet.

---

## The Core Idea: A Trust Graph as Curation Engine

Every user maintains a local record of how they have rated content: posts, links, articles, media — anything with an addressable identifier. These ratings are multidimensional (see below) and are published as a public record, though individual ratings may be marked private by their author.

When you rate a piece of content, you are also implicitly rating its **author**. A user whose posts you have consistently rated positively has high **affinity** with you. A user whose posts you have consistently rated negatively has negative affinity with you.

These affinities propagate:

- Content rated highly by **high-affinity users** appears with a higher default score in your view.
- Content rated highly by **low-affinity users** (people you distrust) appears with a lower default score.
- The enemy-of-my-enemy principle applies: content rated highly by someone who is themselves disliked by someone you dislike gets a modest positive boost.
- This propagation continues transitively — through friends of friends, and so on — lazily, fetching more distant ratings as bandwidth and compute allow.

Each step further from you in the graph is weighted by a **decay factor** that you control. At one extreme (decay = 1), everyone's ratings weigh as much as your own, regardless of how distant the connection. At the other extreme (decay = 0), only your own explicit ratings have any weight. Most users will live somewhere in between — probably around 0.5, meaning each additional hop in the trust graph halves the influence of those ratings on your view.

You also control a **visibility threshold**: content whose aggregate weighted score falls below this threshold is dropped from your view entirely. The default is 0, meaning only net-positive content is shown, but users who want to see critical or controversial material can lower this.

Your own explicit ratings always carry more weight than any imported rating, regardless of affinity. The trust graph provides defaults; you always have the final word.

This is sometimes described informally as **"choose your own mod team"** — except the team you're choosing isn't moderating anyone else's view, only yours.

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
- **Tags** — rating a tag up or down lets you boost or suppress entire topics in your feed, and generates affinity signals for authors who use those tags heavily. Someone who posts prolifically under a tag you've downvoted will accumulate negative affinity with you accordingly.
- **Users directly** — explicit positive or negative ratings of a user by public key, independent of any specific post, for cases where your opinion of someone is clear enough to state outright
- **Anything else with a stable identifier** — the schema leaves this open

This generality means the trust graph is richer than a simple post-rating system. Downvoting a tag associated with a harassment campaign, for instance, doesn't just hide posts with that tag — it pushes the people who use it toward the negative-affinity end of your graph, which in turn de-weights their ratings of everything else.

Importantly, affinity for tags accrues implicitly just as it does for authors. If you (or people with positive affinity to you) consistently downrate posts that carry a particular tag, that tag accumulates negative affinity in your view automatically — you don't need to explicitly rate the tag itself. If a cluster of authors you already distrust migrates from one toxic topic to a new one under a fresh tag, the new tag inherits their negative affinity without you having to take any action. The trust graph learns the shape of communities, not just individuals.

### Filters Are a Default, Not a Lock

Visibility thresholds and affinity-based filtering are defaults applied to your general feed — they are not censorship of your own access. Content below your threshold remains directly accessible:

- Following a link or parent-post reference to a low-rated item will always retrieve it.
- Explicitly searching for posts by a downrated author, or tagged with a downrated tag, bypasses your filters and shows results directly.
- There is no mechanism that prevents you from reading content you have chosen to deprioritize — only from having it surface unsolicited.

This matters for practical reasons: a highly-rated post in your feed may be a rebuttal of something your filters would normally hide; you can follow the parent link to read what is being rebutted. A researcher investigating a toxic community can search explicitly for posts under a tag their filters would otherwise suppress. The system models your preferences, not your permissions.

---

## Architecture: Separable Layers

neusnet is designed as a stack of independent layers, each of which can in principle be swapped out for alternatives. This is deliberate: the project's ideas should be able to interoperate with other decentralized systems, not compete with them.

### Layer 1: Ratings

A rating record captures a single act of evaluation: who rated what, on which dimensions, with what values, and when. Records are signed by the rater's private key, making them tamper-evident and attributable. Each record may be marked public (shared with peers and used in others' graph traversal) or private (kept local and used only in the owner's own view). This allows users to rate sensitive content — political, personal, adult — in a way that shapes their own view without disclosing what they have been looking at.

The rating layer is **platform-agnostic**. Item identifiers can be anything: a URL, a content hash, a magnet link, a post ID on another platform. This means the neusnet trust graph can in principle be applied as a curation layer on top of existing platforms — a browser extension that applies neusnet ratings to content on other sites is a natural early application. Within the [Bluesky](https://bsky.social) ecosystem specifically, [AT Protocol](https://atproto.com)'s "feed generator" feature allows third-party algorithms to rank and filter content; a neusnet trust graph exposed as a feed generator would let Bluesky users benefit from personal trust-graph curation without leaving the platform.

*Specified in detail in [ratings.md](spec/ratings.md).*

### Layer 2: Content Metadata

The atomic unit of a neusnet post is a small **metadata file**: a signed JSON document identifying the post, its author, its place in the conversation graph (via parent and version references), its tags, and where its content can be retrieved. The metadata file is designed to be lightweight enough that clients can retrieve and index many of them cheaply, deferring retrieval of actual content payloads — text, images, audio, video — until the user chooses to read a post.

The content reference can point to an off-platform URL (making the post function as a link aggregator entry, like early Reddit or Slashdot) or to content hosted within the platform itself.

*Specified in detail in [metadata.md](spec/metadata.md).*

### Layer 3: Identity

Users are identified by a stable, verifiable identifier that can be used to sign ratings and posts. The simplest and most self-sovereign option is a **cryptographic keypair**: your public key is your identity, your private key signs your content, and there is no registration, no username database, no central authority that can revoke your identity.

Other identity mechanisms are possible and may be preferable in some deployments. AT Protocol (Bluesky's underlying protocol) provides a decentralized identity layer based on DIDs (Decentralized Identifiers) that could serve the same function while also enabling tighter integration with the Bluesky ecosystem. Other DID-based systems, or even federated identity providers, could plug into the same slot. The core requirement is that an identifier be stable and verifiable. Decentralization is strongly preferred for the long-term philosophy of the system, but it is not a hard technical requirement: platform-issued identifiers (including OAuth/SSO providers like Google, Apple, or GitHub) could in principle serve as user IDs, which might ease integration with existing platforms during early adoption even if they introduce a degree of central dependency that a mature deployment would want to avoid.

The primary adversarial threat to a trust-graph system is the **Sybil attack**: a bad actor generating many fake identities to flood the graph with coordinated ratings. neusnet's natural defense is that fake accounts have no ratings power until real users develop positive affinity toward their posts — which requires actually producing content that real humans find valuable. Coordinated inauthentic behavior remains a risk but is bounded: a coordinated cluster cannot propagate its influence far into the broader graph without genuine cross-community endorsement, which the decay factor naturally limits.

*Specified in detail in [identity.md](spec/identity.md).*

### Layer 4: Content Hosting and Distribution


This layer is **deliberately hosting-agnostic**. The metadata file (Layer 2) contains a content reference field that can point to content hosted anywhere. Different posts on the same network may be hosted in entirely different ways, and the rating and discovery layers above don't care.

#### [IPFS](https://ipfs.tech) (preferred for native neusnet content)

**IPFS** is the preferred hosting backend for neusnet's own content. Its central feature is *content addressing*: every file is identified by a cryptographic hash of its contents (a CID, or Content Identifier), not by where it is stored. This means:

- The same content always has the same identifier regardless of who is hosting it, solving canonicalization for cross-posts and reposts.
- Content is tamper-evident by construction — any modification changes the CID.
- Content is retrievable from any peer who has it, with no central server.
- Link rot is replaced by a softer failure mode: content becomes unavailable only when *nobody* is hosting it, not when a single server goes down.

Short text content (including the metadata file itself) can be stored directly as IPFS objects. Larger media — audio, video, high-resolution images — can also be stored on IPFS, which handles content of any size uniformly through its block-splitting architecture.

Users who want to ensure their content remains available can **pin** it to a local IPFS node or to one of several public or paid pinning services, without any involvement from a neusnet-specific infrastructure provider.

#### [BitTorrent](https://www.bittorrent.org) (supplementary, or as a wholesale alternative)

**BitTorrent** is well-suited as a supplementary transport for large media files. A metadata file hosted on IPFS can include a magnet link in its content reference field, directing clients to retrieve a large video or audio file via BitTorrent instead. BitTorrent's parallel-swarm download architecture is exceptionally efficient for large files at high demand, and it remains the most battle-tested decentralized file distribution protocol in existence.

For deployments that prefer not to use IPFS at all, BitTorrent can serve as a wholesale alternative hosting layer. In this configuration, content discovery requires an additional mechanism since BitTorrent has no native cross-torrent content addressing. The natural solution is the **gossip protocol** described below: your client periodically requests lists of known post magnet links from positive-affinity peers, who have compiled their lists from their own positive-affinity peers, and so on. This makes content discovery and social trust the same network operation — you find new content through the same relationships that filter it.

#### Conventional HTTP hosting

Nothing prevents a neusnet metadata file from pointing to content on an ordinary web server. This is obviously less resilient than IPFS or BitTorrent (a single server can go down or be pressured to remove content), but it is fully functional and may be appropriate for some use cases — for instance, a publisher who controls their own server and wants to participate in the neusnet rating graph without migrating their content.

#### Overlaying neusnet on existing social platforms

The most important consequence of hosting-agnosticism is that neusnet does not require anyone to abandon their existing online presence to participate.

Platforms like **[Mastodon](https://joinmastodon.org)** (built on [ActivityPub](https://www.w3.org/TR/activitypub/)) and **Bluesky** (built on AT Protocol) expose open APIs designed for third-party clients. A neusnet client could read your feeds from these platforms, apply your personal trust graph as the ranking layer *instead of each platform's own algorithm*, and present a unified view across all of them. Multi-platform social clients already exist; what neusnet adds is a curation layer that is yours rather than the platform's.

Cross-posting works in the reverse direction: when you publish a native neusnet post, your client can simultaneously post to Mastodon, Bluesky, or other connected platforms, spreading your content to audiences who haven't yet adopted neusnet.

Posts on traditional platforms lack neusnet's native author identity metadata. This can be bridged through a mutual attestation convention: a user publishes their neusnet public key as a `[neusnet:nid1...]` token in their platform bio, and lists that platform profile URL in the `links` array of their neusnet identity document. When both are present, a neusnet client can verify the binding without any platform cooperation — no API access, no changes to how the platform works. Ratings given to content on that platform then flow into the trust graph against the author's verified neusnet identity. The convention follows the same pattern PGP users employed for decades, distributing key fingerprints in email signatures and forum profiles. The full verification procedure is specified in identity.md §2.2.

This suggests a realistic adoption path: neusnet begins as a curation and identity layer grafted onto platforms people already use, demonstrating value before asking anyone to change their habits. Native neusnet hosting (via IPFS or BitTorrent) becomes appealing over time as the network effects of the trust graph make it worth participating more fully.

**Rather than build every component from scratch, neusnet should seek to collaborate with and build on existing projects wherever possible.** Established multi-platform clients ([Ivory](https://tapbots.com/ivory/), [Mona](https://apps.apple.com/app/mona-for-mastodon/id1659154653), and others in the Mastodon ecosystem; clients being built on AT Protocol for Bluesky) are natural integration partners. IPFS and its tooling ecosystem are existing infrastructure, not something neusnet needs to reinvent. The novel contribution of this project is the trust graph protocol and the rating schema — the goal is to define those well and let them compose with whatever hosting and client infrastructure already exists.

*Specified in detail in [hosting.md](spec/hosting.md).*

---

## Communities Without Owners

neusnet was originally conceived in the context of forum-like platforms — asynchronous discussion where posts accumulate over hours or days. But the line between "forum" and "chat" has always been blurry: people have real-time exchanges on forums, and chat threads stretch across days. The underlying problem neusnet addresses applies equally to both.

That problem is structural: on platforms like Discord, Reddit, or any server- or group-based social network, someone has to be in charge. The server owner, the subreddit moderator, the group admin — their role is not incidental but architecturally mandated. The community's shared history and membership list live on infrastructure they control, which means curation policy is necessarily centralized. When that policy becomes contested, the only recourse is to leave — and leaving means abandoning the shared history and dispersing the community. This dynamic repeats endlessly: servers splinter, subreddits fork, communities scatter.

neusnet's architecture dissolves this problem not by improving how centralized moderation works, but by eliminating the structural necessity of it.

### Tags as Communities

The organizing unit of neusnet is not a room, server, or group — it is a **tag**. Tags are freeform, unowned, and unregistered. Anyone can post under `#philosophy`; no one administers it. The community that forms around a tag is defined entirely by who uses it and how the people who read it weight those contributors through their trust graphs.

This maps directly onto Usenet's newsgroup model — `#philosophy` is `rec.arts.philosophy` without the hierarchy and without the server operator who could shut it down. A subset of people wanting a more focused space can simply adopt a more specific tag. Tags support an optional dot notation for expressing explicit hierarchy: `#philosophy.epistemology` asserts that this post is about epistemology as a subtopic of philosophy, while `#philosophy-basement` is simply a flat tag whose name happens to contain "philosophy". A community can self-organise under `#philosophy.basement` to make that containment relationship explicit, or use a flat tag to remain independent. Either way, the community is owned by no one. Searching for `#epistemology` returns posts tagged `#philosophy.epistemology` and `#psychology.epistemology` alike — hierarchical tagging adds precision without creating silos or penalising discoverability.

### Feeds as Channels

A client that lets users save tag searches as named feeds provides the Discord channel experience without the Discord power structure. A user might configure:

- A `#music` feed
- A `#philosophy` feed
- A `#philosophy-basement` feed
- A combined feed for `#star-trek` and `#star-wars`

Each feed is a personalized, trust-graph-filtered view of all posts under those tags — the user's own curated channel list, assembled from the global tag space, answerable to no one but themselves. Two members of the same tag-community see different views of it based on their respective trust graphs. There is no single authoritative view, no algorithm imposed from above, no moderator whose removal of a post affects what you see.

### The Schism Problem

The recurring schism dynamic of community platforms — where a faction unhappy with administration policy leaves to found a rival space — looks different through this lens. In a room-based platform, leaving is costly: you lose access to shared history, your posts are left behind, the community fractures along an ownership boundary. In neusnet, there is no ownership boundary to fracture along.

A group of users who want a more focused version of a community can coalesce around a sub-tag without anyone being expelled from anything. Their `#philosophy-basement` posts remain visible in `#philosophy` searches for anyone whose trust graph surfaces them. The broader community loses nothing; the sub-community gains a coherent identity. Both can exist simultaneously without conflict, and the relationship between them is determined by individual trust graph choices rather than administrative fiat.

### Presence and Buddy Lists

The `status` field in the identity document (see identity.md §5.2) allows users to publish a short free-text presence signal — "writing", "away", "open to discussion" — updated as frequently as they like. This is not binary online/offline presence detection, which would require centralized infrastructure, but it is sufficient for the social function presence serves in most contexts: knowing whether someone is around and what they're up to.

Clients can compose this with the feed model to produce a **buddy list** for any tag-feed: the set of authors with posts in that feed who have positive affinity, ordered by recency of identity document update, with their current status displayed. No new protocol machinery is required — this falls entirely out of the trust graph, the tag system, and the identity document, composed by the client.

### The Real-Time Layer

neusnet does not attempt to replace the purely ephemeral layer of chat platforms — typing indicators, voice and video, instantaneous delivery guarantees. For those, [Matrix](https://matrix.org) and [XMPP](https://xmpp.org) are appropriate transports and neusnet is designed to interoperate with them (see hosting.md §5). The division of responsibility is clean: neusnet handles everything above the threshold of content worth persisting; real-time transient signaling is delegated to protocols built for it. A client could present both in a unified interface without either layer needing to subsume the other.

---

## Client Implementation Recommendations

The following are not protocol requirements but represent good practice for neusnet client software.

### The Endorsed Content List

Every user's set of positively-rated post identifiers — regardless of where those posts are hosted — functions as a **unified discovery feed**. Whether an identifier in that list is an IPFS CID, a BitTorrent magnet link, or a URL to a post on Mastodon or Bluesky, peers pull from it the same way. This means the pinning behavior and the gossip discovery protocol are the same mechanism viewed from two angles: pinning is what you do locally with content you endorse, and sharing your list of endorsed identifiers is how peers discover new content. One list serves both purposes across all hosting backends simultaneously.

In an IPFS deployment, clients should consider automatically **pinning** content from this list — keeping a local copy and contributing to its availability on the network:

- **Metadata files** for all positively-rated posts should always be pinned locally — they are small and their availability is important for graph traversal.
- **Full content payloads** (especially large media files) might only be pinned above a higher rating threshold, or only for content below a configurable file size limit, to avoid undue storage consumption.
- If the user subscribes to a remote pinning service, highly-rated content can be pinned there too, ensuring availability when the local machine is offline. Which pinning service to use, and at what threshold, should be **user-configured** — the client should not choose a remote service on the user's behalf.

Conversely, content that has been retrieved and processed but rated negatively can be **unpinned and garbage-collected** after a grace period. The user has contributed to the network by retrieving it; they are not obligated to continue hosting it.

### Cached Rating Distribution

Proximal peers should serve not only their own rating records but also **cached copies of rating records** they have retrieved from their own proximal peers. This means that when your client fetches ratings from a directly-connected peer, it receives an immediate approximation of the broader graph — ratings from peers-of-peers and beyond — without having to crawl outward hop by hop before anything is useful.

Your client then operates in two modes simultaneously:

- **Fast approximate mode**: cached ratings from proximal peers are available immediately on startup and provide a useful working approximation of the full graph.
- **Slow precise mode**: your client lazily reaches out directly to more distal peers to verify whether the cached versions it received are current, updating its local view as fresher data arrives.

This lazy verification step also provides a natural integrity check. A proximal peer cannot silently manipulate what you see from people further out without the manipulation being detectable as soon as your client makes direct contact with those further peers and finds a discrepancy. Since all rating records are cryptographically signed by their original authors, any tampering is immediately evident. And any peer caught serving falsified or selectively withheld cached ratings loses affinity with you as a consequence — reducing their influence over your view going forward. The incentive structure discourages manipulation without requiring a separate enforcement mechanism.



- **Not a moderation system.** neusnet does not remove or suppress content globally. Content that is invisible to you may be perfectly visible to someone else. The platform has no global moderators and no central content policy.
- **Not anonymous.** Posts and ratings are signed with keypairs. Pseudonymity is possible (your keypair need not be linked to your real identity), but the system does not provide anonymity guarantees. Users who need strong anonymity should route through appropriate tools independently.
- **Not finished.** This document is a design proposal and invitation to collaborate, not a specification of a working system.

---

## Current Status and How to Get Involved

neusnet is currently in the **design and specification phase**. No production code exists yet.

The immediate priorities are:

1. Formalizing the ratings protocol and data schema
2. Defining the metadata file format
3. Prototyping the trust graph traversal algorithm
4. Identifying existing projects — multi-platform social clients, IPFS tooling, AT Protocol developers — to collaborate with rather than duplicate

If any of this resonates with you — whether you're interested in the philosophy, the cryptography, the distributed systems engineering, the client UX, or just want to argue about the design — contributions and discussion are welcome.

To get in touch, contact **Forrest Cameranesi** at [forrest@cameranesi.com](mailto:forrest@cameranesi.com).
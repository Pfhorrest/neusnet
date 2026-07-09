# neusnet Client Implementation Recommendations

*Working draft — design phase*

This document collects recommended (non-mandatory) client behaviors and interface patterns for neusnet implementations. None of what follows is a protocol requirement — everything here could be implemented differently or omitted entirely without breaking interoperability with other clients. It is a companion to [../README.md](../README.md) (overview and motivation), [ratings.md](ratings.md) (Layer 1: Rating Protocol), [metadata.md](metadata.md) (Layer 2: Content Metadata), [identity.md](identity.md) (Layer 3: Identity), and [hosting.md](hosting.md) (Layer 4: Content Hosting and Distribution).

---

## The Endorsed Content List

Every user's set of positively-rated post identifiers — regardless of where those posts are hosted — functions as a **unified discovery feed**. Whether an identifier in that list is an IPFS CID, a BitTorrent magnet link, or a URL to a post on Mastodon or Bluesky, peers pull from it the same way. This means the pinning behavior and the gossip discovery protocol are the same mechanism viewed from two angles: pinning is what you do locally with content you endorse, and sharing your list of endorsed identifiers is how peers discover new content. One list serves both purposes across all hosting backends simultaneously.

In an IPFS deployment, clients should consider automatically **pinning** content from this list — keeping a local copy and contributing to its availability on the network:

- **Metadata files** for all positively-rated posts should always be pinned locally — they are small and their availability is important for graph traversal.
- **Full content payloads** (especially large media files) might only be pinned above a higher rating threshold, or only for content below a configurable file size limit, to avoid undue storage consumption.
- If the user subscribes to a remote pinning service, highly-rated content can be pinned there too, ensuring availability when the local machine is offline. Which pinning service to use, and at what threshold, should be **user-configured** — the client should not choose a remote service on the user's behalf.

Conversely, content that has been retrieved and processed but rated negatively can be **unpinned and garbage-collected** after a grace period. The user has contributed to the network by retrieving it; they are not obligated to continue hosting it.

## Channels

A **channel** is a persistent, user-defined feed rooted in one or more tags, optionally extended with a local taxonomy. Clients should support channels as a first-class navigation element — the primary way users organise their ongoing reading and participation rather than performing ad hoc searches.

The recommended channel interface provides:

**Browsing affordances.** Subtags that share the channel's root component (e.g. `#philosophy.epistemology` in a `#philosophy` channel) are included automatically by the tag search rules and need no suggestion. The only suggestions a client needs to make are **cross-hierarchy component inclusions**: when posts in a channel frequently carry a subtag whose leaf component also appears as a bare tag or under a different parent, the client may suggest including that component more broadly. For example, if `#philosophy.epistemology` is common in a user's `#philosophy` channel, the client might ask whether bare `#epistemology` posts should also be included. Every such suggestion must state its exact scope plainly — "this will include all posts where `epistemology` appears as a tag segment anywhere" — because the client cannot know whether the suggestion is a good one or an overly broad one; only the user can make that call. Users can accept, or permanently dismiss a suggestion to signal that the tagging pattern that generated it isn't one worth reinforcing.

**Post composition.** Composing a post from within a channel should pre-populate the appropriate tag. For a root channel (`#philosophy`), the post is tagged `#philosophy`. For a subchannel (`#philosophy → #epistemology`), the post is tagged `#philosophy.epistemology`. This removes the friction of manual tagging for conversational posts and, crucially, ensures that participation in a channel generates the tagging signal that makes the channel's taxonomy visible to other users' clients through the trust graph. Users simply post into a channel as they would send a message to an IRC channel; the tagging happens automatically and propagates the community's conceptual structure.

**Top-level discovery.** The client should offer a browsable index of tag components derived from posts by positive-affinity users — a personal "topics" view that reflects what the user's corner of the network actually discusses. This serves as the entry point for users building their initial channel set and for exploring beyond established channels.

The naming is intentional. IRC channels are `#`-demarcated; neusnet tags are `#`-demarcated. The `#` that prefixes a tag and the `#` that prefixes an IRC channel name are the same symbol doing the same job. A neusnet channel rooted in `#philosophy` is, in a direct sense, `#philosophy` — the same kind of named, topic-scoped gathering place, but without any server that owns it or operator who can kick you out.

## Cached Rating Distribution

Proximal peers should serve not only their own rating records but also **cached copies of rating records** they have retrieved from their own proximal peers. This means that when your client fetches ratings from a directly-connected peer, it receives an immediate approximation of the broader graph — ratings from peers-of-peers and beyond — without having to crawl outward hop by hop before anything is useful.

Your client then operates in two modes simultaneously:

- **Fast approximate mode**: cached ratings from proximal peers are available immediately on startup and provide a useful working approximation of the full graph.
- **Slow precise mode**: your client lazily reaches out directly to more distal peers to verify whether the cached versions it received are current, updating its local view as fresher data arrives.

This lazy verification step also provides a natural integrity check. A proximal peer cannot silently manipulate what you see from people further out without the manipulation being detectable as soon as your client makes direct contact with those further peers and finds a discrepancy. Since all rating records are cryptographically signed by their original authors, any tampering is immediately evident. And any peer caught serving falsified or selectively withheld cached ratings loses affinity with you as a consequence — reducing their influence over your view going forward. The incentive structure discourages manipulation without requiring a separate enforcement mechanism.

## Rating Dimension UI

The four core rating dimensions — True, Good, Important, and New — can be difficult to convey through labels alone. Clients are encouraged to represent them with icons that communicate their intended meaning at a glance, supplemented by brief tooltip descriptions for new users.

The four dimensions fall naturally into two pairs along two axes, which the visual design can reflect:

**Content axes** — dimensions that evaluate the content's relationship to reality and ethics:
- **True** (factual accuracy): a checkmark for positive, an ✗ for negative. These symbols are effectively universal for correct/incorrect.
- **Good** (ethical and aesthetic quality): a smiling face for positive, a frowning face for negative.

**Conversation axes** — dimensions that evaluate the content's relationship to the ongoing discourse:
- **Important** (significance, worth attention): an exclamation mark for positive, an ellipsis for negative. The ellipsis naturally conveys "so what?" or "going nowhere" — a visually apt rendering of unimportance.
- **New** (originality, not a rehash): this is the hardest dimension to iconify, since "new" means *novel and original* rather than *recently published*. Possible approaches include a shine or sparkle versus dust or trash, a lightbulb (original thought) versus a recycling symbol (rehash), or an excited face versus a yawn. No obvious universal symbol exists here; clients should experiment and tooltips are especially important for this dimension.

Grouping the two content axes together and the two conversation axes together in the UI — whether by proximity, colour, or a subtle divider — can help users build an intuition for what each dimension is actually measuring and why the four are independent of one another.

---

## Personal AI Proxies

A more speculative but potentially powerful client feature: allowing a user to run an AI agent, modeled on their own behavior, as a **separate neusnet identity** that acts on their behalf within configurable bounds. This section describes the concept, the two modes of operation it could support, and the safeguards that make it compatible with — rather than corrosive to — the trust model the rest of this specification is built around.

### Why This Differs From Algorithmic Curation

Centralized platforms already do something that looks superficially similar: an algorithm decides what you see, and increasingly, generative systems produce or amplify content on those platforms. The reason this is broadly experienced as a problem is that the algorithm answers to the platform's incentives, not to the user, and it operates identically and invisibly across an entire user base with no accountability to any individual.

A personal AI proxy inverts every part of that. It is:

- **Individually owned**, not platform-operated. Each proxy models one person and answers only to them.
- **A first-class, disclosed identity** in the trust graph, not an invisible ranking function. It can be rated, distrusted, and its influence traced and bounded like any other participant.
- **Subordinate to the trust graph**, not above it. A proxy's output only reaches other users through the same affinity mechanics that govern every other identity — it has no privileged distribution channel.
- **Continuously correctable** by the human it models, with that correction feeding directly back into its future behavior.

The goal is to capture some of what makes algorithmic assistance genuinely useful — mainly, that it can attend to far more content than a human has time for — without reproducing the opacity, unaccountability, and platform-serving incentives that make algorithmic curation corrosive in its current form.

### Disclosure Requirement

A personal AI proxy is not a case for the voluntary identity linking mechanism of identity.md §7, which is designed for a person's own alternate accounts declaring mutual ownership as peers. A proxy is a *subordinate, derivative* agent, and representing it as an equal peer identity would be a form of undisclosed manipulation — exactly the kind of thing the trust model depends on not happening.

Proxy identities must therefore be disclosed as such, both structurally and visibly:

- The proxy's identity document must include an `operator` field naming the human identity it acts on behalf of, and a `proxy: true` flag. (See identity.md for the schema addition.)
- Every post and rating record authored by a proxy identity must be visually and unambiguously marked as bot-authored in any compliant client — never something a viewer has to check a profile to discover.
- A proxy should not be capable of representing itself, through display name, avatar, or bio, in a way that could be mistaken for its operator.

### Mode 1: Rating Proxy

The simplest and lowest-risk application: a proxy reads far more content than its operator ever could, and rates it the way it predicts its operator would.

**Mechanics.** The operator has strong positive affinity with their own proxy by default. The proxy's ratings therefore surface, in the operator's own view, content the operator likely would have liked but never had time to find, and suppress content the operator likely would have disliked. This is ordinary trust graph behavior — no new propagation mechanism is needed.

**Learning loop.** When the operator rates something the proxy has already rated, any divergence is signal: the proxy updates its model of the operator's preferences accordingly. Over time the proxy's predictions should converge toward the operator's actual judgment, particularly within domains the operator rates frequently.

**Propagation to others.** Because affinity decays across hops in the ordinary way (ratings.md §4), a person with positive affinity toward the operator inherits a diminished-weight signal from the operator's proxy as well as from the operator directly. This produces two layered signals available to friends of the operator: a narrow, heavily-weighted layer of "how my friend actually rated this," and a broader, lightly-weighted layer of "how my friend's proxy predicts they would have rated this, had they seen it." The second layer only exists because the proxy read content the human never got to.

**Configuration.** Operators should be able to bound their proxy's activity — which channels or tags it reads and rates, how aggressively, and whether its ratings are public at all. A proxy's ratings should be distinguishable from the operator's own ratings in the underlying data (they are signed by a different key, since the proxy is a separate identity) even though a client may choose to blend them into a single view for the operator.

### Mode 2: Conversational Proxy (Opt-In)

A more involved and more carefully bounded application: a proxy that can post, not just rate — but only to *fill gaps*, never to compete with the humans it is modeling itself on.

**Core principle.** The proxy exists to pick up the slack where humans are failing to engage with each other, not to supplant human conversation. Every mechanism below is designed to enforce that a proxy is a backstop for absence, never a competitor for presence.

**Delay.** A conversational proxy must wait a substantial period — on the order of a day, configurable by the operator — before considering a response to any given post or thread it is not already participating in. If a human provides a satisfactory response in that window, the proxy stands down. The delay is not a rate-limiting technicality; it is the mechanism that keeps the proxy in a genuinely secondary role.

This cold-insertion delay is distinct from, and should be considerably longer than, any delay governing a proxy's response to a **direct reply to one of its own prior messages**. Once a proxy has posted and a human addresses it directly, the proxy is no longer inserting itself into a conversation — it has been invited into one. Clients should offer separate, independently configurable delay and rate-limit settings for these two cases: a cautious, generous delay for unprompted interjection into conversations the proxy was not part of, and a much shorter, more responsive delay (or none at all) for replying to someone who has directly engaged with it.

**Rate limits and participation ceilings.** A proxy should have a hard ceiling on how much of any single conversation it can occupy — for instance, capped at a small fraction of the messages in a thread — so that even in the worst case of several operators' proxies independently deciding a conversation warrants input, no thread can be numerically dominated by bots. This guards against a cascade failure mode where a genuinely human conversation gets swarmed by well-intentioned agents.

**Selectivity.** A proxy should not attempt to weigh in on every thread that meets its delay and topical criteria — only ones it predicts its operator would specifically care about, based on the same behavioral model used for rating. This keeps proxy participation sparse and targeted rather than blanket.

**Illustrative use cases**, all gated by the delay and only pursued if no human has already addressed the issue:

- **Clarifying persistent misunderstanding.** If one participant appears to be consistently misreading another's position, the proxy can attempt to restate the misread position in the terms its originator likely intended.
- **Surfacing overlooked synthesis.** If two participants are arguing past each other toward positions that share more common ground than either has acknowledged, the proxy can propose the synthesis: "Have you considered [third position]? It preserves [point A] from one side and [point B] from the other."
- **Correcting factual errors.** If an unchallenged factual claim in the thread appears to be wrong, the proxy can offer a sourced, hedged correction — "If I'm reading [source] correctly, it's actually..." — rather than a flat assertion.
- **Answering unanswered questions.** If a direct question has gone unanswered, the proxy can offer what it believes the answer to be, sourced and hedged, explicitly leaving room for a better human answer.

**Social ping, with optional tentative summary.** Rather than attempting to weigh in on the substance of a conversation directly, a proxy's default and lowest-risk action is to simply flag its operator — "this looks like a conversation you might have something to say about." If configured to go further, it can accompany the ping with a tentative, clearly-hedged summary of what it predicts the operator's view would be, explicitly framed as provisional: "I think @user would probably argue [tentative summary], but I'll let them elaborate if they like." This keeps the proxy in a purely advisory role with respect to the conversation itself, deferring entirely to the human's own words if and when they arrive.

From here, one of several things typically happens:

- The operator sees the ping and replies in their own words, unprompted by anything further from the proxy. The proxy's job was simply to draw attention; it is done.
- The operator replies specifically inviting the proxy to attempt a fuller elaboration on their behalf — "go ahead and try, I'll correct anything you get wrong." This is a distinct, more deliberate mode of engagement than the initial autonomous ping: it is directly solicited by the operator rather than independently initiated by the proxy, and because the proxy has now been invited into the conversation, the direct-reply delay and rate limits (rather than the cold-insertion ones) govern its subsequent participation.
- Having made this attempt, the proxy may get it right, in which case the operator may uprate the response, or simply let it stand with no further action needed.
- Or the proxy's attempt may not fully capture the operator's actual view, in which case the operator corrects it. Further back-and-forth between operator and proxy may continue until the operator is satisfied, until the operator explicitly dismisses the discrepancy as unimportant ("never mind, that detail doesn't matter"), or until the operator simply disengages without further reply. Every correction in this exchange is valuable, concrete training signal for the proxy's model of its operator — considerably more useful than the hypothetical divergences the rating-proxy mode alone can surface, since it responds to a specific, situated attempt rather than an abstract prediction.

**Epistemic hedging is mandatory, not stylistic**, throughout every stage of this sequence. A conversational proxy speaks in probabilistic, attributive language — "I think X would probably say...", "according to [source]...", "I could be wrong, but..." — never in its operator's own voice as though it *were* them. It represents a prediction about what its operator might think, not a substitute utterance on their behalf, even after an operator has explicitly invited it to elaborate.

### Open Questions

**Bot-to-bot dynamics.** If many users run conversational proxies, what happens when two or more proxies end up interacting directly with each other rather than with humans? The participation ceiling per thread partially addresses this, but the interaction between multiple proxies' independent timing and selectivity heuristics needs more thought — a scenario where proxies primarily converse with other proxies while humans are elsewhere in the thread would be a significant failure mode to avoid.

**Model provenance and quality variance.** Different users will have proxies of wildly different quality and fidelity to their operator's actual views, depending on what underlying model they use, how it's configured, and how much correction history it has accumulated. Whether or how the network should surface this variance — so viewers can calibrate their trust in a given proxy's predictions accordingly — is unresolved.

**Long-term drift.** A proxy's model of its operator could drift from who the operator actually is over time, particularly if the operator's views evolve faster than the correction loop can track, or if the operator stops actively correcting it. Clients may want to periodically prompt operators to review and re-calibrate their proxy's recent behavior.

### The Trust Graph Is the Real Safeguard

The disclosure and restraint requirements above (delay, rate limits, hedging, mandatory disclosure) are recommended practice for good-faith client implementers — but they are not what actually protects the network from disruptive bots, and the specification should not be read as depending on them. Nothing in the protocol can stop someone from writing a client that ignores every one of these recommendations and deploys an aggressive, undisclosed, or manipulative bot. What the protocol provides instead is the same backstop it provides against any disruptive human actor: the trust graph itself.

A disruptive bot is just an identity whose output people don't like. It accumulates negative ratings from anyone who encounters it directly, which suppresses it immediately in their own view. More importantly, its *affinity score* decays outward through the graph exactly as a disruptive human's would — via the same mechanics specified in ratings.md §4, including the enemy-of-my-enemy sign inversion (§4.6) that lets a network route around coordinated bad actors without any central intervention. A bot has to actually be liked — by enough of the right people, weighted by each individual viewer's own trust graph and their trust in whoever vouches for the bot — or it simply never surfaces in anyone's view who hasn't sought it out directly.

The disclosure fields (`proxy` and `operator`) matter for exactly this reason: they ensure the consequences of a disruptive proxy's behavior land on the correct identity rather than being laundered through anonymity. An operator whose proxy misbehaves and is disclosed as such takes the affinity hit through their `operator` binding. An operator who tries to evade this by omitting disclosure doesn't escape the consequence — they just get an unlinked stranger identity that has to build affinity from zero like anyone new to the network, with none of the trust their disclosed human identity may have already earned.

In other words: this specification could say nothing at all about bots, proxies, or conversational agents, and the trust graph would still be the mechanism doing the actual work of keeping disruptive automated behavior from surfacing. Everything in this section is about making that mechanism work *well* — giving good-faith implementers a design that earns trust quickly and deserves it — not about creating a rule that could be enforced against bad-faith ones. There is no such enforcement in a decentralized system, by design, and there doesn't need to be.
# neusnet Specification Layer 3: Identity

*Working draft — design phase*

This document specifies the neusnet identity model: how users are identified, how their signatures are verified, and how identity persists, rotates, and optionally presents itself to other users. It is a companion to [README.md](../README.md) (overview and motivation), [ratings.md](ratings.md) (Layer 1: Rating Protocol), [metadata.md](metadata.md) (Layer 2: Content Metadata), [hosting.md](hosting.md) (Layer 4: Content Hosting and Distribution), and [client-recommendations.md](client-recommendations.md) (client implementation recommendations).

---

## 1. Design Principles

Identity in neusnet is built on three principles:

**Minimum viable identity is a keypair.** A user who generates an [Ed25519](https://ed25519.cr.yp.to) keypair and never publishes anything else has a valid neusnet identity. No registration, no username database, no central authority. The public key is the identifier; the private key is the credential.

**Richer identity is optional and user-controlled.** Users may publish a hosted identity document containing a display name, avatar, profile text, and links to other accounts. This is a convenience layer on top of the keypair, not a requirement.

**Multiple identities are supported.** A user may maintain any number of independent keypairs — one for professional discourse, one for personal use, one for a specific community. Whether and how to link these identities is entirely at the user's discretion. The protocol provides a voluntary linking mechanism but does not require or encourage it.

---

## 2. User Identifiers

A neusnet user identifier is the **Base58-encoded Ed25519 public key** of the user's keypair, prefixed with `nid1` to namespace it from other Base58-encoded identifiers. The Base58 encoding uses Bitcoin's alphabet (`123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`):

```
nid1<Base58-encoded 32-byte Ed25519 public key>
```

Example: `nid1F3sAqQpLzFtKmVbRwXcNyHjDgEoIuPe...`

This identifier:
- Appears in the `rater` field of rating records
- Appears in the `author` field of metadata files
- Is the stable handle by which other users recognize and rate a person
- Is derived entirely from the public key — no registration or allocation required

Display names are not unique and must never be used as the primary identifier in any client UI. Clients should always display the user identifier alongside or below the display name in any context where impersonation risk is meaningful.

### 2.1 Alternative Identity Substrates

Users who prefer not to manage raw keypairs may use identifiers from other systems as their neusnet user identifier, at the cost of some degree of centralization:

| Substrate | Identifier form | Notes |
|-----------|----------------|-------|
| [AT Protocol](https://atproto.com) | `at://did:plc:...` or `at://did:web:...` | Decentralized; recommended alternative |
| [Nostr](https://nostr.com) | `npub1...` (secp256k1) | Large existing ecosystem; different curve from native neusnet |
| [W3C DID](https://www.w3.org/TR/did-core/) | `did:key:...`, `did:web:...`, etc. | Most interoperable standard |
| OAuth/SSO | `oauth:<provider>:<user-id>` | Centralized; acceptable for early adoption, not recommended long-term |

When an alternative substrate identifier is used, the signature scheme associated with that substrate applies (see Section 4). Rating records and metadata files from such users are valid neusnet objects; they simply use a different identifier format and signing method.

Clients should display a visual indicator of which identity substrate a user is using, so other users can understand the trust and decentralization properties of that identity.

### 2.2 External Platform Identity Binding

Users who have accounts on platforms that provide no native cryptographic identity and no open API — traditional forums, Reddit, Twitter/X, phpBB installations, and similar — can still anchor those accounts to their neusnet identity through a mutual attestation convention requiring no platform cooperation.

The binding works in two directions simultaneously, and is only considered verified when both are present:

**Direction 1 — Platform → neusnet (the key token):**
The user publishes their neusnet public key as a parseable token in their platform profile bio, or in the body of a designated post (e.g. a pinned post, a profile post, or an introductory thread post). The canonical token format is:

```
[neusnet:nid1<Base58-encoded public key>]
```

For example: `[neusnet:nid1F3sAqQpLzFtKmVbRwXcNyHjDgEoIuPe...]`

This token asserts: "whoever controls this platform account also controls this neusnet keypair." Any client that can read the platform profile can extract and verify the key.

**Direction 2 — neusnet → platform (the links claim):**
The user includes the URL of their platform profile in the `links` array of their neusnet identity document, signed with their neusnet private key.

For example, in the identity document:
```json
"links": [
  { "url": "https://reddit.com/user/exampleuser", "label": "Reddit" }
]
```

This asserts the reverse: "the neusnet identity `nid1...` is also the operator of this platform account."

**Verification procedure:**
A client verifying a claimed binding between a platform account and a neusnet identity should:
1. Retrieve the platform profile and extract the `[neusnet:nid1...]` token from the bio or designated post.
2. Resolve the neusnet identity document for the extracted key.
3. Confirm that the identity document's `links` array contains the platform profile URL.
4. If both checks pass, the binding is verified: the platform account and the neusnet identity are mutually attested as belonging to the same person.

A unilateral claim in either direction alone — a key token in a bio with no corresponding `links` entry, or a `links` entry pointing to a profile with no key token — should be displayed as unverified.

**Implications for ratings and affinity:**
When a binding is verified, ratings given to content published under the platform account contribute to affinity with the verified neusnet identity, not merely to an anonymous platform URL. A third party who introduces a platform post as a bridged neusnet metadata file (metadata.md §6.3) and correctly sets the `author` field to the verified neusnet identity enables those ratings to flow into the trust graph against the author's full identity. Without verified binding, ratings accumulate against the platform URL as an opaque identifier with no connection to the trust graph.

**Historical note:**
This convention follows a well-established pattern: PGP users distributed their key fingerprints in email signatures and forum profiles for decades before email clients natively supported cryptographic identity. The neusnet key token is the same idea applied to the modern fragmented platform landscape. It requires no cooperation from the platform, no API access, and no changes to how the platform works — only the ability to edit a bio or post a message.

---

## 3. Keypair Generation and Storage

### 3.1 Key Generation

A neusnet keypair is a standard Ed25519 keypair:
- **Private key**: 32 bytes of cryptographically secure random data
- **Public key**: the corresponding 32-byte Ed25519 public key, derived deterministically from the private key

Key generation must use a cryptographically secure random number generator. Client software must not generate keys from weak entropy sources.

### 3.2 Private Key Storage

The private key must be stored securely. Client software should:
- Encrypt the private key at rest using a user-supplied passphrase (recommended: [Argon2id](https://datatracker.ietf.org/doc/html/rfc9106) key derivation, [AES-256-GCM](https://csrc.nist.gov/publications/detail/sp/800-38d/final) encryption)
- Never transmit the private key over any network connection
- Warn users clearly that loss of the private key without registered recovery keys means permanent loss of that identity

### 3.3 Recovery Keys

At identity creation, users are strongly encouraged to generate and register one or more **recovery keypairs** — Ed25519 keypairs stored separately from the primary key (e.g. on paper, a hardware token, or with trusted contacts).

Recovery keys are registered by including them in the user's initial identity document (Section 5). Once registered, a sufficient quorum of recovery keys (per the `recovery_threshold` field) can sign a rotation declaration (Section 6.2) to migrate the identity to a new primary key if the original is lost or compromised.

Loss of the primary key with no registered recovery keys, or without a sufficient quorum of recovery keys available, is permanent loss of that identity. The protocol provides no further recovery mechanism — decentralized identity has no password reset.

Users should treat recovery key distribution as a security-critical decision. A recovery key held by a third party is only as trustworthy as that party — if a sufficient quorum of recovery keys is compromised simultaneously with the primary key, an attacker could issue a fraudulent rotation declaration and seize control of the identity. Higher thresholds and broader key distribution increase resilience against key loss but also increase the attack surface for coordinated compromise. There is no universally correct answer; users should choose a configuration that reflects their own threat model.

---

## 4. Signatures

### 4.1 Signature Algorithm

The native neusnet signature algorithm is **Ed25519** as specified in [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).

For users on alternative substrates, the signature algorithm associated with that substrate applies:
- AT Protocol DIDs: typically Ed25519 or secp256k1 depending on DID method
- Nostr: secp256k1 (Schnorr signatures per [NIP-01](https://github.com/nostr-protocol/nostr/blob/master/01.md))
- W3C DID: as specified by the DID method

### 4.2 Canonicalization

Before signing, the object to be signed (a rating record, metadata file, identity document, or rotation declaration) is serialized to its canonical form using **JCS — JSON Canonicalization Scheme ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785))**:
- Object keys sorted lexicographically at all levels
- No insignificant whitespace
- Numbers in their canonical JSON representation
- Unicode string data preserved exactly as given — JCS explicitly performs **no** Unicode normalization. RFC 8785 is specific on this point: string content "MUST NOT be altered," and the standard notes that Unicode Normalization is deliberately out of scope for JCS-compliant processing.

This last point has a practical consequence worth being explicit about: two strings that a human would consider identical but that differ in their underlying Unicode representation — for instance "é" as a single precomposed code point versus "e" followed by a combining acute accent — are, as far as JCS and signing are concerned, simply different strings, and will produce different canonical forms and therefore different signatures. The protocol places no normalization requirement on free-text fields generally; client implementations that want to avoid this kind of silent divergence (for example, so that a display name entered two different ways by the same input method doesn't produce two different canonical forms) should normalize user-entered text to a consistent form — NFC is the conventional choice — at input time, before the object is constructed and signed, rather than relying on canonicalization to do it for them. This is distinct from, and should not be confused with, the NFKC tag normalization specified in ratings.md §6.1, which is a deliberate protocol-level rule for a specific field, not a general property of JCS.

All signature fields are excluded from the object before canonicalization and signing. All other fields are included.

### 4.3 Signature Encoding

The 64-byte Ed25519 signature is encoded as a **Base64url** string ([RFC 4648](https://www.rfc-editor.org/rfc/rfc4648) §5, no padding) and stored in the relevant signature field. Signatures from alternative substrates use the encoding conventions of that substrate.

### 4.4 Verification

To verify a signature on a rating record or metadata file:
1. Extract and set aside all signature fields.
2. Serialize the remaining fields to JCS canonical form.
3. Resolve the signer's public key from the `rater` or `author` field (or the signer's key for third-party attestations).
4. Verify the signature over the canonical serialization using the applicable algorithm for the identity substrate.

A record whose signature does not verify must be treated as invalid and discarded. Clients must not display, propagate, or compute with invalid records.

---

## 5. Identity Documents

An identity document is an optional hosted file that provides human-readable and machine-readable information about a user. It is not required for participation in the neusnet network but is recommended for any user who wants to be recognizable to others.

### 5.1 Hosting

Identity documents are hosted using the same mechanisms as post metadata (see hosting.md), with the user's IPNS name (or equivalent stable identifier on other substrates) serving as the stable address. The identity document at that address may be updated over time; each version is a distinct content-addressed object.

Clients that access an identity document should also lazily check for any rotation declarations associated with that identity (see Section 6.3). Identity documents and rotation declarations from users with positive affinity should be included in a client's pinned and gossiped content set alongside post metadata, so that identity information propagates as a natural side effect of normal participation.

### 5.2 Schema

An identity document is a signed JSON object:

```json
{
  "neusnet_version":    1,
  "type":               "identity",
  "id":                 "<user identifier>",
  "display_name":       "<string>",
  "bio":                "<string>",
  "avatar":             <content reference>,
  "links":              [ <link>, ... ],
  "status":             "<string>",
  "recovery_keys":      ["<nid1... encoded public key>", "..."],
  "recovery_threshold": <integer>,
  "linked_ids":         [ <identity link>, ... ],
  "aggregate_linked":   <boolean>,
  "proxy":              <boolean>,
  "operator":           "<user identifier>",
  "timestamp":          <unix timestamp>,
  "signature":          "<signature over all other fields>"
}
```

**`neusnet_version`** — integer. Must be `1`.

**`type`** — string. Must be `"identity"`. Distinguishes identity documents from post metadata files and other neusnet JSON objects.

**`id`** — string. The user identifier this document describes. Must match the key used to produce the `signature`.

**`display_name`** — string. Optional. A human-readable name the user wishes to be known by. Not unique; not verified. Multiple users may use the same display name.

**`bio`** — string. Optional. A short free-text description of the user.

**`avatar`** — content reference object. Optional. A reference to an image file, using the same content reference format as metadata.md §4 (with `uri`, `mime_type`, `size`, and `hash` fields). Should be a square image; recommended formats are JPEG and PNG.

**`links`** — array. Optional. A list of links to the user's presence elsewhere on the web. Each link is an object with `url` (string, required, and an absolute URL) and `label` (string, optional) fields.

**`status`** — string. Optional. A short free-text presence or status message, analogous to a chat platform's status field (e.g. "writing", "away until Friday", "open to discussions about modal logic"). Unlike `bio`, which describes the user in a stable way, `status` is intended to be updated frequently and reflects the user's current state or mood. Clients may display status alongside the user's display name in tag-feed buddy lists and other social views. There is no protocol-level mechanism for distinguishing online/offline presence — `status` is purely a user-published string, and its freshness is indicated by the identity document's `timestamp` field.

**`recovery_keys`** — array of strings. Optional but strongly recommended. One or more `nid1`-encoded public keys of the user's registered recovery keypairs. Publishing these establishes a verifiable record before they are needed. Entries must be distinct (a key listed twice must not be able to count twice toward a threshold) and must differ from the identity's own key (a recovery key identical to the primary key is not a separate fallback). A single recovery key is the recommended default for most users.

**`recovery_threshold`** — integer. Optional. The minimum number of recovery key signatures required to authorize a recovery rotation (see Section 6.2). Defaults to `1` if absent. Users who want stronger recovery security may register multiple recovery keys and set a higher threshold — for example, `recovery_threshold: 2` with three registered keys requires any two to cooperate. Must be at least `1` — a threshold of `0` would authorize a recovery rotation on no signatures at all — and must not exceed the length of `recovery_keys`; giving a threshold when there are no recovery keys is invalid.

**`linked_ids`** — array. Optional. A list of other neusnet identities the user voluntarily declares as also belonging to them. See Section 7.

**`aggregate_linked`** — boolean. Optional. The user's preferred default for how other users' clients should treat their linked identities in trust graph computation. `true` means the user prefers their linked identities to be treated as a single node for affinity purposes; `false` (the default if absent) means they prefer them treated as distinct nodes. Other users' clients may override this preference per their own settings — see Section 7.1.

**`proxy`** — boolean. Optional, defaults to `false`. Must be `true` if this identity is an automated agent operating on behalf of another identity — for example, an AI system modeling a human user's rating and posting behavior (see client-recommendations.md, "Personal AI Proxies"). A proxy identity is structurally distinct from a voluntarily linked alternate identity (Section 7): a proxy is a subordinate, derivative agent, not a peer account, and must be disclosed as such rather than presented as an equal identity. Clients must visibly and unambiguously mark all content from a `proxy: true` identity as automated in every context where it appears, not only on the identity document itself.

**`operator`** — string. Required if `proxy` is `true`, and not permitted otherwise. The user identifier of the human (or other non-proxy identity) this proxy acts on behalf of; it must differ from the proxy's own `id`. A proxy identity's `links` array should also point back to its operator's identity document, and — where the operator wishes to acknowledge the proxy — the operator's own identity document may list the proxy in `links` as well, though this is not required for the proxy's disclosure obligations to be satisfied. Only the `proxy` and `operator` fields on the proxy's own identity document are authoritative for disclosure purposes.

**`timestamp`** — integer. Unix timestamp of when this version of the identity document was published.

**`signature`** — string. Cryptographic signature over all other fields in JCS canonical form, using the applicable signing algorithm for the user's identity substrate (see Section 4). For native neusnet identities this is Ed25519; for alternative substrates the substrate's own signing algorithm applies.

### 5.3 Identity Document Discovery

Given a native neusnet user identifier (`nid1...`), the address of that user's identity document is derived deterministically from their public key as follows:

**Step 1 — Derive the IPNS name from the keypair:**

1. Take the 32-byte Ed25519 public key.
2. Encode it as a `PublicKey` [protobuf](https://protobuf.dev) (key type `Ed25519`, data = the 32 bytes).
3. Compute the SHA-256 multihash of the protobuf encoding.
4. Encode as a CIDv1 with codec `libp2p-key` and base32 encoding.

This produces the user's IPNS name — the `k51qzi5...`-style identifier seen in examples throughout these documents. This is the native [IPFS](https://ipfs.tech)/IPNS derivation for Ed25519 keypairs, compatible with standard IPFS tooling.

**Step 2 — Resolve the IPNS name to a directory:**

The IPNS name resolves to an IPFS [UnixFS](https://github.com/ipfs/specs/blob/main/UNIXFS.md) directory object. All per-user documents are published as named paths under this directory root:

```
ipns://<user's IPNS name>/
├── identity.json       ← identity document (this section)
├── endorsements.json   ← endorsement list (see hosting.md §8.1)
└── rotations/          ← key rotation declarations (see Section 6)
    └── <timestamp>.json
```

The identity document is retrieved at:
```
ipns://<user's IPNS name>/identity.json
```

This structure means a single IPNS record anchors all documents associated with a user's identity. Adding future per-user document types requires only publishing to a new path under the same root, with no change to the IPNS name or derivation formula.

For alternative substrate identifiers, the discovery mechanism follows the conventions of that substrate:
- AT Protocol DIDs: discoverable via the AT Protocol DID resolution mechanism
- Nostr: published as a kind-0 metadata event on Nostr relays, or hosted at `ipns://<derived IPNS name>/identity.json` if the user also maintains an IPFS presence
- W3C DIDs: resolved via the DID resolution mechanism specified for that DID method

Clients encountering a user identifier for the first time should attempt identity document discovery lazily — it is not required before displaying or computing with rating records or metadata files that reference that identifier.

---

## 6. Key Rotation and Recovery

### 6.1 Key Rotation Declaration

A key rotation declaration is a signed record that supersedes one key with another. It enables a user to migrate their identity to a new primary keypair — for example, if their current key is compromised, or if they wish to upgrade their key for any reason.

```json
{
  "neusnet_version": 1,
  "type":            "key_rotation",
  "old_id":          "<user identifier being retired>",
  "new_id":          "<user identifier taking over>",
  "timestamp":       <unix timestamp>,
  "old_signature":   "<signature by old key over all other fields except signature fields>",
  "new_signature":   "<signature by new key over all other fields except signature fields>"
}
```

A valid standard rotation declaration must be signed by **both** the old key and the new key, proving that whoever controls the new key also controlled the old key at the time of rotation.

**What is signed.** Every signature on a rotation declaration — `old_signature`, `new_signature`, and each entry of `recovery_signatures` — is made over the JCS canonical form (§4.2) of the same five fields: `neusnet_version`, `type`, `old_id`, `new_id`, and `timestamp`. No signature covers any other signature. (This differs from the rule for other objects, where the single `signature` field is excluded: a rotation carries several signature fields, and all of them are excluded.) `old_id` and `new_id` must differ. A declaration carries exactly one of `old_signature` (a standard rotation) or `recovery_signatures` (a recovery rotation, §6.2); one carrying both is invalid, since it would be ambiguous which authorization it stands on.

Upon encountering a valid rotation declaration, clients should:
- Treat all future content signed by the new key as belonging to the same identity as content previously signed by the old key.
- Aggregate ratings and affinity across both keys' content for the purposes of trust graph computation.
- Display a visual indicator that a rotation has occurred, with the timestamp, so users are aware the identity has a history under a different key.

**Chains and competing rotations.** Rotations chain: if A rotates to B and B later rotates to C, content signed by any of the three belongs to one identity, whose current key is C. A client follows the chain until it ends or until it reaches a point it cannot follow unambiguously:
- If valid declarations for the same `old_id` name **different** new identities, that identity is **contested**. A compromised old key can always issue a rotation of its own, so competing valid rotations are a real possibility, and nothing in this specification says which is right (see §8.2). Clients must not silently pick one: they should treat the identity as contested, merge nothing beyond the fork, and say so. Several declarations naming the *same* new identity are not a conflict, however each was authorized.
- If the chain loops back on itself, it ends at the last identity before the repeat.

A rotation declaration is itself content-addressed and should be propagated alongside the user's identity document.

### 6.2 Recovery Key Rotation

If the primary key is lost but a sufficient quorum of recovery keys were registered (per `recovery_threshold`), those recovery keys may collectively authorize a rotation declaration in place of the old primary key.

```json
{
  "neusnet_version":     1,
  "type":                "key_rotation",
  "old_id":              "<user identifier being retired>",
  "new_id":              "<user identifier taking over>",
  "recovery_signatures": [
    {
      "recovery_key": "<nid1... encoded recovery public key>",
      "signature":    "<signature by this recovery key over all fields except all signature fields>"
    }
  ],
  "new_signature":       "<signature by new primary key over all fields except all signature fields>",
  "timestamp":           <unix timestamp>
}
```

Clients verify this declaration by:
1. Determining the recovery keys and threshold authorized for `old_id`: the `recovery_keys` and `recovery_threshold` of the identity document the client treats as authoritative for it (§8.1 explains why which document that is, is not obvious).
2. Counting the **distinct** authorized recovery keys that have a valid signature among the `recovery_signatures`. An entry from a key that is not authorized, or whose signature does not verify, is *ignored* rather than invalidating the declaration — `recovery_signatures` is not covered by any signature, so a relay could append entries — and a key counts once however many times it is listed (otherwise one key listed twice would satisfy a threshold of 2).
3. Confirming that this count meets or exceeds the `recovery_threshold` (defaulting to 1 if unset; it is never less than 1, §5.2).
4. Verifying `new_signature` against the new primary key.

If all checks pass, the rotation is valid and treated identically to a standard rotation.

### 6.3 Rotation Declaration Discovery

A rotation declaration is published under the `/rotations/` path of the **new** identity's IPNS directory (see Section 5.3), each declaration stored as a separate file named by its Unix timestamp:

```
ipns://<new identity's IPNS name>/rotations/<timestamp>.json
```

It goes under the new identity because the new key is the one party that can always write there: after a recovery rotation the old key is lost by assumption, so the old identity's directory can no longer be updated. A standard rotation may *also* be published under the old identity's `/rotations/` directory before the old key is retired, which lets clients that still follow the old identity learn of it directly.

When a client accesses an identity document, it should lazily check that identity's `/rotations/` directory, whose listing indexes every rotation declaration naming that identity as `new_id`. A client that follows only the *old* identity, and finds no declaration there, learns of a rotation by propagation instead: when it encounters the new identity (its content, its rating collection, an endorsement list) it reads that identity's `/rotations/` directory and thereby learns whom it succeeds, and clients should pin and gossip the rotation declarations of identities with positive affinity alongside their identity documents (§5.1). See §8.3.

---

## 7. Voluntary Identity Linking

A user who maintains multiple neusnet identities may voluntarily declare them as linked by including identity link records in each identity's `linked_ids` array.

An identity link record is:

```json
{
  "linked_id": "<user identifier of the other identity>",
  "timestamp": <unix timestamp>,
  "signature": "<signature by the linking identity's key>"
}
```

The `signature` is made by the linking identity — the owner of the document the record appears in — over the JCS canonical form (identity.md §4.2) of `{ "linked_id", "timestamp" }`, so a record can be checked on its own as well as through its document's signature. An identity must not link to itself, and a document holds at most one record per linked identity.

For a link to be considered verified, **both identities must have declared the link** — identity A must include a link to B, and B must include a link to A, each signed by their respective keys. A unilateral declaration is shown as unverified.

Linking is entirely voluntary. The protocol has no mechanism to detect or reveal unlinked identities belonging to the same person.

### 7.1 Aggregation Preferences for Linked Identities

Whether linked identities are treated as a single node or as distinct nodes in the trust graph is governed by a two-layer preference system:

**Layer 1 — The identity owner's preference**: The `aggregate_linked` field in the identity document expresses the owner's preferred default. `true` means they prefer others to treat their linked identities as one node for affinity purposes; `false` (the default if absent) means they prefer them treated as distinct. This preference applies to the cluster as a whole — if any identity in a mutually-verified cluster sets `aggregate_linked: true`, clients should treat that as the owner's preference for the cluster. A cluster is the **connected component** of the mutual-link graph: if A and B mutually link, and B and C mutually link, all three form one cluster for this purpose even though A and C never declared each other directly — not a requirement that every pair in an N-member cluster separately link the other N−1.

**Layer 2 — The viewer's client setting**: Each user's client may override the owner's preference categorically:
- *Respect owner preference* (default): aggregate or separate per each owner's `aggregate_linked` value
- *Always aggregate verified links*: treat all mutually-verified linked identities as one node regardless of owner preference
- *Always treat separately*: treat all identities as distinct nodes regardless of owner preference

This design ensures identity owners have meaningful control over their default presentation while preserving each user's ultimate sovereignty over their own trust graph computation.

---

## 8. Open Questions

**8.1 Which identity document is authoritative for recovery keys?** A recovery rotation is authorized by the recovery keys registered for the old identity — but the identity document that registers them is itself signed by the primary key. A compromised primary key can therefore publish a new document naming recovery keys of the attacker's choosing and then "recover" the identity to itself; "the most recent identity document" is not a safe answer. One direction worth considering: a change to `recovery_keys` or `recovery_threshold` takes effect for *authorizing rotations* only after a grace period (for instance 14–30 days) from when clients first observe it, with the previous set remaining authoritative in the meantime — giving a legitimate owner time to notice and act with the original recovery keys. The reference implementation takes the authorized recovery set as an input to verification rather than choosing a policy.

**8.2 Competing rotations.** A compromised primary key can issue a standard rotation to a key of the attacker's choosing, and the legitimate owner can answer with a recovery rotation: two valid declarations for the same `old_id`, naming different successors. Timestamps cannot arbitrate — they are self-reported, and an attacker can backdate. One direction: a recovery-authorized rotation outranks a standard one (recovery exists for precisely this case), while competing declarations of the same kind stay contested until the user resolves them. §6.1 currently requires only that clients not pick silently; the reference implementation reports the fork (`contested`) and leaves the policy to the client.

**8.3 Finding a successor from the old identity alone.** Because a recovery rotation cannot be written under the old identity (§6.3), a client that tracks only the old identity and never encounters the new one has no direct way to learn of the rotation; it depends on propagation. Whether that is sufficient, or whether identity documents should carry a pointer to the identity they succeed (so that a client who meets the new identity can confirm and cross-check the claim), is open.

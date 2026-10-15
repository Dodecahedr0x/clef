# Clef — Solana Wallet Extension Design

Date: 2026-10-15
Status: Validated design, pre-implementation

## Goal

A full daily-driver Solana wallet as a browser extension whose differentiator is **understandable signing**: it parses program IDLs to name instructions and accounts, infers and *verifies* relationships between accounts (PDA seeds, `has_one`, token ownership), and presents them at a user-selected detail level (Basic / Intermediate / Expert). Inspired by [solana-graph-explorer](https://github.com/ChewingGlass/solana-graph-explorer).

## Decisions

| Topic | Decision |
|---|---|
| Scope | Full daily-driver wallet |
| Account types | BIP39 HD, imported private key, watch-only, Ledger, Keystone, Squads v4 multisig |
| IDL sources | User-supplied, curated bundled registry, Program Metadata Program, on-chain Anchor IDL (+ bundled native programs) |
| Detail levels | Basic / Intermediate / Expert (see below) |
| Browsers | Chromium first (MV3), Firefox later via WXT build target |
| Data | User-configurable RPC; DAS when available; Jupiter Price API; no own backend |
| v1 features | Connect/sign, balances, send/receive, Jupiter swaps, transaction history |
| Deferred | Native staking, NFT gallery / cNFT transfers, Firefox |
| UI stack | React + TypeScript + Tailwind/shadcn, `@solana/kit`, `@xyflow/react` |
| Engine | Codama as the common IDL format + relationship resolver + simulation |

## Detail levels

- **Basic** — one-line outcome ("Swap 1.5 SOL → ~212.4 USDC via Jupiter"), simulated balance changes, risk warnings.
- **Intermediate** — + per-instruction program/instruction name, formatted decoded args (decimals, named mints), accounts by IDL name + label + relation, verified badges (PDA re-derived, has_one checked).
- **Expert** — + raw account metas (signer/writable), ALT-resolved indexes, PDA seeds + bump, raw ix data, compute budget/priority fee/fee payer/blockhash, interactive account-relationship graph, IDL source & hash.

Levels are views over a single `ExplainedTransaction` model. Risk warnings are shown at every level.

## 1. Extension architecture

Tooling: WXT (MV3), React, TS, Tailwind/shadcn, `@solana/kit`, Codama.

| Context | Responsibility |
|---|---|
| Inpage script | Registers "Clef" via Wallet Standard (`solana:signTransaction`, `signAndSendTransaction`, `signMessage`, `signIn`). No secrets; forwards requests. |
| Content script | Relays page ↔ extension; stamps requests with the real tab origin. |
| Background SW | Request router, per-origin permission store, vault owner (lock state, auto-lock via `chrome.alarms`), opens approval windows. |
| Popup / full-tab UI | Portfolio, send, swap, history, settings. |
| Approval window | Runs the explain engine and signing UI; hosts WebHID for Ledger (unavailable in SW). |

Key handling: seed / imported keys encrypted with AES-GCM under an Argon2id (WASM) key derived from the password; ciphertext in `chrome.storage.local`. On unlock the derived key is held only in `chrome.storage.session` (in-memory, trusted contexts) so SW restarts don't force re-entry; auto-lock wipes it. Decrypted keys exist only transiently in the signing context and are zeroed after use.

Hardware: Ledger via WebHID + `@ledgerhq/hw-app-solana`. Keystone via QR (UR) by default — animated QR out, camera scan back in (approval opens as a full tab for camera permission); Keystone 3 USB optional.

Account model: `hd | imported | ledger | keystone | watch | squads`. A Squads account references the multisig plus a member account in the wallet that signs.

## 2. Explanation engine (`packages/explain`)

Pure TS package, no extension deps. Input: transaction → output: `ExplainedTransaction`.

1. **Decode transaction** — wire format (legacy/v0) via `@solana/kit`; fetch ALTs; full account list with signer/writable flags.
2. **Resolve IDLs** per program in priority order: user-supplied → curated (pinned by hash, ships labels + summary templates) → Program Metadata Program → on-chain Anchor IDL. Normalized to a Codama `RootNode`, cached in IndexedDB, tagged with trust tier (*curated*, *published by authority*, *user-provided*). On decode failure (discriminator / length mismatch) fall through to the next source.
3. **Identify instructions** — discriminator match, decode args, map account positions to IDL names (incl. optional and remaining accounts).
4. **Resolve relationships** into an `AccountGraph` (typed edges with provenance and verified flag):
   - PDA: re-derive from IDL seed definitions using decoded args and sibling accounts → ✓ or ⚠ mismatch.
   - has_one / relations: batch-fetch referenced accounts, decode with IDL account types, compare fields.
   - Token: decode Token / Token-2022 accounts → owner, mint; detect "your ATA"; name mints via metadata.
   - Identity: wallet accounts, address book, curated labels, known programs.
5. **Simulate** — `simulateTransaction` with post-state for writable accounts → SOL/token deltas for the user's accounts, owner/delegate/authority changes.
6. **Summarize** — curated per-(program, instruction) templates; generic fallback from balance deltas.

Expert graph renders `AccountGraph` with `@xyflow/react`.

## 3. Risk warnings & security model

Rules (severity `info | warn | danger`), shown at every level:

- Authority/owner change (`SetAuthority`, `Assign`, token owner change)
- Delegation (`Approve`, especially unlimited / unknown delegate)
- Unknown program (no IDL)
- PDA mismatch
- Relation (`has_one`) mismatch
- Unexpected outflow (simulation vs summary)
- Simulation failed (allow signing with confirmation)
- Durable nonce usage
- Close account with rent to a third party

`danger` requires an explicit acknowledgement checkbox before Sign is enabled.

IDL trust: IDL-provided names are always shown with their trust tier. **Ownership facts come from Clef's own checks** (signer, ATA derivation, decoded token owner), never from IDL names. Simulated deltas override IDL claims.

Hardening: strict CSP, no remote code, IDLs treated as data only; vault reachable only from extension pages; content script never sees secrets; origin binding from content script + phishing-list check; per-origin revocable connections; approval windows non-scriptable, fixed size/position; SIWS message decoding; warn when a signMessage payload looks like a serialized transaction.

## 4. Signing flows

```
dApp ─request─▶ inpage ─▶ content ─▶ background ─open─▶ approval window
                                                         │ explain(tx)
                                                         │ user approves
                                                         ▼
                                                  Signer.sign(tx)
```

| Type | Signing |
|---|---|
| hd / imported | Decrypt with session key, Ed25519 sign, zero key. |
| ledger | WebHID in approval window → device `signTransaction`; surface blind-signing requirement. |
| keystone | Animated UR QR → scan signature QR → verify signature against message + pubkey. |
| watch | Explain only; "Copy transaction" instead of Sign. |
| squads | Wrap into Squads v4 `vaultTransactionCreate` + `proposalCreate` (+ approve); explain inner tx and wrapper; sign with member account (may be hardware). Pending-proposals view to approve/execute. |

`signAndSendTransaction`: send via RPC with retry until confirmed or blockhash expiry. Store the explained snapshot locally for history.

Hardware: pubkey captured at pairing with derivation path (Ledger `44'/501'/n'` and `44'/501'/n'/0'`; Keystone via sync QR); re-verify pubkey before signing.

`signAllTransactions`: numbered list of per-tx summaries, each expandable, aggregate balance delta on top.

## 5. Portfolio, swaps, history, data

- **RPC (`packages/rpc`)** — user-configurable endpoint; DAS detection (`getAssetsByOwner`) with fallback to `getTokenAccountsByOwner` (Token + Token-2022); batching and request dedup shared by engine and UI.
- **Portfolio** — SOL + fungibles, Jupiter Price API for USD, metadata from DAS → Metaplex → Token-2022 metadata extension; spam filter (toggleable); refresh on open + `accountSubscribe` while open.
- **Send** — address book / owned-account autocomplete; warn when recipient is a token account or program; auto-create ATA; uses the same explain screen.
- **Swap** — Jupiter quote + swap transaction → explain screen (curated Jupiter IDL/template). Slippage setting, no fee in v1.
- **History** — `getSignaturesForAddress` → `getTransaction` → explain engine at current level; Clef-signed txs show "what you saw" snapshot vs on-chain outcome; IndexedDB cache, lazy paging.
- **Settings** — detail level (default Intermediate), RPC, auto-lock, connected sites, address book/labels, IDL manager.
- **Networks** — mainnet, devnet, custom RPC.

## 6. Repo layout, errors, testing

```
clef/
  apps/extension/        WXT app: entrypoints (background, content, inpage, popup, approval), React UI
  packages/explain/      decode → IDL resolve → relations → simulate → summary
  packages/idl/          IDL sources, Codama normalization, curated registry, cache interface
  packages/vault/        Argon2id + AES-GCM vault, HD derivation, session handling
  packages/signers/      Signer interface + hd/imported/ledger/keystone/squads
  packages/rpc/          RPC client, DAS detection, batching
  packages/ui/           shared components, detail-level views, account graph
```

**Error handling** — the engine degrades and never blocks: each stage returns partial results plus `issues[]` (missing IDL → raw ix + unknown-program warning; relation fetch failure → *unverified*; simulation failure → deltas hidden + warning). Hardware errors map to actionable messages (open Solana app, enable blind signing, device locked, wrong device).

**Testing**
- Engine: Vitest with offline fixtures (real mainnet txs + account snapshots + IDLs: Jupiter, Orca/Raydium, Squads, token approve, SetAuthority drainer); snapshot `ExplainedTransaction`.
- Relations/PDA: LiteSVM with a sample Anchor program; tampered accounts must produce mismatch warnings.
- Vault: round-trip, wrong password, KDF params.
- Signers: Ledger via `@ledgerhq/hw-transport-mocker`; Keystone UR round-trip.
- E2E: Playwright with unpacked extension + local test dApp on a Surfpool/LiteSVM RPC.

**Build order**
1. `explain` + `idl` (CLI: explain a signature)
2. vault + HD signer + Wallet Standard connect/sign
3. approval UI with three levels
4. Ledger
5. Keystone
6. portfolio / send
7. swap
8. history
9. Squads

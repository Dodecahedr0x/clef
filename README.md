# Clef

Clef is a Solana wallet for Chrome that explains a transaction before you sign it. It decodes the transaction (legacy, v0 with address lookup tables, and v1), names every instruction from IDLs it resolves through a prioritized chain (your own IDLs, curated bundled IDLs, Program Metadata, on-chain Anchor IDLs), independently verifies account relationships (PDA seeds, Anchor `has_one`, token ownership, ATAs), simulates it to compute balance and state changes, and runs risk rules over all of it. You choose how much you see: Basic, Intermediate or Expert (account-by-account state diffs, simulation logs, the relationship graph, raw data). Requests with several transactions are simulated in sequence when the RPC supports `simulateBundle`, and shown one by one or combined.

It is a full wallet: recovery phrase, imported and watch-only accounts, Squads v4 multisig, send, receive, Jupiter swaps, history, address book, phishing-list protection, and mainnet/devnet/local/custom networks. There is no Clef backend.

- Design: `docs/plans/2026-10-15-clef-wallet-design.md`; UI: `docs/design/canvas/` (one `.dc.html` per screen).
- Store release: `docs/store/` (listing, privacy policy, permissions, data usage, submission checklist).
- Manual hardware checklists: `docs/manual/`.

## Layout

| Path | What it is |
|---|---|
| `packages/rpc` (`@clef/rpc`) | `ChainReader`: the only way the engine touches the chain (`KitChainReader` live, `MemoryChainReader`, recording/replay readers), sequential simulation via `simulateBundle`, and `PortfolioReader` (balances, token accounts, DAS, signatures, confirmation). |
| `packages/idl` (`@clef/idl`) | IDL sources and the resolver chain, normalized to Codama `RootNode`s plus Anchor extras. Curated IDLs live in `packages/idl/idls`. |
| `packages/explain` (`@clef/explain`) | The engine: `explain()` / `explainBatch()` build an `ExplainedTransaction` / `ExplainedBatch`; `viewFor` / `viewForBatch` render them at `basic`, `intermediate` or `expert`. |
| `packages/vault` (`@clef/vault`) | Argon2id + AES-GCM vault, BIP39 mnemonics, SLIP-0010 derivation, session unlock. |
| `packages/signers` (`@clef/signers`) | Software signing, Ledger (Device Management Kit over WebHID), Keystone (UR QR codes), signature verification. |
| `packages/squads` (`@clef/squads`) | Squads v4 multisig client on `@solana/kit`. |
| `packages/market` (`@clef/market`) | Jupiter prices and swaps (API key optional). |
| `packages/portfolio` (`@clef/portfolio`) | Balances, token metadata, spam filter, history, send transactions. |
| `packages/wallet-core` (`@clef/wallet-core`) | Wallet service (dApp protocol, approvals, signing), internal API for extension pages, stores (accounts, settings, permissions, contacts, user IDLs, request log), phishing detector, opt-in error reporter. |
| `apps/extension` | The WXT Chrome MV3 extension: background service worker, Wallet Standard page script and relay, popup, approval window, hardware page. |
| `apps/cli` | The `clef` command. |
| `e2e` | Playwright tests against the built extension. |
| `test` | Vitest setup for the local validator (surfpool). |

Workspace packages export TypeScript source directly; there is no build step except for the extension.

## Develop

Requires Node 20+, pnpm 10, and [surfpool](https://solana.com/docs/tools/surfpool) 1.6 or later for local-validator tests.

```bash
pnpm install
pnpm typecheck
pnpm test          # offline unit tests
pnpm test:local    # starts a local surfpool validator, runs *.local.test.ts, stops it
pnpm test:live     # public-endpoint tests, skipped unless the env flags below are set (throttled)
pnpm e2e           # builds the extension and runs Playwright against it and a local validator
pnpm build:ext     # apps/extension/.output/chrome-mv3 (load unpacked in Chrome 137+)
pnpm zip:ext       # store-ready zip in apps/extension/.output/
pnpm screenshots:store   # 1280x800 store screenshots in docs/store/screenshots/ (local validator)
```

Environment variables:

| Variable | Used by | Meaning |
|---|---|---|
| `CLEF_RPC` | CLI | Default RPC endpoint (else public mainnet). |
| `CLEF_LIVE_RPC` | `pnpm test:live` | RPC URL for live chain tests, e.g. `https://api.mainnet-beta.solana.com`. |
| `CLEF_LIVE_JUPITER` | `pnpm test:live` | Set to `1` to run live Jupiter price/quote tests (keyless, rate-limited). |
| `CLEF_ERROR_ENDPOINT` | `pnpm build:ext` | Opt-in error report endpoint (plain JSON POST). Unset: the error-report toggle is hidden. |
| `CLEF_HARDWARE` | `pnpm build:ext` | `1` shows Ledger and Keystone. Unset (0.1.0 store build): hardware wallets are hidden until the device checklists in `docs/manual/` pass. |

## The `clef` CLI

```bash
pnpm clef explain <signature> [options]     # a landed transaction, explained from its meta
pnpm clef explain --tx <base64> [options]   # a wire transaction, explained by simulation
```

Options:

- `--level basic|intermediate|expert`: detail level (default `intermediate`). Each level shows strictly more than the one before.
- `--me <address>`: a wallet of yours; repeatable. Without it Clef assumes you are the fee payer and says so. For sponsored or gasless transactions the fee payer is not you: pass `--me`.
- `--label <address>=<name>`: name an address (your address book); repeatable. Labels never rename a program Clef knows.
- `--rpc <url>`: RPC endpoint. Default: `$CLEF_RPC`, else `https://api.mainnet-beta.solana.com`.
- `--record <file>`: also write every chain read to a replayable fixture.

Example:

```bash
pnpm clef explain <signature> --me <your wallet> --label <address>=Alice --level expert
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | explained, no danger |
| 1 | error (network, transaction not found, undecodable transaction, ...) |
| 2 | usage error |
| 3 | explained, and at least one DANGER warning |

Environment: `CLEF_RPC` sets the default RPC endpoint for the CLI; `CLEF_LIVE_RPC` enables the live tests.

## Recorded fixtures

`packages/explain/test/fixtures/mainnet/*.json` are real mainnet transactions with every chain read the CLI made. `packages/explain/test/mainnet.test.ts` replays them offline with exactly the CLI's context (`defaultExplainContext`, the recorded `me` and labels) and snapshots the expert view.

To re-record one (keep each file under 2 MB):

```bash
pnpm clef explain <signature> --level expert --me <user wallet> \
  --record packages/explain/test/fixtures/mainnet/<name>.json
pnpm vitest run packages/explain/test/mainnet.test.ts -u
```

The fixture stores the `me` actually used (the fee payer when `--me` is omitted). Read the updated snapshot by hand before committing it.

## Known limitations

- **No prices in the CLI.** The risk engine can weigh what comes back against what leaves only with USD prices, which the CLI does not supply. A swap through a program Clef cannot decode is therefore reported as DANGER ("funds leave your wallet in a transaction Clef cannot fully explain"), even when it is an ordinary trade.
- **Legacy stake account layout.** Wallets still pass the sysvars that the vendored stake IDL omits, so account names after the stake account are withheld (with a `parse` issue) for most real stake instructions; stake rules then run on conservative assumptions.
- **Old-client PumpSwap instructions.** Clients that omit trailing optional arguments (e.g. a 24-byte PumpSwap `buy`) don't decode against the current IDL. Clef names the instruction that matched ("buy matched but its data did not decode") but treats it as undecoded.
- **Lending-position SOL.** SOL withdrawn from your own position held in a program-owned account (e.g. a lending deposit) looks like a program paying you, so it can count as value coming back.
- **v1 limits.** The v1 size and count limits (4096 bytes, 64 accounts, 64 instructions, 12 signers) are hard-coded from SIMD-0385 in `packages/explain/src/decode.ts`. If SIMD-0596 changes the v1 account limits, those constants must follow, or valid v1 transactions will be rejected as malformed.
- Squads v4's on-chain IDL predates Anchor PDA seeds, so its PDAs are not verified.

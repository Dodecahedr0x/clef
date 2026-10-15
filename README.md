# Clef

Clef is a Solana wallet extension that explains a transaction before you sign it. It decodes the transaction (legacy, v0 with address lookup tables, and v1), names every instruction from IDLs it resolves through a prioritized chain (your own IDLs, curated bundled IDLs, Program Metadata, on-chain Anchor IDLs), independently verifies account relationships (PDA seeds, Anchor `has_one`, token ownership, ATAs), computes balance changes from the transaction meta or a simulation, and runs risk rules over all of it. Milestone 1 is the explain engine plus a `clef` CLI; the extension comes later.

## Layout

| Path | What it is |
|---|---|
| `packages/rpc` (`@clef/rpc`) | `ChainReader`: the only way the engine touches the chain. `KitChainReader` (live RPC), `MemoryChainReader` (tests), `RecordingChainReader` / `FixtureChainReader` (record and replay). |
| `packages/idl` (`@clef/idl`) | IDL sources and the resolver chain; everything is normalized to Codama `RootNode`s, plus Anchor extras Codama drops (`has_one`, nested seeds). Curated IDLs live in `packages/idl/idls`. |
| `packages/explain` (`@clef/explain`) | The engine: `explain()` builds one `ExplainedTransaction`; `viewFor(ex, level)` renders it at `basic`, `intermediate` or `expert`. |
| `apps/cli` | The `clef` command. |
| `docs/plans` | Design doc and the milestone 1 plan. |

Workspace packages export TypeScript source directly; there is no build step.

## Develop

```bash
pnpm install
pnpm test        # full suite, offline (live tests are skipped)
pnpm typecheck
```

Live RPC tests are skipped unless `CLEF_LIVE_RPC` is set:

```bash
CLEF_LIVE_RPC=https://api.mainnet-beta.solana.com pnpm vitest run packages/rpc/test/kit.live.test.ts
```

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

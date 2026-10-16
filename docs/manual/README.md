# Manual test checklists

Automated tests cover hardware wallets with mock transports and QR round-trips. These checklists cover what only a real device can confirm. Run them against the exact build you plan to ship (`pnpm build:ext`, then load `apps/extension/.output/chrome-mv3` unpacked in Chrome 137+).

| Checklist | Device |
|---|---|
| [ledger.md](ledger.md) | Ledger with the Solana app installed |
| [keystone.md](keystone.md) | Keystone 3 Pro (or any Keystone with Solana support) |

Record each run in the release notes: date, extension version, device model and firmware, app version, pass/fail per step.

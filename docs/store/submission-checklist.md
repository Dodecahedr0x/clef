# Chrome Web Store submission checklist

Before each submission:

1. Bump the version in `apps/extension/package.json` (WXT copies it into `manifest.json`; the store rejects a version that is not higher than the published one). The first release should be `1.0.0`, not `0.0.0`.
2. `pnpm typecheck && pnpm test && pnpm test:local && pnpm e2e` all green.
3. Build without an error endpoint unless one is ready: `CLEF_ERROR_ENDPOINT` unset hides the error-report toggle. If set, the endpoint must accept a plain JSON POST and be listed in the privacy policy.
4. `pnpm build:ext && pnpm zip:ext` → upload `apps/extension/.output/clef-<version>-chrome.zip`.
5. Check the built `manifest.json`: icons 16/48/128, `minimum_chrome_version: "137"`, permissions match `docs/store/permissions.md`, CSP `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`.
6. Run the manual hardware checklists (`docs/manual/ledger.md`, `docs/manual/keystone.md`) on real devices against the build you are uploading.
7. Store listing: copy from `docs/store/listing.md`; screenshots from `pnpm screenshots:store` (1280x800); 440x280 promo tile; 128x128 icon.
8. Privacy practices tab: single purpose and justifications from `docs/store/permissions.md`; data usage from `docs/store/data-usage.md`; privacy policy URL; "No remote code".
9. Distribution: public; all regions unless legal advice says otherwise for crypto wallets in a region.
10. After review, install the published item in a clean Chrome profile and repeat the e2e happy path by hand (create wallet, connect a dApp, sign, send).

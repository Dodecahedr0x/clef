# Permission justifications (Privacy practices tab)

Paste each justification into its field in the Chrome Web Store dashboard. Keep this file in sync with `apps/extension/wxt.config.ts` and the built `manifest.json`.

| Permission / key | Justification |
|---|---|
| `storage` | Stores the encrypted wallet, accounts, settings, connected sites, address book, user IDLs, the request log and the phishing list on the device. `storage.session` keeps the unlock key in memory only until the wallet locks. |
| `alarms` | Locks the wallet automatically after the user's chosen idle time and refreshes the public phishing list once a day. |
| `tabs` (only if present in the manifest) | Opens Clef's own full-tab page for connecting a Ledger (WebHID) or Keystone (camera) and focuses Clef's approval window. Clef does not read tab URLs or content. |
| Content scripts on `https://*/*`, `http://localhost/*`, `http://127.0.0.1/*` | Lets websites discover Clef through the Solana Wallet Standard and send it connection and signing requests. The script holds no secrets and only relays requests to the extension; every request is shown to the user for approval. Localhost is included for developers testing their own sites. |
| `content_security_policy` with `'wasm-unsafe-eval'` | Allows the bundled WebAssembly Argon2id implementation that derives the encryption key from the user's password. No remote code is loaded. |
| WebHID (used at runtime, no manifest permission) | Talks to the user's Ledger hardware wallet after the user selects it in Chrome's device chooser. |
| Camera (used at runtime, no manifest permission) | Scans the QR codes shown by the user's Keystone hardware wallet. Only requested on Clef's own page when the user starts a Keystone action; video never leaves the device. |
| `minimum_chrome_version: 137` | Clef signs with WebCrypto Ed25519, enabled by default from Chrome 137. |

## Remote code

"No, I am not using remote code." All JavaScript and WebAssembly ship in the package. The phishing list fetched from GitHub is JSON data, validated before use, and contains no logic.

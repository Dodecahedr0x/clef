# Data usage disclosures (Privacy practices tab)

## What user data do you plan to collect from users now or in the future?

Clef has no backend, so it does not collect data for the publisher. Tick only what Clef handles on the user's behalf and sends to services the user chooses:

| Category | Tick | Why |
|---|---|---|
| Personally identifiable information | No | |
| Health information | No | |
| Financial and payment information | Yes | Solana account addresses, balances and transactions are read from and sent to the user's chosen RPC to show the wallet and sign; Jupiter receives swap amounts and the user's public address. This is the extension's single purpose. |
| Authentication information | Yes | The wallet password is used locally to decrypt the vault; recovery phrases and private keys are stored encrypted on the device. None of it is transmitted. |
| Personal communications | No | |
| Location | No | |
| Web history | No | |
| User activity | No | |
| Website content | Yes | Requests from websites (transactions and messages to sign, the site's origin) are shown to the user; the site's hostname is included in opt-in error reports. |

## Certifications

- I do not sell or transfer user data to third parties, outside of the approved use cases. ✔
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose. ✔
- I do not use or transfer user data to determine creditworthiness or for lending purposes. ✔

## In-product disclosure

Financial data handling is disclosed in the product, not only in the privacy policy:

- Settings → Network & RPC: shows the RPC endpoint that receives your addresses and transactions.
- Settings → error reports toggle (when available): what a report contains, off by default.
- Swap screen: the route line names Jupiter as the source of quotes.

Verify these strings exist in the shipped UI before each submission (integration node 1.17 checks them).

Privacy policy URL: host `docs/store/privacy-policy.md` (for example as a GitHub Pages page or the repository file URL) and paste the URL in the dashboard.

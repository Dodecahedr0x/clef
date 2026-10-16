# Keystone manual checklist

Automated coverage: `pnpm vitest run packages/signers/test/keystone.test.ts`. That suite checks UR encoding and decoding against a synthesized `crypto-multi-accounts` payload and round-trips the signing requests. The steps below check the things only a real device can confirm: that the device accepts Clef's `sol-sign-request` QR codes, and that Clef reads the device's own sync and signature QR codes.

Prerequisites:
- Keystone 3 Pro on current firmware, with a test seed that holds a little SOL on mainnet. Use a dedicated test seed and never a real one.
- Clef built with `pnpm build:ext` and loaded unpacked in Chrome 137+.
- A webcam. Camera scanning runs in a full extension tab, not in the popup.
- Note the firmware version (Settings > About) for the run record.

For every step, write down pass/fail and anything unexpected.

## 1. Connect (sync)

1. In Clef, open Add account > Hardware wallet > Keystone. A full tab opens and asks for camera permission. Allow it.
2. On the Keystone, unlock it, then go to Connect Software Wallet and pick a Solana-capable wallet entry (for example "Solflare" or "Backpack"). It shows an animated QR code.
3. Hold the device to the camera.
   - Expected: the progress indicator rises to 100%, then an account list appears.
   - Expected: the device name ("Keystone 3 Pro") and the master fingerprint (8 hex characters) are shown.
4. Show a QR code that does not come from the Keystone, for example a URL.
   - Expected: a clear "not from a Keystone" error, and scanning continues.

## 2. Add accounts (both path styles)

1. In the sync list, find the accounts on `44'/501'/0'` (legacy/Ledger Live style) and `44'/501'/0'/0'` (standard/Phantom style). If the device only exports one style, use its path-type setting (in the Solana connect screen) to export the other style, and sync again.
2. Add one account of each style.
   - Expected: on the device, each address matches what Clef shows (Keystone > Solana > account details).
   - Expected: both appear in Clef's account list, marked as Keystone, and the derivation path appears in the account details.
3. Remove one account and add it again.
   - Expected: it comes back with the same address and no duplicate entry.

## 3. Sign a SOL transfer

1. From the Keystone account, send 0.001 SOL to another account you own.
2. Clef shows the explanation, then an animated `UR:SOL-SIGN-REQUEST` QR code.
3. Scan it with the Keystone.
   - Expected: the device shows a transfer of 0.001 SOL with the correct recipient and fee payer.
4. Approve on the device. It shows a `sol-signature` QR code. Scan it with Clef's camera view.
   - Expected: Clef accepts the signature, submits the transaction, and it confirms on an explorer.
   - Expected: the signature verifies. A signature that does not verify is rejected with "wrong address", and nothing is submitted.

## 4. Sign a swap (blind signing)

1. In Clef's Swap screen, swap a small amount of SOL to USDC through Jupiter. This produces a v0 transaction with address lookup tables.
2. Scan the request with the Keystone.
   - Expected: if the device cannot fully decode the transaction, it warns before signing (for example "Unknown transaction" or a raw-data view). Record what it shows.
3. Approve, scan the signature back, and confirm the swap lands on-chain.

## 5. Sign a message

1. On a test dApp, connect the Keystone account and request `signMessage` for "Hello from Clef".
2. Scan the request.
   - Expected: the device shows the message text, and the signing type is message, not transaction.
3. Approve and scan the signature back.
   - Expected: the dApp receives a 64-byte signature that verifies against the account address.

## 6. Reject on the device

1. Start any signature (a transfer or a message), scan the request, then press Reject on the Keystone.
   - Expected: no signature QR code appears on the device. In Clef, cancelling the scan view returns "rejected" to the dApp (or to the popup), and nothing is submitted.

## 7. Abort mid-sign and stale signatures

1. Start a transfer. While the request QR code is animating, close the Clef tab.
   - Expected: the pending request is rejected. Reopening Clef shows no stuck approval.
2. Start transfer A and scan its request with the device, but do not scan the signature back. Cancel in Clef. Start transfer B and show the device's signature QR code for A to Clef.
   - Expected: Clef refuses it with "This signature belongs to a different request". B stays unsigned.
3. Cover the camera halfway through an animated signature scan.
   - Expected: the progress pauses and resumes when the camera is uncovered. No error.

## Record

Date, Clef version, Keystone model and firmware, and pass/fail per step (1-7) with notes.

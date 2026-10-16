# Ledger manual checklist

Automated coverage: `pnpm vitest run packages/signers/test/ledger.test.ts`. That suite drives `LedgerDevice` against a mocked Device Management Kit signer and checks address paths, signature lengths, off-chain envelope stripping, and status-word mapping. The steps below check what only a real device can confirm: WebHID pairing, the real status words, and the on-device screens.

Prerequisites:
- A Ledger (Nano S Plus, Nano X, Flex or Stax) on current firmware, with the Solana app installed from Ledger Live. Use a dedicated test seed that holds a little SOL on mainnet. Never use a real one.
- Ledger Live closed. It holds the USB interface and blocks WebHID.
- Clef built with `pnpm build:ext` and loaded unpacked in Chrome 137+.
- Note the device model, firmware version and Solana app version (Solana app > About) for the run record.

For every step, write down pass/fail and anything unexpected.

## 1. Connect

1. Plug in the Ledger and unlock it, but leave it on the dashboard (Solana app not open).
2. In Clef, open Add account > Hardware wallet > Ledger. A full tab opens. Click Connect.
   - Expected: Chrome's HID chooser lists the Ledger. Select it.
   - Expected: Clef asks you to open the Solana app, or the device prompts to open it. Open it.
3. Repeat, but click Cancel in the chooser.
   - Expected: "No device selected". No crash, and Connect still works afterwards.
4. Repeat with the device locked (PIN screen).
   - Expected: a "Ledger is locked" message. Unlock it and retry. It succeeds.
5. Close the tab and reopen the Ledger page with the device still plugged in.
   - Expected: it reconnects without showing the chooser again.

## 2. Add accounts (both path styles)

1. In the account list, add account index 0 with the legacy path `44'/501'/0'` (Ledger Live style).
2. Add account index 0 with the standard path `44'/501'/0'/0'` (Phantom/Solflare style).
   - Expected: the two addresses differ.
   - Expected: the legacy address matches Ledger Live's Solana account 1. The standard address matches the same seed in Phantom.
3. Use "Verify on device" for each account.
   - Expected: the device shows the same address as Clef. Approve it.
   - Expected: if you reject on the device, Clef shows "Rejected on device" and does not add the account.
4. Check the account list.
   - Expected: both accounts are marked as Ledger and show their derivation path in the account details.

## 3. Sign a SOL transfer

1. From the legacy-path Ledger account, send 0.001 SOL to another account you own.
2. Clef shows the explanation, then a "Confirm on your Ledger" step.
   - Expected: the device shows a transfer of 0.001 SOL with the correct recipient (clear-signed, not blind).
3. Approve on the device.
   - Expected: Clef verifies the signature against the account address, submits the transaction, and it confirms on an explorer.
4. Repeat from the standard-path account.

## 4. Sign a swap that needs blind signing

1. In the Solana app settings on the device, turn "Blind signing" OFF.
2. In Clef, swap a small amount (for example 0.001 SOL to USDC) from a Ledger account.
   - Expected: the device refuses, and Clef shows "Enable blind signing in the Solana app settings" (code `blind-signing-required`, status word 0x6808). Nothing is submitted.
3. On the device, turn "Blind signing" ON and retry the same swap.
   - Expected: the device shows a blind-signing warning and a message hash. Approve it.
   - Expected: the swap confirms on an explorer.
4. Turn blind signing back OFF when done.

## 5. Sign a message

1. Open a test dApp (for example the e2e dApp from `pnpm e2e`, or any site with Sign Message) and connect a Ledger account.
2. Request a signature on a short UTF-8 message, for example "hello from clef".
   - Expected: the device shows the message text, or its hash for long or non-ASCII text.
3. Approve on the device.
   - Expected: Clef returns a 64-byte signature to the dApp.
   - Note: the Solana app signs an off-chain message (header plus text), not the raw bytes. Record whether the dApp's verification passes. Some dApps verify against the raw bytes and will fail.

## 6. Reject on device

1. Start a SOL transfer (step 3) and reject it on the device.
   - Expected: "Rejected on device" (code `rejected`, status word 0x6985). Nothing is submitted. Clef stays usable.
2. Start a message signature (step 5) and reject it on the device.
   - Expected: the same rejection message, and the dApp receives a user-rejected error.

## 7. Disconnect mid-sign

1. Start a SOL transfer. When the device shows the review screens, unplug the USB cable.
   - Expected: Clef shows "Ledger disconnected" (code `disconnected`) within a few seconds. It does not hang. Nothing is submitted.
2. Plug the device back in, unlock it, and open the Solana app. Retry the same transfer.
   - Expected: Clef reconnects (via the chooser, or automatically if already granted) and the signature succeeds.
3. Start a transfer, then exit the Solana app on the device (back to the dashboard) before approving.
   - Expected: Clef shows "Open the Solana app" (code `app-not-open`) or "disconnected". It never shows a generic crash.

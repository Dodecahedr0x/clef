# Clef privacy policy

Last updated: 2026-10-16
Publisher: Dodecahedr0x · Contact: hexadecifish@gmail.com

Clef is a browser extension wallet for the Solana blockchain. Clef has no servers of its own and runs no analytics. This policy explains what data Clef handles and where it goes.

## Data stored on your device

Clef stores the following in your browser's extension storage, on your device only:

- Your recovery phrases and imported private keys, encrypted with a key derived from your password (Argon2id, AES-256-GCM). Clef never stores your password.
- Your accounts' public addresses and names, hardware wallet derivation paths, and Squads multisig addresses.
- Your settings (network, RPC address, detail level, optional Jupiter API key, auto-lock time).
- The sites you connected and which accounts they may see.
- Your address book, program IDLs you added, and a local log of the requests you approved, rejected or Clef blocked.
- A copy of the public phishing domain list.

Removing the extension deletes all of it. Clef cannot recover your wallet without your recovery phrase.

## Data sent over the network

Clef only contacts these services, and only for the purposes listed:

| Service | What is sent | Why |
|---|---|---|
| The Solana RPC endpoint you choose (default: `api.mainnet-beta.solana.com`) | Your public addresses, transactions you are asked to sign (to simulate them), signed transactions you approve | Read balances and history, simulate and send transactions |
| Jupiter (`api.jup.ag`) | Token mint addresses; for swaps, the amounts and your public address; your Jupiter API key if you set one | Token prices and swap routes |
| The Solana programs' on-chain accounts (through your RPC) | Program addresses | Load program IDLs to explain transactions |
| GitHub (`raw.githubusercontent.com`) | Nothing about you; a plain download | Refresh the public phishing domain list once a day |
| Error-report endpoint (only if you turn on error reports, and only in builds that configure one) | Error type, message and stack trace with addresses, signatures, long numbers and URLs removed; Clef and browser versions; which part of Clef it came from; the hostname of the site that made the request | Fix bugs |

Error reports are off by default. They never include recovery phrases, private keys, passwords, balances, account addresses or transactions.

The sites you connect to receive only what you approve: the addresses of the accounts you chose to share and the signatures you approve.

## What Clef does not do

- No analytics, tracking, advertising or sale of data.
- No access to your browsing history; Clef's page script only lets sites ask to connect to the wallet.
- No remote code: everything Clef runs ships inside the extension.

## Changes

Changes to this policy are published with new versions of the extension and in this document.

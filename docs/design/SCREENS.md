# Canvas screens -> implementation

Every board of the Clef Wallet UI canvas (`docs/design/canvas/`, layout in `canvas.json`) and the file that implements it. Not in the canvas but built from the same components: `popup/screens/Security.tsx` (reveal phrase, change password) and `kitchen-sink/` (component gallery, dev only).

| Board | Title | Implemented in |
|---|---|---|
| `Main.dc.html` | Popup · Portfolio | `apps/extension/entrypoints/popup/screens/Portfolio.tsx` |
| `Unlock.dc.html` | Popup · Unlock | `apps/extension/entrypoints/popup/screens/Unlock.tsx` (also inside the approval window when locked) |
| `MainExpert.dc.html` | Popup · Portfolio (Expert) | `apps/extension/entrypoints/popup/screens/Portfolio.tsx` (Expert variant when settings.detailLevel = expert) |
| `TokenDetail.dc.html` | Popup · Token detail | `apps/extension/entrypoints/popup/screens/TokenDetail.tsx` |
| `Send.dc.html` | Popup · Send | `apps/extension/entrypoints/popup/screens/Send.tsx` |
| `Receive.dc.html` | Popup · Receive | `apps/extension/entrypoints/popup/screens/Receive.tsx` |
| `Swap.dc.html` | Popup · Swap | `apps/extension/entrypoints/popup/screens/Swap.tsx` |
| `History.dc.html` | Popup · History | `apps/extension/entrypoints/popup/screens/History.tsx` |
| `Settings.dc.html` | Popup · Settings | `apps/extension/entrypoints/popup/screens/Settings.tsx` |
| `ApproveBasic.dc.html` | Approve · Basic | `apps/extension/entrypoints/approval/tx/TxApproval.tsx` + tx/BasicBody.tsx |
| `ApproveIntermediate.dc.html` | Approve · Intermediate | `apps/extension/entrypoints/approval/tx/TxApproval.tsx` + tx/IntermediateBody.tsx |
| `ApproveExpert.dc.html` | Approve · Expert · 3 transactions | `apps/extension/entrypoints/approval/tx/TxApproval.tsx` + tx/ExpertBody.tsx (StateChanges, RelationsGraph, ExpertInstructions, SimulationLogs) |
| `ExpertFull.dc.html` | Approve · Expert · Whole page, all 3 combined | `apps/extension/entrypoints/approval/tx/ExpertBody.tsx` (same page, unscrolled) |
| `ApproveDanger.dc.html` | Approve · Danger warning | `apps/extension/entrypoints/approval/tx/TxApproval.tsx` (danger banner + acknowledgement) and approval/requests/BlockedSiteBanner.tsx |
| `Connect.dc.html` | Request · Connect | `apps/extension/entrypoints/approval/requests/ConnectApproval.tsx` |
| `SignMessage.dc.html` | Request · Sign message | `apps/extension/entrypoints/approval/requests/MessageApproval.tsx` |
| `SignIn.dc.html` | Request · Sign in with Solana | `apps/extension/entrypoints/approval/requests/SignInApproval.tsx` |
| `SignAll.dc.html` | Request · Sign all transactions | `apps/extension/entrypoints/approval/tx/TxApproval.tsx` (batch: combined at Basic, All / 1 / 2 ... tabs at Intermediate and Expert) |
| `LedgerSign.dc.html` | Sign · Ledger | `apps/extension/entrypoints/approval/requests/HardwareSignStep.tsx` (Ledger) |
| `KeystoneSign.dc.html` | Sign · Keystone QR | `apps/extension/entrypoints/approval/requests/HardwareSignStep.tsx` (Keystone) |
| `SquadsPropose.dc.html` | Sign · Squads proposal | `apps/extension/entrypoints/approval/requests/SquadsApproval.tsx` |
| `Proposals.dc.html` | Popup · Squads proposals | `apps/extension/entrypoints/popup/screens/Proposals.tsx` |
| `Welcome.dc.html` | Onboard · Welcome | `apps/extension/entrypoints/popup/screens/Welcome.tsx` |
| `CreatePassword.dc.html` | Onboard · Password | `apps/extension/entrypoints/popup/screens/CreatePassword.tsx` |
| `RecoveryPhrase.dc.html` | Onboard · Recovery phrase | `apps/extension/entrypoints/popup/screens/RecoveryPhrase.tsx` |
| `ConfirmPhrase.dc.html` | Onboard · Confirm phrase | `apps/extension/entrypoints/popup/screens/ConfirmPhrase.tsx` |
| `Import.dc.html` | Onboard · Import | `apps/extension/entrypoints/popup/screens/Import.tsx` |
| `Accounts.dc.html` | Accounts · Switcher | `apps/extension/entrypoints/popup/screens/Accounts.tsx` |
| `AddAccount.dc.html` | Accounts · Add | `apps/extension/entrypoints/popup/screens/AddAccount.tsx` |
| `LedgerConnect.dc.html` | Accounts · Connect Ledger | `apps/extension/entrypoints/hardware/` (full tab, ?kind=ledger) |
| `KeystoneConnect.dc.html` | Accounts · Connect Keystone | `apps/extension/entrypoints/hardware/` (full tab, ?kind=keystone) |
| `SquadsAdd.dc.html` | Accounts · Add Squads multisig | `apps/extension/entrypoints/popup/screens/SquadsAdd.tsx` |
| `ConnectedSites.dc.html` | Settings · Connected sites | `apps/extension/entrypoints/popup/screens/ConnectedSites.tsx` |
| `IdlManager.dc.html` | Settings · Program IDLs | `apps/extension/entrypoints/popup/screens/IdlManager.tsx` |
| `AddressBook.dc.html` | Settings · Address book | `apps/extension/entrypoints/popup/screens/AddressBook.tsx` |
| `NetworkRpc.dc.html` | Settings · Network & RPC | `apps/extension/entrypoints/popup/screens/NetworkRpc.tsx` |

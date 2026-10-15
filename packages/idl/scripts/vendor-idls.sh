#!/usr/bin/env bash
# Vendors official Codama IDLs for native programs. Re-run to update; commit the result.
set -euo pipefail
cd "$(dirname "$0")/../idls"
for repo in system token token-2022 associated-token-account compute-budget memo; do
  curl -fsSL "https://raw.githubusercontent.com/solana-program/$repo/main/idl.json" -o "$repo.json"
  echo "$repo -> $(node -e "const r=require('./$repo.json'); console.log(r.kind, r.program.name, r.program.publicKey)")"
done

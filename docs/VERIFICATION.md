# Verification Card — don't trust the README, verify everything yourself

Every claim this project makes about on-chain state has a public, credential-free
way to check it. Nothing below requires trusting this repository's code.

## On-chain facts (BSC Testnet, chainId 97)

Open these in any browser:

| Claim | Public proof |
| --- | --- |
| EvidenceRegistry contract deployed | <https://testnet.bscscan.com/address/0xD4F14929A1694932439DDa1D481aA127f80185D7> |
| Evidence EV-000012 anchored | <https://testnet.bscscan.com/tx/0xd31f15ca25b5cdf24afa6764d8b9ef00546d4050c4714501a9d1376b4075d668> |
| VERI token v2 (zero-premine, bitcoin-style emission) | <https://testnet.bscscan.com/token/0xDDcbC86dE41bB8863a4Acd929E965d0E07A54C76> |
| VERI v2 reward mint (100 to validator, supply 0→100) | <https://testnet.bscscan.com/tx/0x9a350a40484ecae61945b730c4df2668e5399026d0538c5368ba8579dcf5051f> |
| ERC-8004 agent identity #2006 minted | <https://testnet.bscscan.com/tx/0x5261cbd0844cfebc02b2b8d398e69555b0393fb047951430f5a0c576f68f5738> |
| Reputation feedback (value 95) written by an independent wallet | <https://testnet.bscscan.com/tx/0x8e2034be4cb94ca7226f291749e176e2714e13de121f49ad4f15a5b9b8277ba1> |

## Decentralized storage (BNB Greenfield testnet)

The full evidence package is publicly retrievable, no credentials:

<https://gnfd-testnet-sp1.bnbchain.org/view/free-web-mcp-evidence2/8a137c429eaae063fe0db8170d681221040c0aa3cc417e84ee3a0d3e8973e579.json>

Its filename is its own SHA-256 — download it, hash it, compare with the
on-chain `evidenceHash` above.

## DIY chain reads (no tools from this repo needed)

Using any EVM client against `https://data-seed-prebsc-1-s1.binance.org:8545`:

```bash
# chain id must be 97
cast chain-id --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545

# the anchored evidence hash exists on the registry
cast call 0xD4F14929A1694932439DDa1D481aA127f80185D7   "exists(bytes32)(bool)"   0x8a137c429eaae063fe0db8170d681221040c0aa3cc417e84ee3a0d3e8973e579   --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545   # -> true

# agent identity #2006 is owned by the project wallet
cast call 0x8004A818BFB912233c491871b3d84c89A494BD9e   "ownerOf(uint256)(address)" 2006   --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545

# reputation summary (1 feedback, value 95)
cast call 0x8004B663056A597Dffe9eCcC1965A193B7388713   "getSummary(uint256,address[],string,string)(uint64,int128,uint8)"   2006 "[0xDD8B4e6A716c2E643139EC003B289b07a0d0c3D3]" "" ""   --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545   # -> 1, 95, 0
```

(Registry addresses `0x8004A…` / `0x8004B…` are the official ERC-8004
singletons deployed identically across 50 chains — see
<https://github.com/erc-8004/erc-8004-contracts>. They are not ours.)

## In your own MetaMask

- Import token `0x4FF843Db5196B3Ca7438ABe6E3d6FC16d94350Da` → you will see the
  VERI balance of the wallet you used.
- NFTs tab → ERC-8004 agent identity #2006.

## CI

<https://github.com/chenxuyaun/free_web_mcp/actions> — every push runs
Python (ruff/mypy/pytest), Node (typecheck/vitest/build) and Playwright e2e.

## Honest limitations

- The reputation feedback was written by **our own second test wallet** — it
  demonstrates the mechanism, not organic third-party reputation.
- VERI is a testnet token with **zero real-world value**.
- Evidence claims in the demo dataset are self-authored for demonstration;
  the system verifies *provenance and process*, not the truth of the claim.
- **Greenfield testnet data is not permanent**: BNB Chain purges testnet
  buckets older than 3 months (+7 days grace, policy since 2023-12). The
  published evidence URLs will lapse ~2026-12; the full Evidence Packages
  remain safe in the SQLite `payload_json` column (daily backups on the
  server since 2026-08-29). Long-term public proof requires Greenfield
  mainnet — cost is negligible at this scale (~$0.03/GB/month; the whole
  evidence set is <1 MB), so migration is a decision, not a cost barrier.

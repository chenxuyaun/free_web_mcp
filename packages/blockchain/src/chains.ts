/** BSC Testnet + Anvil chain configs (spec §17). */
import { defineChain, http } from "viem";

// The legacy data-seed-prebsc-*.binance.org endpoints are frequently dead or
// unreachable from cloud servers; publicnode/drpc are reliable alternatives.
export const BSC_TESTNET_RPCS = [
  "https://bsc-testnet-rpc.publicnode.com",
  "https://bsc-testnet.bnbchain.org",
  "https://bsc-testnet.drpc.org",
];

export const bscTestnet = defineChain({
  id: 97,
  name: "BSC Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: {
    default: {
      http: BSC_TESTNET_RPCS,
    },
    public: {
      http: BSC_TESTNET_RPCS,
    },
  },
  blockExplorers: {
    default: { name: "BscScan Testnet", url: "https://testnet.bscscan.com" },
  },
  testnet: true,
});

/** Anvil default: chainId 31337, http://127.0.0.1:8545, account 0..9 funded. */
export const anvil = defineChain({
  id: 31337,
  name: "Anvil Local",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
    public: { http: ["http://127.0.0.1:8545"] },
  },
  testnet: true,
});

/** Short-timeout, no-retry HTTP transport so a dead RPC can never stall the
 *  dashboard: every viem call fails within RPC_TIMEOUT_MS instead of retrying
 *  for ~40s with viem defaults (10s timeout × 3 retries + backoff). */
export const RPC_TIMEOUT_MS = 5_000;

export function rpcHttp(url: string) {
  return http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 0 });
}

export const ANVIL_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil account #0 (test only)

export const EVIDENCE_REGISTRY_ABI = [
  {
    inputs: [
      { internalType: "bytes32", name: "evidenceHash_", type: "bytes32" },
      { internalType: "string", name: "uri", type: "string" },
      { internalType: "string", name: "version", type: "string" },
    ],
    name: "registerEvidence",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "evidenceHash_", type: "bytes32" }],
    name: "getEvidence",
    outputs: [
      {
        components: [
          { internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
          { internalType: "string", name: "uri", type: "string" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "address", name: "submitter", type: "address" },
          { internalType: "string", name: "version", type: "string" },
          { internalType: "bool", name: "exists", type: "bool" },
        ],
        internalType: "struct EvidenceRegistry.EvidenceRecord",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "evidenceHash_", type: "bytes32" }],
    name: "exists",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
      { indexed: false, internalType: "string", name: "uri", type: "string" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
      { indexed: true, internalType: "address", name: "submitter", type: "address" },
      { indexed: false, internalType: "string", name: "version", type: "string" },
    ],
    name: "EvidenceRegistered",
    type: "event",
  },
  {
    inputs: [
      { internalType: "bytes32", name: "claimHash_", type: "bytes32" },
      { internalType: "bool", name: "result", type: "bool" },
      { internalType: "string", name: "method", type: "string" },
      { internalType: "bytes32", name: "resolutionRoot_", type: "bytes32" },
    ],
    name: "resolveClaim",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "claimHash_", type: "bytes32" }],
    name: "isResolved",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "bytes32", name: "claimHash_", type: "bytes32" }],
    name: "getResolution",
    outputs: [
      {
        components: [
          { internalType: "bytes32", name: "claimHash", type: "bytes32" },
          { internalType: "bool", name: "result", type: "bool" },
          { internalType: "string", name: "method", type: "string" },
          { internalType: "bytes32", name: "resolutionRoot", type: "bytes32" },
          { internalType: "uint256", name: "timestamp", type: "uint256" },
          { internalType: "address", name: "resolver", type: "address" },
          { internalType: "bool", name: "exists", type: "bool" },
        ],
        internalType: "struct EvidenceRegistry.ClaimResolutionRecord",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** Standalone typed event descriptor for getLogs queries. */
export const EVIDENCE_REGISTERED_EVENT = {
  anonymous: false,
  inputs: [
    { indexed: true, internalType: "bytes32", name: "evidenceHash", type: "bytes32" },
    { indexed: false, internalType: "string", name: "uri", type: "string" },
    { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" },
    { indexed: true, internalType: "address", name: "submitter", type: "address" },
    { indexed: false, internalType: "string", name: "version", type: "string" },
  ],
  name: "EvidenceRegistered",
  type: "event",
} as const;

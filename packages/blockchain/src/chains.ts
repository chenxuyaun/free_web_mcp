/** BSC Testnet + Anvil chain configs (spec §17). */
import { defineChain } from "viem";

export const bscTestnet = defineChain({
  id: 97,
  name: "BSC Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://data-seed-prebsc-1-s1.binance.org:8545"],
    },
    public: {
      http: ["https://data-seed-prebsc-1-s1.binance.org:8545"],
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

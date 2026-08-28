export {
  bscTestnet,
  anvil,
  EVIDENCE_REGISTRY_ABI,
  EVIDENCE_REGISTERED_EVENT,
  ANVIL_PRIVATE_KEY,
} from "./chains";
export { EvidenceRegistryClient } from "./registry";
export {
  AgentIdentityClient,
  ERC8004_IDENTITY_ADDRESS_TESTNET,
  ERC8004_REPUTATION_ADDRESS_TESTNET,
  ERC8004_IDENTITY_ABI,
} from "./agent";
export type { AgentIdentityConfig, RegisterResult } from "./agent";
export type { AnchorResult, RegistryClientOptions, AnchoredRecord, ListRecordsOptions } from "./registry";

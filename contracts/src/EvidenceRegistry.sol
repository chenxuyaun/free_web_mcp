// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EvidenceRegistry
/// @notice On-chain fingerprint registry for verified web evidence, plus the
///         claim resolution anchor (V1 protocol — teacher's framework).
///
///         The chain is NOT a truth machine and NOT a storage layer. It is
///         the final public state machine of the discovery/verification/
///         dispute/settlement system. It records, for anyone to read,
///         re-execute and recompute:
///           - which evidence was observed (hash + uri + timestamp)
///           - which claim resolutions were produced (result + method + root)
///
///         Full evidence packages live in content-addressed storage; the
///         resolutionRoot is a Merkle root over (attestations + challenge +
///         outcome) so the settlement can be independently recomputed
///         off-chain and verified against the anchor.
contract EvidenceRegistry {
    struct EvidenceRecord {
        bytes32 evidenceHash;
        string uri;
        uint256 timestamp;
        address submitter;
        string version;
        bool exists;
    }

    struct ClaimResolutionRecord {
        bytes32 claimHash; // evidence hash of the claim
        bool result; // final truth outcome
        string method; // OPTIMISTIC_FINALIZE | CONSENSUS_VOTE | ...
        bytes32 resolutionRoot; // merkle root over attestations+challenge+outcome
        uint256 timestamp;
        address resolver;
        bool exists;
    }

    mapping(bytes32 => EvidenceRecord) private _records;
    mapping(bytes32 => ClaimResolutionRecord) private _resolutions;

    event EvidenceRegistered(
        bytes32 indexed evidenceHash,
        string uri,
        uint256 timestamp,
        address indexed submitter,
        string version
    );

    event ClaimResolved(
        bytes32 indexed claimHash,
        bool result,
        string method,
        bytes32 resolutionRoot,
        uint256 timestamp,
        address indexed resolver
    );

    /// @notice Register a new evidence fingerprint. Reverts if the hash
    ///         was already registered (spec §16: prevent duplicates).
    function registerEvidence(
        bytes32 evidenceHash_,
        string calldata uri,
        string calldata version
    ) external {
        require(evidenceHash_ != bytes32(0), "EvidenceRegistry: empty hash");
        require(!_records[evidenceHash_].exists, "EvidenceRegistry: already registered");

        _records[evidenceHash_] = EvidenceRecord({
            evidenceHash: evidenceHash_,
            uri: uri,
            timestamp: block.timestamp,
            submitter: msg.sender,
            version: version,
            exists: true
        });

        emit EvidenceRegistered(evidenceHash_, uri, block.timestamp, msg.sender, version);
    }

    /// @notice Anchor the final resolution of a claim (V1 protocol).
    ///         One transaction per finalized claim: records the binary
    ///         outcome, the resolution method, and the resolution root.
    function resolveClaim(
        bytes32 claimHash_,
        bool result,
        string calldata method,
        bytes32 resolutionRoot_
    ) external {
        require(claimHash_ != bytes32(0), "EvidenceRegistry: empty claim hash");
        require(!_resolutions[claimHash_].exists, "EvidenceRegistry: already resolved");
        require(bytes(method).length > 0, "EvidenceRegistry: empty method");

        _resolutions[claimHash_] = ClaimResolutionRecord({
            claimHash: claimHash_,
            result: result,
            method: method,
            resolutionRoot: resolutionRoot_,
            timestamp: block.timestamp,
            resolver: msg.sender,
            exists: true
        });

        emit ClaimResolved(claimHash_, result, method, resolutionRoot_, block.timestamp, msg.sender);
    }

    /// @notice Look up an evidence record.
    function getEvidence(bytes32 evidenceHash_) external view returns (EvidenceRecord memory) {
        return _records[evidenceHash_];
    }

    /// @notice Look up a claim resolution.
    function getResolution(bytes32 claimHash_) external view returns (ClaimResolutionRecord memory) {
        return _resolutions[claimHash_];
    }

    /// @notice True if the evidence hash is already on-chain.
    function exists(bytes32 evidenceHash_) external view returns (bool) {
        return _records[evidenceHash_].exists;
    }

    /// @notice True if the claim has been finally resolved.
    function isResolved(bytes32 claimHash_) external view returns (bool) {
        return _resolutions[claimHash_].exists;
    }
}

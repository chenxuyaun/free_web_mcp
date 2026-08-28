// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EvidenceRegistry
/// @notice On-chain fingerprint registry for verified web evidence.
///         Only the SHA-256 hash + URI + version are stored on-chain —
///         never the full content (spec §27).
contract EvidenceRegistry {
    struct EvidenceRecord {
        bytes32 evidenceHash;
        string uri;
        uint256 timestamp;
        address submitter;
        string version;
        bool exists;
    }

    mapping(bytes32 => EvidenceRecord) private _records;

    event EvidenceRegistered(
        bytes32 indexed evidenceHash,
        string uri,
        uint256 timestamp,
        address indexed submitter,
        string version
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

    /// @notice Look up an evidence record.
    function getEvidence(bytes32 evidenceHash_) external view returns (EvidenceRecord memory) {
        return _records[evidenceHash_];
    }

    /// @notice True if the hash is already on-chain.
    function exists(bytes32 evidenceHash_) external view returns (bool) {
        return _records[evidenceHash_].exists;
    }
}

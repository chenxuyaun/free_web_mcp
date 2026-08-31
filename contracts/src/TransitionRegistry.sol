// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TransitionRegistry
/// @notice EIP-712 signed claim state-transition log (project 3).
///
///         The EvidenceRegistry anchors only the final resolution; this
///         contract records the intermediate lifecycle steps
///         (OBSERVED → SUPPORTED → CHALLENGED → DISPUTED → RESOLVED/EXPIRED)
///         as cheap, replay-safe, signature-verifiable events.
///
///         Design:
///           - The server signs each transition with EIP-712 typed data;
///             anyone can relay the signed message on-chain (the signer,
///             not the tx sender, is verified via ecrecover).
///           - Per-claim monotonically increasing nonce prevents replay.
///           - No storage of full payloads — just the state pair + timestamp,
///             so each transition costs a single SSTORE + event.
contract TransitionRegistry {
    struct TransitionRecord {
        bytes32 claimHash;
        uint8 fromState;
        uint8 toState;
        uint256 timestamp;
        uint256 nonce;
        address signer;
        bool exists;
    }

    /// EIP-712 typehash: ClaimTransition(bytes32 claimHash,uint8 fromState,uint8 toState,uint256 nonce)
    bytes32 public constant TRANSITION_TYPEHASH =
        keccak256("ClaimTransition(bytes32 claimHash,uint8 fromState,uint8 toState,uint256 nonce)");

    /// The only address whose EIP-712 signature is accepted.
    address public immutable serverSigner;

    mapping(bytes32 => TransitionRecord) private _transitions;
    mapping(bytes32 => uint256) private _nonces;

    event TransitionRecorded(
        bytes32 indexed claimHash,
        uint8 fromState,
        uint8 toState,
        uint256 timestamp,
        uint256 nonce,
        address indexed signer
    );

    constructor(address serverSigner_) {
        require(serverSigner_ != address(0), "TransitionRegistry: empty signer");
        serverSigner = serverSigner_;
    }

    /// @notice Record a signed claim state transition (OBSERVED→SUPPORTED, etc).
    ///         The signature must be produced by `serverSigner` over the
    ///         EIP-712 digest of (claimHash, fromState, toState, nonce) where
    ///         nonce is the claim's current counter — replay of an older
    ///         signature is rejected because the nonce no longer matches.
    function recordTransition(
        bytes32 claimHash_,
        uint8 fromState_,
        uint8 toState_,
        bytes calldata signature_
    ) external {
        require(claimHash_ != bytes32(0), "TransitionRegistry: empty claim hash");
        require(fromState_ != toState_, "TransitionRegistry: no-op transition");

        uint256 nonce = _nonces[claimHash_];
        bytes32 digest = _digest(claimHash_, fromState_, toState_, nonce);
        address recovered = _recover(digest, signature_);
        require(recovered == serverSigner, "TransitionRegistry: invalid signature");

        _transitions[claimHash_] = TransitionRecord({
            claimHash: claimHash_,
            fromState: fromState_,
            toState: toState_,
            timestamp: block.timestamp,
            nonce: nonce,
            signer: recovered,
            exists: true
        });
        _nonces[claimHash_] = nonce + 1;

        emit TransitionRecorded(claimHash_, fromState_, toState_, block.timestamp, nonce, recovered);
    }

    /// @notice Look up the latest recorded transition for a claim.
    function getTransition(bytes32 claimHash_) external view returns (TransitionRecord memory) {
        return _transitions[claimHash_];
    }

    /// @notice The next nonce that must be signed for a claim.
    function nonceOf(bytes32 claimHash_) external view returns (uint256) {
        return _nonces[claimHash_];
    }

    /// @notice EIP-712 domain separator (name, version, chainId, contract).
    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("FreeWebMCP"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    function _digest(
        bytes32 claimHash_,
        uint8 fromState_,
        uint8 toState_,
        uint256 nonce_
    ) private view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator(),
                keccak256(abi.encode(TRANSITION_TYPEHASH, claimHash_, fromState_, toState_, nonce_))
            )
        );
    }

    function _recover(bytes32 digest_, bytes calldata signature_) private pure returns (address) {
        require(signature_.length == 65, "TransitionRegistry: bad signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature_.offset)
            s := calldataload(add(signature_.offset, 0x20))
            v := byte(0, calldataload(add(signature_.offset, 0x40)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest_, v, r, s);
    }
}

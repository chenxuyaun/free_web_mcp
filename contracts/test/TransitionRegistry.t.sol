// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {TransitionRegistry} from "../src/TransitionRegistry.sol";

contract TransitionRegistryTest is Test {
    TransitionRegistry internal registry;
    uint256 internal serverKey = 0xA11CE;
    address internal server = vm.addr(serverKey);

    bytes32 internal constant TRANSITION_TYPEHASH =
        keccak256("ClaimTransition(bytes32 claimHash,uint8 fromState,uint8 toState,uint256 nonce)");

    function setUp() public {
        registry = new TransitionRegistry(server);
    }

    /// Rebuild the EIP-712 digest the same way the contract does, then sign.
    function _sign(
        bytes32 claimHash,
        uint8 fromState,
        uint8 toState,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("FreeWebMCP"),
                keccak256("1"),
                block.chainid,
                address(registry)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                domainSeparator,
                keccak256(abi.encode(TRANSITION_TYPEHASH, claimHash, fromState, toState, nonce))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(serverKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_RecordTransition() public {
        bytes32 claimHash = keccak256("claim-1");
        bytes memory sig = _sign(claimHash, 1, 2, 0); // OBSERVED(1) → SUPPORTED(2)

        registry.recordTransition(claimHash, 1, 2, sig);

        TransitionRegistry.TransitionRecord memory t = registry.getTransition(claimHash);
        assertEq(t.claimHash, claimHash);
        assertEq(t.fromState, 1);
        assertEq(t.toState, 2);
        assertEq(t.signer, server);
        assertEq(t.nonce, 0);
        assertTrue(t.timestamp > 0);
        assertTrue(t.exists);
        assertEq(registry.nonceOf(claimHash), 1); // nonce advanced
    }

    function test_ReplayWithOldNonce_Reverts() public {
        bytes32 claimHash = keccak256("claim-2");
        bytes memory sig0 = _sign(claimHash, 1, 2, 0);

        registry.recordTransition(claimHash, 1, 2, sig0);

        // Same signature (nonce 0) again — nonce is now 1 → invalid signature
        vm.expectRevert("TransitionRegistry: invalid signature");
        registry.recordTransition(claimHash, 1, 2, sig0);
    }

    function test_SequentialNonces_Allowed() public {
        bytes32 claimHash = keccak256("claim-3");
        registry.recordTransition(claimHash, 1, 2, _sign(claimHash, 1, 2, 0));
        registry.recordTransition(claimHash, 2, 3, _sign(claimHash, 2, 3, 1)); // SUPPORTED→CHALLENGED

        TransitionRegistry.TransitionRecord memory t = registry.getTransition(claimHash);
        assertEq(t.fromState, 2);
        assertEq(t.toState, 3);
        assertEq(registry.nonceOf(claimHash), 2);
    }

    function test_WrongSigner_Reverts() public {
        bytes32 claimHash = keccak256("claim-4");
        // Sign with an unrelated key
        uint256 otherKey = 0xBEEF;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                registry.domainSeparator(),
                keccak256(abi.encode(TRANSITION_TYPEHASH, claimHash, uint8(1), uint8(2), uint256(0)))
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(otherKey, digest);

        vm.expectRevert("TransitionRegistry: invalid signature");
        registry.recordTransition(claimHash, 1, 2, abi.encodePacked(r, s, v));
    }

    function test_NoOpTransition_Reverts() public {
        vm.expectRevert("TransitionRegistry: no-op transition");
        registry.recordTransition(keccak256("claim-5"), 2, 2, hex"00");
    }

    function test_EmptyClaimHash_Reverts() public {
        vm.expectRevert("TransitionRegistry: empty claim hash");
        registry.recordTransition(bytes32(0), 1, 2, hex"00");
    }

    function test_Event_EmitsTransitionRecorded() public {
        bytes32 claimHash = keccak256("claim-6");
        bytes memory sig = _sign(claimHash, 1, 2, 0);

        vm.expectEmit(true, true, true, true);
        emit TransitionRegistry.TransitionRecorded(claimHash, 1, 2, block.timestamp, 0, server);
        registry.recordTransition(claimHash, 1, 2, sig);
    }
}

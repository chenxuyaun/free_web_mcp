// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";

contract EvidenceRegistryTest is Test {
    EvidenceRegistry internal registry;
    address internal alice = address(0xA11CE);

    function setUp() public {
        registry = new EvidenceRegistry();
    }

    function test_RegisterEvidence() public {
        bytes32 hash = keccak256("evidence-1");
        vm.prank(alice);
        registry.registerEvidence(hash, "https://example.com/evidence/1", "0.1.0");

        EvidenceRegistry.EvidenceRecord memory r = registry.getEvidence(hash);
        assertEq(r.evidenceHash, hash);
        assertEq(r.uri, "https://example.com/evidence/1");
        assertEq(r.version, "0.1.0");
        assertEq(r.submitter, alice);
        assertTrue(r.timestamp > 0);
        assertTrue(r.exists);
    }

    function test_DuplicateRegistration_Reverts() public {
        bytes32 hash = keccak256("evidence-1");
        registry.registerEvidence(hash, "https://example.com/1", "0.1.0");

        vm.expectRevert("EvidenceRegistry: already registered");
        registry.registerEvidence(hash, "https://example.com/1", "0.1.0");
    }

    function test_EmptyHash_Reverts() public {
        vm.expectRevert("EvidenceRegistry: empty hash");
        registry.registerEvidence(bytes32(0), "https://example.com/1", "0.1.0");
    }

    function test_Exists() public {
        bytes32 hash = keccak256("evidence-2");
        assertFalse(registry.exists(hash));
        registry.registerEvidence(hash, "https://example.com/2", "0.1.0");
        assertTrue(registry.exists(hash));
    }

    function test_DifferentHashesAreIndependent() public {
        bytes32 h1 = keccak256("evidence-3");
        bytes32 h2 = keccak256("evidence-4");
        registry.registerEvidence(h1, "https://example.com/3", "0.1.0");
        registry.registerEvidence(h2, "https://example.com/4", "0.1.0");
        assertTrue(registry.exists(h1));
        assertTrue(registry.exists(h2));
    }

    function test_Event_EmitsEvidenceRegistered() public {
        bytes32 hash = keccak256("evidence-5");
        vm.expectEmit(true, true, false, true);
        emit EvidenceRegistry.EvidenceRegistered(hash, "https://example.com/5", block.timestamp, address(this), "0.1.0");
        registry.registerEvidence(hash, "https://example.com/5", "0.1.0");
    }

    // ---------- Claim resolution (V1 protocol) ----------

    function test_ResolveClaim() public {
        bytes32 claimHash = keccak256("claim-1");
        bytes32 resRoot = keccak256("resolution-root-1");

        registry.resolveClaim(claimHash, true, "OPTIMISTIC_FINALIZE", resRoot);

        EvidenceRegistry.ClaimResolutionRecord memory r = registry.getResolution(claimHash);
        assertEq(r.claimHash, claimHash);
        assertEq(r.result, true);
        assertEq(r.method, "OPTIMISTIC_FINALIZE");
        assertEq(r.resolutionRoot, resRoot);
        assertTrue(r.timestamp > 0);
        assertTrue(r.exists);
    }

    function test_ResolveClaim_RevertOnDuplicate() public {
        bytes32 claimHash = keccak256("claim-2");
        registry.resolveClaim(claimHash, false, "CONSENSUS_VOTE", keccak256("root"));

        vm.expectRevert("EvidenceRegistry: already resolved");
        registry.resolveClaim(claimHash, true, "OPTIMISTIC_FINALIZE", keccak256("root2"));
    }

    function test_ResolveClaim_RevertOnEmptyHash() public {
        vm.expectRevert("EvidenceRegistry: empty claim hash");
        registry.resolveClaim(bytes32(0), true, "OPTIMISTIC_FINALIZE", keccak256("root"));
    }

    function test_ResolveClaim_RevertOnEmptyMethod() public {
        vm.expectRevert("EvidenceRegistry: empty method");
        registry.resolveClaim(keccak256("claim-3"), true, "", keccak256("root"));
    }

    function test_IsResolved() public {
        bytes32 claimHash = keccak256("claim-4");
        assertFalse(registry.isResolved(claimHash));
        registry.resolveClaim(claimHash, true, "OPTIMISTIC_FINALIZE", keccak256("root"));
        assertTrue(registry.isResolved(claimHash));
    }

    function test_Event_EmitsClaimResolved() public {
        bytes32 claimHash = keccak256("claim-5");
        bytes32 resRoot = keccak256("resolution-root-5");
        vm.expectEmit(true, false, false, true);
        emit EvidenceRegistry.ClaimResolved(claimHash, true, "OPTIMISTIC_FINALIZE", resRoot, block.timestamp, address(this));
        registry.resolveClaim(claimHash, true, "OPTIMISTIC_FINALIZE", resRoot);
    }
}

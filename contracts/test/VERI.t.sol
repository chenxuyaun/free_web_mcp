// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VERI} from "../src/VERI.sol";

contract VERITest is Test {
    VERI internal veri;
    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);

    function setUp() public {
        veri = new VERI(1_000_000 ether);
    }

    function test_InitialSupplyAndName() public view {
        assertEq(veri.name(), "Verifiable Evidence");
        assertEq(veri.symbol(), "VERI");
        assertEq(veri.decimals(), 18);
        assertEq(veri.totalSupply(), 1_000_000 ether);
        assertEq(veri.balanceOf(address(this)), 1_000_000 ether);
        assertEq(veri.owner(), address(this));
    }

    function test_Transfer() public {
        veri.transfer(bob, 100 ether);
        assertEq(veri.balanceOf(bob), 100 ether);
        assertEq(veri.balanceOf(address(this)), 1_000_000 ether - 100 ether);
    }

    function test_TransferInsufficient_Reverts() public {
        vm.prank(bob);
        vm.expectRevert("VERI: insufficient balance");
        veri.transfer(alice, 1 ether);
    }

    function test_ApproveAndTransferFrom() public {
        veri.approve(bob, 50 ether);
        vm.prank(bob);
        assertTrue(veri.transferFrom(address(this), alice, 50 ether));
        assertEq(veri.balanceOf(alice), 50 ether);
        assertEq(veri.allowance(address(this), bob), 0);
    }

    function test_MintOnlyOwner() public {
        veri.mint(bob, 500 ether);
        assertEq(veri.balanceOf(bob), 500 ether);
        assertEq(veri.totalSupply(), 1_000_000 ether + 500 ether);

        vm.prank(bob);
        vm.expectRevert("VERI: not owner");
        veri.mint(alice, 1 ether);
    }

    function test_Burn() public {
        veri.burn(100 ether);
        assertEq(veri.totalSupply(), 1_000_000 ether - 100 ether);
    }

    function test_BurnFrom() public {
        veri.approve(bob, 200 ether);
        vm.prank(bob);
        veri.burnFrom(address(this), 200 ether);
        assertEq(veri.totalSupply(), 1_000_000 ether - 200 ether);
    }

    function test_TransferOwnership() public {
        veri.transferOwnership(bob);
        assertEq(veri.owner(), bob);
        vm.prank(bob);
        veri.mint(alice, 1 ether);
        assertEq(veri.balanceOf(alice), 1 ether);
    }

    function test_ZeroAddressTransfer_Reverts() public {
        vm.expectRevert("VERI: transfer to zero");
        veri.transfer(address(0), 1 ether);
    }
}

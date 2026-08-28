// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {VERI} from "../src/VERI.sol";

/// @notice Deploy VERI (Verifiable Evidence Test Token) to BSC Testnet.
///
/// Usage:
///   forge script script/DeployVERI.s.sol:DeployVERI \
///     --rpc-url https://data-seed-prebsc-1-s1.binance.org:8545 \
///     --broadcast
///
/// Initial supply: 100,000,000 VERI to the deployer (reward pool).
contract DeployVERI is Script {
    function run() external returns (VERI) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        VERI veri = new VERI(100_000_000 ether);

        vm.stopBroadcast();

        console2.log("VERI deployed at:", address(veri));
        console2.log("Total supply:", uint256(100_000_000 ether));
        return veri;
    }
}

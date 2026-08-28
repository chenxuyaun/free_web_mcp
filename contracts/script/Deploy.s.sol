// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";

/// @notice Deploy the EvidenceRegistry to BSC Testnet.
///
/// Usage:
///   forge script script/Deploy.s.sol:DeployEvidenceRegistry \
///     --rpc-url bsc_testnet \
///     --private-key $PRIVATE_KEY \
///     --broadcast
contract DeployEvidenceRegistry is Script {
    function run() external returns (EvidenceRegistry) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        EvidenceRegistry registry = new EvidenceRegistry();

        vm.stopBroadcast();

        console2.log("EvidenceRegistry deployed at:", address(registry));
        return registry;
    }
}

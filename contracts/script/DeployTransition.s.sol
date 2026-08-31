// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {TransitionRegistry} from "../src/TransitionRegistry.sol";

/// @notice Deploy the TransitionRegistry (EIP-712 signed claim state
///         transitions) to BSC Testnet.
///
///         The serverSigner is the WALLET_PRIVATE_KEY account — the same
///         signer the dashboard uses for EvidenceRegistry + VERI.
///
/// Usage:
///   forge script script/DeployTransition.s.sol:DeployTransition \
///     --rpc-url bsc_testnet \
///     --private-key $PRIVATE_KEY \
///     --broadcast
contract DeployTransition is Script {
    function run() external returns (TransitionRegistry) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address serverSigner = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);

        TransitionRegistry registry = new TransitionRegistry(serverSigner);

        vm.stopBroadcast();

        console2.log("TransitionRegistry deployed at:", address(registry));
        console2.log("serverSigner:", serverSigner);
        return registry;
    }
}

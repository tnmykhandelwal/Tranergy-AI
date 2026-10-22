// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {GreenRewardToken} from "../src/GreenRewardToken.sol";
import {EnergyTrade} from "../src/EnergyTrade.sol";

contract Deploy is Script {
    function run() external {
        vm.startBroadcast();

        GreenRewardToken token = new GreenRewardToken(msg.sender);
        EnergyTrade energyTrade = new EnergyTrade(address(token));

        energyTrade.grantRole(energyTrade.OPERATOR_ROLE(), msg.sender);
        energyTrade.grantRole(energyTrade.ATTESTOR_ROLE(), msg.sender);

        address extraAttestor = vm.envOr("ATTESTOR_ADDRESS", address(0));
        if (extraAttestor != address(0)) {
            energyTrade.grantRole(energyTrade.ATTESTOR_ROLE(), extraAttestor);
        }

        token.grantRole(token.MINTER_ROLE(), address(energyTrade));

        vm.stopBroadcast();

        string memory outFile = string.concat(vm.projectRoot(), "/deployments/anvil.json");
        string memory json = string.concat(
            '{"network":"anvil","chainId":',
            vm.toString(block.chainid),
            ',"energyTrade":"',
            vm.toString(address(energyTrade)),
            '","greenRewardToken":"',
            vm.toString(address(token)),
            '","deployer":"',
            vm.toString(msg.sender),
            '","deployedAt":"',
            _toIso8601(block.timestamp),
            '"}'
        );
        vm.writeFile(outFile, json);
    }

    function _toIso8601(uint256 timestamp) internal pure returns (string memory) {
        int64 z = int64(uint64(timestamp / 1 days)) + 719468;
        int64 era = (z >= 0 ? z : z - 146096) / 146097;
        uint64 doe = uint64(z - era * 146097);
        uint64 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        int64 y = int64(yoe) + era * 400;
        uint64 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint64 mp = (5 * doy + 2) / 153;
        uint64 d = doy - (153 * mp + 2) / 5 + 1;
        uint64 m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) {
            y += 1;
        }

        uint64 secs = uint64(timestamp % 1 days);
        return string.concat(
            _padLeft(vm.toString(y), 4),
            "-",
            _padLeft(vm.toString(m), 2),
            "-",
            _padLeft(vm.toString(d), 2),
            "T",
            _padLeft(vm.toString(secs / 3600), 2),
            ":",
            _padLeft(vm.toString((secs % 3600) / 60), 2),
            ":",
            _padLeft(vm.toString(secs % 60), 2),
            "Z"
        );
    }

    function _padLeft(string memory value, uint256 width) internal pure returns (string memory) {
        bytes memory b = bytes(value);
        if (b.length >= width) return value;
        bytes memory out = new bytes(width);
        uint256 offset = width - b.length;
        for (uint256 i; i < offset; ++i) {
            out[i] = bytes1("0");
        }
        for (uint256 i; i < b.length; ++i) {
            out[offset + i] = b[i];
        }
        return string(out);
    }
}

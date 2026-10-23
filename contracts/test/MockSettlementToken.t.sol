// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockSettlementToken} from "../src/MockSettlementToken.sol";

contract MockSettlementTokenTest is Test {
    MockSettlementToken internal token;
    address internal someone = makeAddr("someone");

    function setUp() public {
        token = new MockSettlementToken(address(this));
    }

    function testMetadataIsSixDecimalStablecoinStyle() public view {
        assertEq(token.name(), "Tranergy Test Settlement");
        assertEq(token.symbol(), "TSTR");
        assertEq(token.decimals(), 6);
    }

    function testFaucetMintsOneMillionTokensToCaller() public {
        uint256 before = token.balanceOf(someone);
        vm.prank(someone);
        token.faucet();
        assertEq(token.balanceOf(someone), before + 1_000_000 * 10 ** 6);
        assertEq(token.FAUCET_AMOUNT(), 1_000_000 * 10 ** 6);
    }

    function testOnlyMinterCanMint() public {
        bytes memory err = abi.encodeWithSignature(
            "AccessControlUnauthorizedAccount(address,bytes32)",
            someone,
            token.MINTER_ROLE()
        );
        vm.expectRevert(err);
        vm.prank(someone);
        token.mint(someone, 1);
    }
}

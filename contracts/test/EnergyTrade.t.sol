// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GreenRewardToken} from "../src/GreenRewardToken.sol";
import {MockSettlementToken} from "../src/MockSettlementToken.sol";
import {EnergyTrade} from "../src/EnergyTrade.sol";

contract EnergyTradeTest is Test, EnergyTrade {
    GreenRewardToken internal token;
    MockSettlementToken internal settlement;

    address internal operator;
    address internal attestor;
    address internal producer;
    address internal consumer;
    address internal stranger;

    bytes32 internal constant EVIDENCE_HASH = keccak256("evidence-bundle-v1");
    bytes32 internal constant DISPUTE_REASON = keccak256("meter-mismatch");

    constructor() EnergyTrade(_deployRewardToken(), _deploySettlementToken(), 10_000, 1 days) {}

    function _deployRewardToken() internal returns (address) {
        GreenRewardToken deployed = new GreenRewardToken(address(this));
        token = deployed;
        return address(deployed);
    }

    function _deploySettlementToken() internal returns (address) {
        MockSettlementToken deployed = new MockSettlementToken(address(this));
        settlement = deployed;
        return address(deployed);
    }

    function setUp() public {
        operator = makeAddr("operator");
        attestor = makeAddr("attestor");
        producer = makeAddr("producer");
        consumer = makeAddr("consumer");
        stranger = makeAddr("stranger");

        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(ATTESTOR_ROLE, attestor);
        token.grantRole(token.MINTER_ROLE(), address(this));
    }

    function _createDefaultTrade() internal {
        vm.prank(operator);
        this.createTrade(1, producer, consumer, 20, 0.12 ether);
    }

    function _createAndEvidenceTrade() internal {
        _createDefaultTrade();
        vm.prank(operator);
        this.submitEvidence(1, EVIDENCE_HASH);
    }

    function _unauthorizedRevert(address account, bytes32 role) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("AccessControlUnauthorizedAccount(address,bytes32)", account, role);
    }

    function test_createTrade_happyPath() public {
        vm.expectEmit(true, false, false, true, address(this));
        emit TradeCreated(1, producer, consumer, 20, 0.12 ether);

        vm.prank(operator);
        this.createTrade(1, producer, consumer, 20, 0.12 ether);

        Trade memory trade = this.getTrade(1);
        assertEq(trade.producer, producer);
        assertEq(trade.consumer, consumer);
        assertEq(trade.quantityKwh, 20);
        assertEq(trade.pricePerKwhWei, 0.12 ether);
        assertEq(uint8(trade.state), uint8(TradeState.Matched));
        assertEq(trade.evidenceHash, bytes32(0));
        assertEq(trade.attestedBy, address(0));
        assertEq(trade.createdAt, uint64(block.timestamp));
        assertEq(trade.settledAt, 0);
    }

    function test_createTrade_revertsForWrongRole() public {
        vm.expectRevert(_unauthorizedRevert(attestor, OPERATOR_ROLE));
        vm.prank(attestor);
        this.createTrade(1, producer, consumer, 20, 0.12 ether);

        vm.expectRevert(_unauthorizedRevert(stranger, OPERATOR_ROLE));
        vm.prank(stranger);
        this.createTrade(1, producer, consumer, 20, 0.12 ether);
    }

    function test_createTrade_revertsForDuplicateId() public {
        _createDefaultTrade();

        vm.expectRevert(EnergyTrade.TradeExists.selector);
        vm.prank(operator);
        this.createTrade(1, producer, consumer, 5, 0.2 ether);
    }

    function test_createTrade_revertsForZeroProducer() public {
        vm.expectRevert(EnergyTrade.ZeroAddress.selector);
        vm.prank(operator);
        this.createTrade(1, address(0), consumer, 20, 0.12 ether);
    }

    function test_createTrade_revertsForZeroConsumer() public {
        vm.expectRevert(EnergyTrade.ZeroAddress.selector);
        vm.prank(operator);
        this.createTrade(1, producer, address(0), 20, 0.12 ether);
    }

    function test_createTrade_revertsForZeroQuantity() public {
        vm.expectRevert(EnergyTrade.InvalidQuantity.selector);
        vm.prank(operator);
        this.createTrade(1, producer, consumer, 0, 0.12 ether);
    }

    function test_submitEvidence_happyPath() public {
        _createDefaultTrade();

        vm.expectEmit(true, false, false, true, address(this));
        emit EvidenceSubmitted(1, EVIDENCE_HASH, operator);

        vm.prank(operator);
        this.submitEvidence(1, EVIDENCE_HASH);

        Trade memory trade = this.getTrade(1);
        assertEq(uint8(trade.state), uint8(TradeState.EvidenceSubmitted));
        assertEq(trade.evidenceHash, EVIDENCE_HASH);
    }

    function test_submitEvidence_revertsForWrongRole() public {
        _createDefaultTrade();

        vm.expectRevert(_unauthorizedRevert(attestor, OPERATOR_ROLE));
        vm.prank(attestor);
        this.submitEvidence(1, EVIDENCE_HASH);

        vm.expectRevert(_unauthorizedRevert(stranger, OPERATOR_ROLE));
        vm.prank(stranger);
        this.submitEvidence(1, EVIDENCE_HASH);
    }

    function test_submitEvidence_revertsWhenNotMatched() public {
        _createAndEvidenceTrade();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(operator);
        this.submitEvidence(1, keccak256("second-evidence"));
    }

    function test_submitEvidence_revertsForEmptyHash() public {
        _createDefaultTrade();

        vm.expectRevert(EnergyTrade.EmptyEvidenceHash.selector);
        vm.prank(operator);
        this.submitEvidence(1, bytes32(0));
    }

    function test_attestAndSettle_happyPath() public {
        _createAndEvidenceTrade();

        vm.expectEmit(true, false, false, true, address(this));
        emit TradeSettled(1, attestor);
        vm.expectEmit(true, false, false, true, address(this));
        emit RewardMinted(1, producer, 20 ether);

        vm.prank(attestor);
        this.attestAndSettle(1);

        Trade memory trade = this.getTrade(1);
        assertEq(uint8(trade.state), uint8(TradeState.Settled));
        assertEq(trade.attestedBy, attestor);
        assertEq(trade.settledAt, uint64(block.timestamp));
        assertEq(token.balanceOf(producer), 20 ether);
        assertEq(token.balanceOf(consumer), 0);
    }

    function test_attestAndSettle_revertsForWrongRole() public {
        _createAndEvidenceTrade();

        vm.expectRevert(_unauthorizedRevert(operator, ATTESTOR_ROLE));
        vm.prank(operator);
        this.attestAndSettle(1);

        vm.expectRevert(_unauthorizedRevert(stranger, ATTESTOR_ROLE));
        vm.prank(stranger);
        this.attestAndSettle(1);
    }

    function test_attestAndSettle_revertsWhenNotEvidenceSubmitted() public {
        _createDefaultTrade();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.attestAndSettle(1);
    }

    function test_attestAndSettle_revertsOnDoubleSettle() public {
        _createAndEvidenceTrade();
        vm.prank(attestor);
        this.attestAndSettle(1);

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.attestAndSettle(1);

        assertEq(token.balanceOf(producer), 20 ether);
    }

    function test_dispute_fromMatched() public {
        _createDefaultTrade();

        vm.expectEmit(true, false, false, true, address(this));
        emit TradeDisputed(1, DISPUTE_REASON);

        vm.prank(attestor);
        this.dispute(1, DISPUTE_REASON);

        Trade memory trade = this.getTrade(1);
        assertEq(uint8(trade.state), uint8(TradeState.Disputed));
        assertEq(this.disputeReason(1), DISPUTE_REASON);
        assertEq(token.balanceOf(producer), 0);
    }

    function test_dispute_fromEvidenceSubmitted() public {
        _createAndEvidenceTrade();

        vm.prank(attestor);
        this.dispute(1, DISPUTE_REASON);

        Trade memory trade = this.getTrade(1);
        assertEq(uint8(trade.state), uint8(TradeState.Disputed));
        assertEq(trade.evidenceHash, EVIDENCE_HASH);
        assertEq(this.disputeReason(1), DISPUTE_REASON);
    }

    function test_dispute_revertsAfterSettled() public {
        _createAndEvidenceTrade();
        vm.prank(attestor);
        this.attestAndSettle(1);

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.dispute(1, DISPUTE_REASON);
    }

    function test_dispute_revertsForWrongRole() public {
        _createDefaultTrade();

        vm.expectRevert(_unauthorizedRevert(operator, ATTESTOR_ROLE));
        vm.prank(operator);
        this.dispute(1, DISPUTE_REASON);

        vm.expectRevert(_unauthorizedRevert(stranger, ATTESTOR_ROLE));
        vm.prank(stranger);
        this.dispute(1, DISPUTE_REASON);
    }

    function test_getTrade_revertsForUnknownId() public {
        vm.expectRevert(EnergyTrade.TradeNotFound.selector);
        this.getTrade(999);
    }
}

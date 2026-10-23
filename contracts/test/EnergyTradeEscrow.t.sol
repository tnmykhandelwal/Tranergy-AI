// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {GreenRewardToken} from "../src/GreenRewardToken.sol";
import {MockSettlementToken} from "../src/MockSettlementToken.sol";
import {EnergyTrade} from "../src/EnergyTrade.sol";

contract EnergyTradeEscrowTest is Test, EnergyTrade {
    GreenRewardToken internal reward;
    MockSettlementToken internal settlement;

    address internal operator;
    address internal attestor;
    address internal producer;
    address internal consumer;
    address internal stranger;

    bytes32 internal constant EVIDENCE_HASH = keccak256("delivery-evidence");
    bytes32 internal constant DISPUTE_REASON = keccak256("meter mismatch");

    uint256 internal constant TRADE_ID = 7;
    uint96 internal constant QUANTITY_MILLI = 20_000; // 20.000 kWh
    uint96 internal constant PRICE_UNITS = 120_000; // 0.120000 TSTR per kWh (6 decimals)
    uint256 internal constant TRADE_VALUE = 2_400_000; // 2.4 TSTR

    constructor() EnergyTrade(_deployReward(), _deploySettlement(), 10_000, 1 hours) {}

    function _deployReward() internal returns (address) {
        reward = new GreenRewardToken(address(this));
        return address(reward);
    }

    function _deploySettlement() internal returns (address) {
        settlement = new MockSettlementToken(address(this));
        return address(settlement);
    }

    function setUp() public {
        operator = makeAddr("operator");
        attestor = makeAddr("attestor");
        producer = makeAddr("producer");
        consumer = makeAddr("consumer");
        stranger = makeAddr("stranger");

        _grantRole(DEFAULT_ADMIN_ROLE, address(this));
        _grantRole(OPERATOR_ROLE, operator);
        _grantRole(ATTESTOR_ROLE, attestor);
        reward.grantRole(reward.MINTER_ROLE(), address(this));
        settlement.grantRole(settlement.MINTER_ROLE(), address(this));

        settlement.mint(producer, 100 * 10 ** 6);
        settlement.mint(consumer, 100 * 10 ** 6);
        vm.prank(producer);
        settlement.approve(address(this), type(uint256).max);
        vm.prank(consumer);
        settlement.approve(address(this), type(uint256).max);
    }

    function _createEscrow() internal {
        _createEscrowWith(QUANTITY_MILLI, PRICE_UNITS);
    }

    function _createEscrowWith(uint96 quantityMilli, uint96 priceUnits) internal {
        vm.prank(operator);
        this.createEscrowTrade(
            TRADE_ID,
            producer,
            consumer,
            quantityMilli,
            priceUnits,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
    }

    function _fundConsumer() internal {
        vm.prank(consumer);
        this.depositConsumerPayment(TRADE_ID);
        vm.prank(consumer);
        this.depositConsumerCollateral(TRADE_ID);
    }

    function _fundProducer() internal {
        vm.prank(producer);
        this.depositProducerCollateral(TRADE_ID);
    }

    function _fundAll() internal {
        _fundConsumer();
        _fundProducer();
    }

    function _submitEvidence() internal {
        vm.prank(operator);
        this.submitEvidence(TRADE_ID, EVIDENCE_HASH);
    }

    function _closeDeliveryWindow() internal {
        Escrow memory e = this.getEscrow(TRADE_ID);
        vm.warp(uint256(e.deliveryDeadline) + uint256(e.gracePeriod) + 1);
    }

    function _assertContractEmpty() internal view {
        assertEq(settlement.balanceOf(address(this)), 0, "contract must not retain escrow funds");
    }

    // ------------------------------------------------------------------
    // Happy path
    // ------------------------------------------------------------------

    function test_escrowQuoteAndDepositsAreSeparate() public {
        _createEscrow();

        Escrow memory e = this.getEscrow(TRADE_ID);
        assertEq(e.paymentRequired, TRADE_VALUE);
        assertEq(e.consumerCollateralRequired, TRADE_VALUE);
        assertEq(e.producerCollateralRequired, TRADE_VALUE);
        assertEq(e.tradeValue, TRADE_VALUE);
        assertEq(e.quantityKwhMilli, QUANTITY_MILLI);
        assertEq(e.pricePerKwhUnits, PRICE_UNITS);

        _fundConsumer();
        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.Matched));
        assertEq(settlement.balanceOf(address(this)), TRADE_VALUE * 2);

        _fundProducer();
        Trade memory trade = this.getTrade(TRADE_ID);
        assertEq(uint8(trade.state), uint8(TradeState.DeliveryActive));
        assertEq(settlement.balanceOf(address(this)), TRADE_VALUE * 3);

        (uint256 payment, uint256 cc, uint256 pc, uint256 total) = this.escrowBalances(TRADE_ID);
        assertEq(payment, TRADE_VALUE);
        assertEq(cc, TRADE_VALUE);
        assertEq(pc, TRADE_VALUE);
        assertEq(total, TRADE_VALUE * 3);
    }

    function test_fullDeliverySettlesAllThreeDeposits() public {
        _createEscrow();
        _fundAll();
        uint256 producerBefore = settlement.balanceOf(producer);
        uint256 consumerBefore = settlement.balanceOf(consumer);
        assertEq(producerBefore, 100 * 10 ** 6 - TRADE_VALUE);
        assertEq(consumerBefore, 100 * 10 ** 6 - TRADE_VALUE * 2);

        _submitEvidence();
        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.EvidenceSubmitted));

        vm.prank(attestor);
        this.attestAndSettle(TRADE_ID);

        Trade memory trade = this.getTrade(TRADE_ID);
        assertEq(uint8(trade.state), uint8(TradeState.Settled));
        assertEq(trade.attestedBy, attestor);
        assertTrue(trade.rewardMinted);

        Escrow memory e = this.getEscrow(TRADE_ID);
        assertEq(uint8(e.outcome), uint8(EscrowOutcome.FullDelivery));
        assertEq(e.paymentToProducer, TRADE_VALUE);
        assertEq(e.paymentRefunded, 0);
        assertEq(e.producerCollateralReturned, TRADE_VALUE);
        assertEq(e.producerCollateralSlashed, 0);
        assertEq(e.consumerCollateralReturned, TRADE_VALUE);

        assertEq(settlement.balanceOf(producer), producerBefore + TRADE_VALUE + TRADE_VALUE);
        assertEq(settlement.balanceOf(consumer), consumerBefore + TRADE_VALUE);
        assertEq(reward.balanceOf(producer), QUANTITY_MILLI / 1000 * 1e18);
        _assertContractEmpty();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.attestAndSettle(TRADE_ID);
    }

    // ------------------------------------------------------------------
    // Producer default
    // ------------------------------------------------------------------

    function test_producerDefaultRefundsConsumerAndSeizesCollateral() public {
        _createEscrow();
        _fundAll();
        uint256 producerBefore = settlement.balanceOf(producer);
        uint256 consumerBefore = settlement.balanceOf(consumer);

        _closeDeliveryWindow();

        vm.prank(attestor);
        this.resolveProducerDefault(TRADE_ID, keccak256("no delivery observed"));

        Trade memory trade = this.getTrade(TRADE_ID);
        assertEq(uint8(trade.state), uint8(TradeState.Defaulted));
        assertFalse(trade.rewardMinted);

        Escrow memory e = this.getEscrow(TRADE_ID);
        assertEq(uint8(e.outcome), uint8(EscrowOutcome.ProducerDefault));
        assertEq(e.paymentToProducer, 0);
        assertEq(e.paymentRefunded, TRADE_VALUE);
        assertEq(e.producerCollateralReturned, 0);
        assertEq(e.producerCollateralSlashed, TRADE_VALUE);
        assertEq(e.consumerCollateralReturned, TRADE_VALUE);

        // Consumer gets payment refund + own collateral + producer's forfeited collateral.
        assertEq(settlement.balanceOf(consumer), consumerBefore + TRADE_VALUE * 3);
        // Producer gets nothing back.
        assertEq(settlement.balanceOf(producer), producerBefore);
        assertEq(reward.balanceOf(producer), 0);
        _assertContractEmpty();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.attestAndSettle(TRADE_ID);
    }

    function test_defaultCannotRunBeforeDeadlineAndGrace() public {
        _createEscrow();
        _fundAll();

        vm.expectRevert(EnergyTrade.DeadlineNotReached.selector);
        vm.prank(attestor);
        this.resolveProducerDefault(TRADE_ID, EVIDENCE_HASH);

        Escrow memory e = this.getEscrow(TRADE_ID);
        vm.warp(uint256(e.deliveryDeadline) + uint256(e.gracePeriod) - 1);
        vm.expectRevert(EnergyTrade.DeadlineNotReached.selector);
        vm.prank(attestor);
        this.resolveProducerDefault(TRADE_ID, EVIDENCE_HASH);
    }

    // ------------------------------------------------------------------
    // Partial delivery
    // ------------------------------------------------------------------

    function test_verifiedPartialDeliveryUsesProportionalRules() public {
        _createEscrow();
        _fundAll();
        _submitEvidence();

        uint256 producerBefore = settlement.balanceOf(producer);
        uint256 consumerBefore = settlement.balanceOf(consumer);
        uint256 delivered = QUANTITY_MILLI / 4; // 5 kWh

        vm.prank(attestor);
        this.attestPartialDelivery(TRADE_ID, delivered);

        // payment = value * delivered / agreed = 600_000
        // refund = 1_800_000
        // slashed = producer collateral * (agreed-delivered) / agreed = 1_800_000
        // returned = 600_000
        Escrow memory e = this.getEscrow(TRADE_ID);
        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.PartiallySettled));
        assertEq(uint8(e.outcome), uint8(EscrowOutcome.PartialDelivery));
        assertEq(e.deliveredKwhMilli, delivered);
        assertEq(e.paymentToProducer, 600_000);
        assertEq(e.paymentRefunded, 1_800_000);
        assertEq(e.producerCollateralReturned, 600_000);
        assertEq(e.producerCollateralSlashed, 1_800_000);
        assertEq(e.consumerCollateralReturned, TRADE_VALUE);

        assertEq(settlement.balanceOf(producer), producerBefore + 600_000 + 600_000);
        assertEq(settlement.balanceOf(consumer), consumerBefore + 1_800_000 + TRADE_VALUE + 1_800_000);
        assertEq(reward.balanceOf(producer), (delivered * 1e18) / 1000);
        _assertContractEmpty();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.attestPartialDelivery(TRADE_ID, delivered);
    }

    function test_partialDeliveryRejectsZeroAndFullQuantity() public {
        _createEscrow();
        _fundAll();
        _submitEvidence();

        vm.expectRevert(EnergyTrade.InvalidDeliveryQuantity.selector);
        vm.prank(attestor);
        this.attestPartialDelivery(TRADE_ID, 0);

        vm.expectRevert(EnergyTrade.InvalidDeliveryQuantity.selector);
        vm.prank(attestor);
        this.attestPartialDelivery(TRADE_ID, QUANTITY_MILLI);
    }

    function test_partialRoundingConservesEveryUnit() public {
        // 7 milli-kWh at 1_000_000 base units/kWh -> 7_000 base units total.
        uint96 quantity = 7;
        uint96 price = 1_000_000;
        vm.prank(operator);
        this.createEscrowTrade(
            99,
            producer,
            consumer,
            quantity,
            price,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
        _fundAllFor(99);
        vm.prank(operator);
        this.submitEvidence(99, EVIDENCE_HASH);

        vm.prank(attestor);
        this.attestPartialDelivery(99, 1);

        Escrow memory e = this.getEscrow(99);
        assertEq(e.paymentToProducer + e.paymentRefunded, e.paymentRequired);
        assertEq(e.producerCollateralReturned + e.producerCollateralSlashed, e.producerCollateralRequired);
        assertEq(e.consumerCollateralReturned, e.consumerCollateralRequired);
        assertEq(e.paymentToProducer, 1_000);
        assertEq(e.paymentRefunded, 6_000);
        assertEq(e.producerCollateralSlashed, 6_000);
        assertEq(e.producerCollateralReturned, 1_000);
        _assertContractEmpty();
    }

    function _fundAllFor(uint256 tradeId) internal {
        vm.prank(consumer);
        this.depositConsumerPayment(tradeId);
        vm.prank(consumer);
        this.depositConsumerCollateral(tradeId);
        vm.prank(producer);
        this.depositProducerCollateral(tradeId);
    }

    // ------------------------------------------------------------------
    // Funding guards
    // ------------------------------------------------------------------

    function test_deliveryCannotStartWithAnyMissingDeposit() public {
        _createEscrow();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(operator);
        this.submitEvidence(TRADE_ID, EVIDENCE_HASH);

        vm.prank(consumer);
        this.depositConsumerPayment(TRADE_ID);
        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.Matched));

        vm.prank(consumer);
        this.depositConsumerCollateral(TRADE_ID);
        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.Matched));

        vm.prank(producer);
        this.depositProducerCollateral(TRADE_ID);
        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.DeliveryActive));
    }

    function test_unauthorizedAndDuplicateDepositsRevert() public {
        _createEscrow();

        vm.expectRevert(EnergyTrade.NotParticipant.selector);
        vm.prank(stranger);
        this.depositConsumerPayment(TRADE_ID);

        vm.expectRevert(EnergyTrade.NotParticipant.selector);
        vm.prank(consumer);
        this.depositProducerCollateral(TRADE_ID);

        vm.expectRevert(EnergyTrade.NotParticipant.selector);
        vm.prank(producer);
        this.depositConsumerCollateral(TRADE_ID);

        vm.prank(consumer);
        this.depositConsumerPayment(TRADE_ID);
        vm.expectRevert(EnergyTrade.DuplicateDeposit.selector);
        vm.prank(consumer);
        this.depositConsumerPayment(TRADE_ID);

        vm.prank(producer);
        this.depositProducerCollateral(TRADE_ID);
        vm.expectRevert(EnergyTrade.DuplicateDeposit.selector);
        vm.prank(producer);
        this.depositProducerCollateral(TRADE_ID);
    }

    function test_depositsAfterFundingDeadlineRevert() public {
        _createEscrow();
        Escrow memory e = this.getEscrow(TRADE_ID);
        vm.warp(uint256(e.fundingDeadline) + 1);

        vm.expectRevert(EnergyTrade.FundingExpired.selector);
        vm.prank(consumer);
        this.depositConsumerPayment(TRADE_ID);
    }

    function test_insufficientBalanceDepositRevertsWithoutStateChange() public {
        address poorConsumer = makeAddr("poorConsumer");
        vm.prank(operator);
        this.createEscrowTrade(
            8,
            producer,
            poorConsumer,
            QUANTITY_MILLI,
            PRICE_UNITS,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );

        vm.expectRevert();
        vm.prank(poorConsumer);
        this.depositConsumerPayment(8);

        Escrow memory e = this.getEscrow(8);
        assertEq(e.paymentFunded, 0);
        assertEq(uint8(this.getTrade(8).state), uint8(TradeState.Matched));
        assertEq(settlement.balanceOf(address(this)), 0);
    }

    function test_duplicateTradeAndDepositsAfterActivationRevert() public {
        _createEscrow();
        _fundAll();

        vm.expectRevert(EnergyTrade.TradeExists.selector);
        vm.prank(operator);
        this.createTrade(TRADE_ID, producer, consumer, 20, 1);

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(consumer);
        this.depositConsumerPayment(TRADE_ID);
    }

    function test_expiredIncompleteTradeRefundsOnlyDepositsMade() public {
        _createEscrow();
        vm.prank(consumer);
        this.depositConsumerPayment(TRADE_ID);
        uint256 consumerAfterDeposit = settlement.balanceOf(consumer);
        uint256 producerBefore = settlement.balanceOf(producer);

        Escrow memory e = this.getEscrow(TRADE_ID);
        vm.warp(uint256(e.fundingDeadline) + 1);

        this.cancelExpiredEscrow(TRADE_ID);

        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.Cancelled));
        assertEq(settlement.balanceOf(consumer), consumerAfterDeposit + TRADE_VALUE);
        assertEq(settlement.balanceOf(producer), producerBefore);
        _assertContractEmpty();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(consumer);
        this.depositConsumerCollateral(TRADE_ID);

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.resolveProducerDefault(TRADE_ID, EVIDENCE_HASH);
    }

    // ------------------------------------------------------------------
    // Disputes
    // ------------------------------------------------------------------

    function test_participantCanRaiseDisputeAndFundsStayLocked() public {
        _createEscrow();
        _fundAll();

        vm.prank(consumer);
        this.raiseDispute(TRADE_ID, DISPUTE_REASON);

        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.Disputed));
        assertEq(this.disputeReason(TRADE_ID), DISPUTE_REASON);
        assertEq(settlement.balanceOf(address(this)), TRADE_VALUE * 3);

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(consumer);
        this.raiseDispute(TRADE_ID, DISPUTE_REASON);
    }

    function test_raiseDisputeRejectsNonParticipant() public {
        _createEscrow();
        _fundAll();

        vm.expectRevert(EnergyTrade.NotParticipant.selector);
        vm.prank(stranger);
        this.raiseDispute(TRADE_ID, DISPUTE_REASON);
    }

    function test_disputeResolvedAsFullDeliveryPaysNormally() public {
        _createEscrow();
        _fundAll();
        _submitEvidence();

        vm.prank(producer);
        this.raiseDispute(TRADE_ID, DISPUTE_REASON);

        vm.prank(attestor);
        this.resolveDispute(
            TRADE_ID,
            EscrowOutcome.FullDelivery,
            0,
            keccak256("verified full delivery"),
            EVIDENCE_HASH
        );

        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.Settled));
        Escrow memory e = this.getEscrow(TRADE_ID);
        assertEq(uint8(e.outcome), uint8(EscrowOutcome.FullDelivery));
        assertEq(e.resolutionEvidenceHash, EVIDENCE_HASH);
        _assertContractEmpty();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.resolveDispute(
            TRADE_ID,
            EscrowOutcome.FullDelivery,
            0,
            keccak256("again"),
            EVIDENCE_HASH
        );
    }

    function test_disputeResolvedAsDefaultAfterDeadline() public {
        _createEscrow();
        _fundAll();
        vm.prank(consumer);
        this.raiseDispute(TRADE_ID, DISPUTE_REASON);
        _closeDeliveryWindow();

        uint256 consumerBefore = settlement.balanceOf(consumer);
        vm.prank(attestor);
        this.resolveDispute(
            TRADE_ID,
            EscrowOutcome.ProducerDefault,
            0,
            keccak256("no delivery after review"),
            keccak256("meter evidence")
        );

        assertEq(uint8(this.getTrade(TRADE_ID).state), uint8(TradeState.Defaulted));
        assertEq(settlement.balanceOf(consumer), consumerBefore + TRADE_VALUE * 3);
        _assertContractEmpty();
    }

    function test_disputeDefaultStillRequiresDeadline() public {
        _createEscrow();
        _fundAll();
        vm.prank(consumer);
        this.raiseDispute(TRADE_ID, DISPUTE_REASON);

        vm.expectRevert(EnergyTrade.DeadlineNotReached.selector);
        vm.prank(attestor);
        this.resolveDispute(
            TRADE_ID,
            EscrowOutcome.ProducerDefault,
            0,
            DISPUTE_REASON,
            EVIDENCE_HASH
        );
    }

    // ------------------------------------------------------------------
    // Authorization
    // ------------------------------------------------------------------

    function test_onlyAuthorizedRolesCanRegisterAndResolve() public {
        bytes memory unauthorized = abi.encodeWithSignature(
            "AccessControlUnauthorizedAccount(address,bytes32)",
            stranger,
            OPERATOR_ROLE
        );
        vm.expectRevert(unauthorized);
        vm.prank(stranger);
        this.createEscrowTrade(
            TRADE_ID,
            producer,
            consumer,
            QUANTITY_MILLI,
            PRICE_UNITS,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );

        _createEscrow();
        _fundAll();
        _submitEvidence();

        bytes memory unauthorizedProducer = abi.encodeWithSignature(
            "AccessControlUnauthorizedAccount(address,bytes32)",
            producer,
            ATTESTOR_ROLE
        );
        vm.expectRevert(unauthorizedProducer);
        vm.prank(producer);
        this.attestAndSettle(TRADE_ID);

        bytes memory unauthorizedConsumer = abi.encodeWithSignature(
            "AccessControlUnauthorizedAccount(address,bytes32)",
            consumer,
            ATTESTOR_ROLE
        );
        vm.expectRevert(unauthorizedConsumer);
        vm.prank(consumer);
        this.resolveProducerDefault(TRADE_ID, EVIDENCE_HASH);
    }

    function test_fullSettlementRequiresEvidenceSubmission() public {
        _createEscrow();
        _fundAll();

        vm.expectRevert(EnergyTrade.InvalidStateTransition.selector);
        vm.prank(attestor);
        this.attestAndSettle(TRADE_ID);
    }

    function test_collateralRatioIsSnapshottedPerTrade() public {
        _createEscrow();
        this.setCollateralRatioBps(5_000);

        Escrow memory first = this.getEscrow(TRADE_ID);
        assertEq(first.collateralRatioBps, 10_000);
        assertEq(first.consumerCollateralRequired, TRADE_VALUE);

        vm.prank(operator);
        this.createEscrowTrade(
            9,
            producer,
            consumer,
            QUANTITY_MILLI,
            PRICE_UNITS,
            uint64(block.timestamp + 1 hours),
            uint64(block.timestamp + 2 hours)
        );
        Escrow memory second = this.getEscrow(9);
        assertEq(second.collateralRatioBps, 5_000);
        assertEq(second.consumerCollateralRequired, TRADE_VALUE / 2);
    }

    // ------------------------------------------------------------------
    // Fuzz / conservation
    // ------------------------------------------------------------------

    function testFuzz_partialSettlementConservesEveryUnit(
        uint96 quantityMilli,
        uint96 priceUnits,
        uint256 deliveredMilli
    ) public {
        quantityMilli = uint96(bound(quantityMilli, 1_000, QUANTITY_MILLI));
        priceUnits = uint96(bound(priceUnits, 1, PRICE_UNITS));
        deliveredMilli = bound(deliveredMilli, 1, quantityMilli - 1);

        _createEscrowWith(quantityMilli, priceUnits);
        _fundAll();
        _submitEvidence();

        Escrow memory before = this.getEscrow(TRADE_ID);
        uint256 producerBefore = settlement.balanceOf(producer);
        uint256 consumerBefore = settlement.balanceOf(consumer);
        uint256 locked = before.paymentRequired + before.consumerCollateralRequired + before.producerCollateralRequired;

        vm.prank(attestor);
        this.attestPartialDelivery(TRADE_ID, deliveredMilli);

        Escrow memory e = this.getEscrow(TRADE_ID);
        assertEq(uint8(e.outcome), uint8(EscrowOutcome.PartialDelivery));
        assertEq(e.deliveredKwhMilli, deliveredMilli);

        assertEq(e.paymentToProducer + e.paymentRefunded, e.paymentRequired, "payment conservation");
        assertEq(
            e.producerCollateralReturned + e.producerCollateralSlashed,
            e.producerCollateralRequired,
            "producer collateral conservation"
        );
        assertEq(e.consumerCollateralReturned, e.consumerCollateralRequired, "consumer collateral returned");
        assertLe(e.paymentToProducer, e.paymentRequired, "payment cannot exceed deposit");
        assertLe(e.producerCollateralSlashed, e.producerCollateralRequired, "slash cannot exceed collateral");

        assertEq(
            settlement.balanceOf(producer) - producerBefore,
            e.paymentToProducer + e.producerCollateralReturned,
            "producer received flows"
        );
        assertEq(
            settlement.balanceOf(consumer) - consumerBefore,
            e.paymentRefunded + e.producerCollateralSlashed + e.consumerCollateralReturned,
            "consumer received flows"
        );
        assertEq(
            (settlement.balanceOf(producer) - producerBefore) +
                (settlement.balanceOf(consumer) - consumerBefore),
            locked,
            "no tokens created or destroyed"
        );
        assertEq(reward.balanceOf(producer), (deliveredMilli * 1e18) / 1000, "reward tracks delivered energy");
        _assertContractEmpty();
    }
}

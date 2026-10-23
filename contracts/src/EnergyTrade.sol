// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {GreenRewardToken} from "./GreenRewardToken.sol";

/// @title Tranergy AI energy trade + mutual-stake escrow
/// @notice Records trades, keeps delivery evidence, and (for escrow trades) locks the
///         consumer payment plus collateral from both parties until an attestor resolves
///         delivery. The legacy non-escrow path is retained for old deployments / local
///         demos where no settlement token is configured.
contract EnergyTrade is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    uint16 public constant BPS_DENOMINATOR = 10_000;
    uint16 public constant MAX_COLLATERAL_RATIO_BPS = 20_000; // 200%
    uint64 public constant MAX_GRACE_PERIOD = 30 days;

    uint8 private constant KIND_CONSUMER_PAYMENT = 0;
    uint8 private constant KIND_CONSUMER_COLLATERAL = 1;
    uint8 private constant KIND_PRODUCER_COLLATERAL = 2;

    enum TradeState {
        None,
        Matched,
        EvidenceSubmitted,
        Settled,
        Disputed,
        DeliveryActive,
        Cancelled,
        Defaulted,
        PartiallySettled
    }

    enum EscrowOutcome {
        None,
        FullDelivery,
        PartialDelivery,
        ProducerDefault,
        Cancelled
    }

    struct Trade {
        address producer;
        address consumer;
        uint96 quantityKwh;
        uint96 pricePerKwhWei;
        TradeState state;
        bytes32 evidenceHash;
        address attestedBy;
        uint64 createdAt;
        uint64 settledAt;
        bool rewardMinted;
    }

    /// @notice Mutual-stake escrow terms and running accounting for one trade.
    /// @dev `pricePerKwhUnits` is denominated in settlement-token base units per whole kWh.
    ///      `quantityKwhMilli` allows three decimal places of kWh without floating point.
    struct Escrow {
        bool enabled;
        uint16 collateralRatioBps;
        uint64 fundingDeadline;
        uint64 deliveryDeadline;
        uint64 gracePeriod;
        uint64 activatedAt;
        uint64 settledAt;
        uint96 quantityKwhMilli;
        uint96 pricePerKwhUnits;
        uint256 tradeValue;
        uint256 paymentRequired;
        uint256 consumerCollateralRequired;
        uint256 producerCollateralRequired;
        uint256 paymentFunded;
        uint256 consumerCollateralFunded;
        uint256 producerCollateralFunded;
        uint256 deliveredKwhMilli;
        uint256 paymentToProducer;
        uint256 paymentRefunded;
        uint256 producerCollateralReturned;
        uint256 producerCollateralSlashed;
        uint256 consumerCollateralReturned;
        bytes32 disputeReason;
        bytes32 resolutionEvidenceHash;
        EscrowOutcome outcome;
    }

    error TradeExists();
    error TradeNotFound();
    error ZeroAddress();
    error InvalidQuantity();
    error InvalidPrice();
    error InvalidStateTransition();
    error EmptyEvidenceHash();
    error EscrowDisabled();
    error EscrowNotFunded();
    error FundingExpired();
    error InvalidDeadline();
    error InvalidCollateralRatio();
    error InvalidGracePeriod();
    error NotParticipant();
    error DuplicateDeposit();
    error InvalidDeliveryQuantity();
    error DeadlineNotReached();
    error AlreadyResolved();
    error InvalidOutcome();
    error EmptyReason();
    error SameParticipant();

    event TradeCreated(
        uint256 indexed tradeId,
        address producer,
        address consumer,
        uint96 quantityKwh,
        uint96 pricePerKwhWei
    );
    event EscrowTradeCreated(
        uint256 indexed tradeId,
        address indexed producer,
        address indexed consumer,
        uint256 quantityKwhMilli,
        uint256 pricePerKwhUnits,
        uint256 tradeValue,
        uint256 consumerPaymentRequired,
        uint256 consumerCollateralRequired,
        uint256 producerCollateralRequired,
        uint64 fundingDeadline,
        uint64 deliveryDeadline,
        uint16 collateralRatioBps,
        uint64 gracePeriod
    );
    event EvidenceSubmitted(uint256 indexed tradeId, bytes32 evidenceHash, address submittedBy);
    event TradeSettled(uint256 indexed tradeId, address attestedBy);
    event RewardMinted(uint256 indexed tradeId, address producer, uint256 amount);
    event TradeDisputed(uint256 indexed tradeId, bytes32 reason);
    event EscrowDeposited(
        uint256 indexed tradeId,
        address indexed payer,
        uint8 indexed kind,
        uint256 amount,
        uint256 totalFunded
    );
    event EscrowFunded(uint256 indexed tradeId, uint256 totalLocked, uint64 activatedAt);
    event DeliveryActivated(uint256 indexed tradeId, uint64 activatedAt);
    event EscrowSettled(
        uint256 indexed tradeId,
        EscrowOutcome outcome,
        uint256 paymentToProducer,
        uint256 paymentRefunded,
        uint256 producerCollateralReturned,
        uint256 producerCollateralSlashed,
        uint256 consumerCollateralReturned,
        uint256 deliveredKwhMilli,
        address indexed attestedBy
    );
    event EscrowDisputeRaised(uint256 indexed tradeId, address indexed raisedBy, bytes32 reason);
    event EscrowDisputeResolved(
        uint256 indexed tradeId,
        EscrowOutcome outcome,
        bytes32 reason,
        bytes32 evidenceHash,
        address indexed attestedBy
    );
    event EscrowCancelled(uint256 indexed tradeId, uint256 refundedToConsumer, uint256 refundedToProducer);
    event EscrowRefunded(uint256 indexed tradeId, address indexed recipient, uint8 indexed kind, uint256 amount);
    event CollateralRatioUpdated(uint16 bps);
    event DefaultGracePeriodUpdated(uint64 graceSeconds);

    GreenRewardToken public immutable rewardToken;
    IERC20 public immutable settlementToken;
    uint16 public collateralRatioBps;
    uint64 public defaultGracePeriod;

    mapping(uint256 => Trade) private trades;
    mapping(uint256 => Escrow) private escrows;
    mapping(uint256 => bytes32) public disputeReason;

    constructor(
        address rewardTokenAddress,
        address settlementTokenAddress,
        uint16 initialCollateralRatioBps,
        uint64 initialGracePeriod
    ) {
        if (rewardTokenAddress == address(0) || settlementTokenAddress == address(0)) revert ZeroAddress();
        if (initialCollateralRatioBps == 0 || initialCollateralRatioBps > MAX_COLLATERAL_RATIO_BPS) {
            revert InvalidCollateralRatio();
        }
        if (initialGracePeriod > MAX_GRACE_PERIOD) revert InvalidGracePeriod();

        rewardToken = GreenRewardToken(rewardTokenAddress);
        settlementToken = IERC20(settlementTokenAddress);
        collateralRatioBps = initialCollateralRatioBps;
        defaultGracePeriod = initialGracePeriod;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ---------------------------------------------------------------------
    // Trade registration
    // ---------------------------------------------------------------------

    /// @notice Legacy registration used by older deployments and non-escrow demos.
    function createTrade(
        uint256 tradeId,
        address producer,
        address consumer,
        uint96 quantityKwh,
        uint96 pricePerKwhWei
    ) external onlyRole(OPERATOR_ROLE) {
        _assertNewTrade(tradeId, producer, consumer);
        if (quantityKwh == 0) revert InvalidQuantity();

        trades[tradeId] = Trade({
            producer: producer,
            consumer: consumer,
            quantityKwh: quantityKwh,
            pricePerKwhWei: pricePerKwhWei,
            state: TradeState.Matched,
            evidenceHash: bytes32(0),
            attestedBy: address(0),
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            rewardMinted: false
        });

        emit TradeCreated(tradeId, producer, consumer, quantityKwh, pricePerKwhWei);
    }

    /// @notice Registers an escrow-backed trade. All monetary inputs are integers in
    ///         settlement-token base units (no floating point anywhere on-chain).
    function createEscrowTrade(
        uint256 tradeId,
        address producer,
        address consumer,
        uint96 quantityKwhMilli,
        uint96 pricePerKwhUnits,
        uint64 fundingDeadline,
        uint64 deliveryDeadline
    ) external onlyRole(OPERATOR_ROLE) {
        _assertNewTrade(tradeId, producer, consumer);
        if (quantityKwhMilli == 0) revert InvalidQuantity();
        if (pricePerKwhUnits == 0) revert InvalidPrice();
        if (fundingDeadline <= block.timestamp || deliveryDeadline <= fundingDeadline) {
            revert InvalidDeadline();
        }

        uint256 tradeValue = Math.mulDiv(quantityKwhMilli, pricePerKwhUnits, 1000);
        if (tradeValue == 0) revert InvalidPrice();

        uint16 ratio = collateralRatioBps;
        uint256 consumerCollateral = Math.mulDiv(tradeValue, ratio, BPS_DENOMINATOR);
        uint256 producerCollateral = consumerCollateral;
        if (consumerCollateral == 0) revert InvalidCollateralRatio();

        trades[tradeId] = Trade({
            producer: producer,
            consumer: consumer,
            quantityKwh: uint96((quantityKwhMilli + 999) / 1000),
            pricePerKwhWei: pricePerKwhUnits,
            state: TradeState.Matched,
            evidenceHash: bytes32(0),
            attestedBy: address(0),
            createdAt: uint64(block.timestamp),
            settledAt: 0,
            rewardMinted: false
        });

        escrows[tradeId] = Escrow({
            enabled: true,
            collateralRatioBps: ratio,
            fundingDeadline: fundingDeadline,
            deliveryDeadline: deliveryDeadline,
            gracePeriod: defaultGracePeriod,
            activatedAt: 0,
            settledAt: 0,
            quantityKwhMilli: quantityKwhMilli,
            pricePerKwhUnits: pricePerKwhUnits,
            tradeValue: tradeValue,
            paymentRequired: tradeValue,
            consumerCollateralRequired: consumerCollateral,
            producerCollateralRequired: producerCollateral,
            paymentFunded: 0,
            consumerCollateralFunded: 0,
            producerCollateralFunded: 0,
            deliveredKwhMilli: 0,
            paymentToProducer: 0,
            paymentRefunded: 0,
            producerCollateralReturned: 0,
            producerCollateralSlashed: 0,
            consumerCollateralReturned: 0,
            disputeReason: bytes32(0),
            resolutionEvidenceHash: bytes32(0),
            outcome: EscrowOutcome.None
        });

        emit EscrowTradeCreated(
            tradeId,
            producer,
            consumer,
            quantityKwhMilli,
            pricePerKwhUnits,
            tradeValue,
            tradeValue,
            consumerCollateral,
            producerCollateral,
            fundingDeadline,
            deliveryDeadline,
            ratio,
            defaultGracePeriod
        );
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    function depositConsumerPayment(uint256 tradeId) external nonReentrant {
        _deposit(tradeId, KIND_CONSUMER_PAYMENT);
    }

    function depositConsumerCollateral(uint256 tradeId) external nonReentrant {
        _deposit(tradeId, KIND_CONSUMER_COLLATERAL);
    }

    function depositProducerCollateral(uint256 tradeId) external nonReentrant {
        _deposit(tradeId, KIND_PRODUCER_COLLATERAL);
    }

    function _deposit(uint256 tradeId, uint8 kind) internal {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (!escrow.enabled) revert EscrowDisabled();
        if (trade.state != TradeState.Matched) revert InvalidStateTransition();
        if (block.timestamp > escrow.fundingDeadline) revert FundingExpired();

        uint256 amount;
        address payer;
        if (kind == KIND_CONSUMER_PAYMENT) {
            if (msg.sender != trade.consumer) revert NotParticipant();
            if (escrow.paymentFunded != 0) revert DuplicateDeposit();
            amount = escrow.paymentRequired;
            escrow.paymentFunded = amount;
            payer = trade.consumer;
        } else if (kind == KIND_CONSUMER_COLLATERAL) {
            if (msg.sender != trade.consumer) revert NotParticipant();
            if (escrow.consumerCollateralFunded != 0) revert DuplicateDeposit();
            amount = escrow.consumerCollateralRequired;
            escrow.consumerCollateralFunded = amount;
            payer = trade.consumer;
        } else if (kind == KIND_PRODUCER_COLLATERAL) {
            if (msg.sender != trade.producer) revert NotParticipant();
            if (escrow.producerCollateralFunded != 0) revert DuplicateDeposit();
            amount = escrow.producerCollateralRequired;
            escrow.producerCollateralFunded = amount;
            payer = trade.producer;
        } else {
            revert InvalidOutcome();
        }

        // State is updated before the external call; a failed transfer reverts all of it.
        settlementToken.safeTransferFrom(payer, address(this), amount);

        uint256 totalFunded = escrow.paymentFunded +
            escrow.consumerCollateralFunded +
            escrow.producerCollateralFunded;
        emit EscrowDeposited(tradeId, payer, kind, amount, totalFunded);

        _maybeActivateDelivery(tradeId, trade, escrow, totalFunded);
    }

    function _maybeActivateDelivery(
        uint256 tradeId,
        Trade storage trade,
        Escrow storage escrow,
        uint256 totalFunded
    ) internal {
        if (
            escrow.paymentFunded == escrow.paymentRequired &&
            escrow.consumerCollateralFunded == escrow.consumerCollateralRequired &&
            escrow.producerCollateralFunded == escrow.producerCollateralRequired
        ) {
            trade.state = TradeState.DeliveryActive;
            escrow.activatedAt = uint64(block.timestamp);
            emit EscrowFunded(tradeId, totalFunded, escrow.activatedAt);
            emit DeliveryActivated(tradeId, escrow.activatedAt);
        }
    }

    /// @notice Refunds deposits from a trade that was not fully funded before its deadline.
    /// @dev Permissionless: it can only return funds to the original depositors.
    function cancelExpiredEscrow(uint256 tradeId) external nonReentrant {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (!escrow.enabled) revert EscrowDisabled();
        if (trade.state != TradeState.Matched) revert InvalidStateTransition();
        if (block.timestamp <= escrow.fundingDeadline) revert InvalidStateTransition();

        uint256 toConsumer = escrow.paymentFunded + escrow.consumerCollateralFunded;
        uint256 toProducer = escrow.producerCollateralFunded;

        trade.state = TradeState.Cancelled;
        trade.settledAt = uint64(block.timestamp);
        escrow.outcome = EscrowOutcome.Cancelled;
        escrow.settledAt = uint64(block.timestamp);

        if (toConsumer > 0) {
            settlementToken.safeTransfer(trade.consumer, toConsumer);
            emit EscrowRefunded(tradeId, trade.consumer, KIND_CONSUMER_PAYMENT, toConsumer);
        }
        if (toProducer > 0) {
            settlementToken.safeTransfer(trade.producer, toProducer);
            emit EscrowRefunded(tradeId, trade.producer, KIND_PRODUCER_COLLATERAL, toProducer);
        }

        emit EscrowCancelled(tradeId, toConsumer, toProducer);
    }

    // ---------------------------------------------------------------------
    // Evidence + settlement
    // ---------------------------------------------------------------------

    function submitEvidence(uint256 tradeId, bytes32 evidenceHash) external onlyRole(OPERATOR_ROLE) {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (escrow.enabled) {
            if (trade.state != TradeState.DeliveryActive) revert InvalidStateTransition();
        } else if (trade.state != TradeState.Matched) {
            revert InvalidStateTransition();
        }
        if (evidenceHash == bytes32(0)) revert EmptyEvidenceHash();

        trade.state = TradeState.EvidenceSubmitted;
        trade.evidenceHash = evidenceHash;

        emit EvidenceSubmitted(tradeId, evidenceHash, msg.sender);
    }

    /// @notice Full delivery settlement. For escrow trades the caller must be an attestor
    ///         and the trade must be funded and evidence-submitted.
    function attestAndSettle(uint256 tradeId) external onlyRole(ATTESTOR_ROLE) nonReentrant {
        Trade storage trade = _storedTrade(tradeId);
        if (trade.state != TradeState.EvidenceSubmitted) revert InvalidStateTransition();

        Escrow storage escrow = escrows[tradeId];
        if (escrow.enabled) {
            _settleFull(tradeId, trade, escrow, msg.sender);
            return;
        }

        trade.state = TradeState.Settled;
        trade.attestedBy = msg.sender;
        trade.settledAt = uint64(block.timestamp);

        emit TradeSettled(tradeId, msg.sender);
        _mintReward(tradeId, trade, uint256(trade.quantityKwh) * 1e18);
    }

    /// @notice Attestor-confirmed partial delivery, using the verified delivered quantity.
    function attestPartialDelivery(uint256 tradeId, uint256 deliveredKwhMilli)
        external
        onlyRole(ATTESTOR_ROLE)
        nonReentrant
    {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (!escrow.enabled) revert EscrowDisabled();
        if (trade.state != TradeState.EvidenceSubmitted) revert InvalidStateTransition();
        if (deliveredKwhMilli == 0 || deliveredKwhMilli >= escrow.quantityKwhMilli) {
            revert InvalidDeliveryQuantity();
        }

        _settlePartial(tradeId, trade, escrow, deliveredKwhMilli, msg.sender);
    }

    /// @notice Attestor-confirmed non-delivery. Can only run after the agreed delivery
    ///         deadline plus the trade's grace period, even if no evidence was submitted.
    function resolveProducerDefault(uint256 tradeId, bytes32 evidenceHash)
        external
        onlyRole(ATTESTOR_ROLE)
        nonReentrant
    {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (!escrow.enabled) revert EscrowDisabled();
        if (trade.state != TradeState.DeliveryActive && trade.state != TradeState.EvidenceSubmitted) {
            revert InvalidStateTransition();
        }
        _requireDeliveryWindowClosed(escrow);

        escrow.resolutionEvidenceHash = evidenceHash;
        _settleProducerDefault(tradeId, trade, escrow, msg.sender);
    }

    function _settleFull(
        uint256 tradeId,
        Trade storage trade,
        Escrow storage escrow,
        address attestor
    ) internal {
        _recordAndPay(
            tradeId,
            trade,
            escrow,
            EscrowOutcome.FullDelivery,
            escrow.quantityKwhMilli,
            escrow.paymentRequired,
            0,
            escrow.producerCollateralRequired,
            0,
            attestor
        );
    }

    function _settlePartial(
        uint256 tradeId,
        Trade storage trade,
        Escrow storage escrow,
        uint256 deliveredKwhMilli,
        address attestor
    ) internal {
        uint256 agreed = escrow.quantityKwhMilli;
        uint256 paymentForDelivered = Math.mulDiv(escrow.tradeValue, deliveredKwhMilli, agreed);
        uint256 paymentRefund = escrow.tradeValue - paymentForDelivered;
        uint256 slashed = Math.mulDiv(
            escrow.producerCollateralRequired,
            agreed - deliveredKwhMilli,
            agreed
        );
        uint256 returned = escrow.producerCollateralRequired - slashed;

        _recordAndPay(
            tradeId,
            trade,
            escrow,
            EscrowOutcome.PartialDelivery,
            deliveredKwhMilli,
            paymentForDelivered,
            paymentRefund,
            returned,
            slashed,
            attestor
        );
    }

    function _settleProducerDefault(
        uint256 tradeId,
        Trade storage trade,
        Escrow storage escrow,
        address attestor
    ) internal {
        _recordAndPay(
            tradeId,
            trade,
            escrow,
            EscrowOutcome.ProducerDefault,
            0,
            0,
            escrow.paymentRequired,
            0,
            escrow.producerCollateralRequired,
            attestor
        );
    }

    function _recordAndPay(
        uint256 tradeId,
        Trade storage trade,
        Escrow storage escrow,
        EscrowOutcome outcome,
        uint256 deliveredKwhMilli,
        uint256 paymentToProducer,
        uint256 paymentRefund,
        uint256 producerCollateralReturned,
        uint256 producerCollateralSlashed,
        address attestor
    ) internal {
        uint256 consumerCollateralReturned = escrow.consumerCollateralRequired;

        // Effects first; any failed token transfer below reverts this entire block.
        escrow.deliveredKwhMilli = deliveredKwhMilli;
        escrow.paymentToProducer = paymentToProducer;
        escrow.paymentRefunded = paymentRefund;
        escrow.producerCollateralReturned = producerCollateralReturned;
        escrow.producerCollateralSlashed = producerCollateralSlashed;
        escrow.consumerCollateralReturned = consumerCollateralReturned;
        escrow.outcome = outcome;
        escrow.settledAt = uint64(block.timestamp);

        trade.attestedBy = attestor;
        trade.settledAt = uint64(block.timestamp);
        if (outcome == EscrowOutcome.FullDelivery) {
            trade.state = TradeState.Settled;
        } else if (outcome == EscrowOutcome.PartialDelivery) {
            trade.state = TradeState.PartiallySettled;
        } else {
            trade.state = TradeState.Defaulted;
        }

        uint256 producerAmount = paymentToProducer + producerCollateralReturned;
        uint256 consumerAmount = paymentRefund + consumerCollateralReturned + producerCollateralSlashed;

        if (producerAmount > 0) {
            settlementToken.safeTransfer(trade.producer, producerAmount);
        }
        if (consumerAmount > 0) {
            settlementToken.safeTransfer(trade.consumer, consumerAmount);
        }

        if (outcome == EscrowOutcome.FullDelivery || outcome == EscrowOutcome.PartialDelivery) {
            _mintReward(tradeId, trade, Math.mulDiv(deliveredKwhMilli, 1e18, 1000));
        }

        emit EscrowSettled(
            tradeId,
            outcome,
            paymentToProducer,
            paymentRefund,
            producerCollateralReturned,
            producerCollateralSlashed,
            consumerCollateralReturned,
            deliveredKwhMilli,
            attestor
        );
    }

    function _mintReward(uint256 tradeId, Trade storage trade, uint256 amount) internal {
        if (trade.rewardMinted || amount == 0) return;
        trade.rewardMinted = true;
        address producer = trade.producer;
        rewardToken.mint(producer, amount);
        emit RewardMinted(tradeId, producer, amount);
    }

    // ---------------------------------------------------------------------
    // Disputes
    // ---------------------------------------------------------------------

    /// @notice Operational dispute entry point retained for the existing verifier flow.
    function dispute(uint256 tradeId, bytes32 reason) external onlyRole(ATTESTOR_ROLE) {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (escrow.enabled) {
            if (trade.state != TradeState.DeliveryActive && trade.state != TradeState.EvidenceSubmitted) {
                revert InvalidStateTransition();
            }
            if (escrow.outcome != EscrowOutcome.None) revert AlreadyResolved();
            escrow.disputeReason = reason;
            emit EscrowDisputeRaised(tradeId, msg.sender, reason);
        } else if (trade.state != TradeState.Matched && trade.state != TradeState.EvidenceSubmitted) {
            revert InvalidStateTransition();
        }

        trade.state = TradeState.Disputed;
        disputeReason[tradeId] = reason;

        emit TradeDisputed(tradeId, reason);
    }

    /// @notice Either trade participant can freeze an active escrow while it is reviewed.
    function raiseDispute(uint256 tradeId, bytes32 reason) external {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (!escrow.enabled) revert EscrowDisabled();
        if (msg.sender != trade.producer && msg.sender != trade.consumer) revert NotParticipant();
        if (trade.state != TradeState.DeliveryActive && trade.state != TradeState.EvidenceSubmitted) {
            revert InvalidStateTransition();
        }
        if (escrow.outcome != EscrowOutcome.None) revert AlreadyResolved();
        if (reason == bytes32(0)) revert EmptyReason();

        trade.state = TradeState.Disputed;
        escrow.disputeReason = reason;
        disputeReason[tradeId] = reason;

        emit EscrowDisputeRaised(tradeId, msg.sender, reason);
        emit TradeDisputed(tradeId, reason);
    }

    /// @notice Attestor resolves a frozen dispute. The outcome must still obey the normal
    ///         evidence / deadline rules; no arbitrary confiscation path exists.
    function resolveDispute(
        uint256 tradeId,
        EscrowOutcome outcome,
        uint256 deliveredKwhMilli,
        bytes32 reason,
        bytes32 evidenceHash
    ) external onlyRole(ATTESTOR_ROLE) nonReentrant {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        if (!escrow.enabled) revert EscrowDisabled();
        if (trade.state != TradeState.Disputed) revert InvalidStateTransition();
        if (escrow.outcome != EscrowOutcome.None) revert AlreadyResolved();
        if (reason == bytes32(0)) revert EmptyReason();

        escrow.disputeReason = reason;
        escrow.resolutionEvidenceHash = evidenceHash;

        if (outcome == EscrowOutcome.FullDelivery) {
            _settleFull(tradeId, trade, escrow, msg.sender);
        } else if (outcome == EscrowOutcome.PartialDelivery) {
            if (deliveredKwhMilli == 0 || deliveredKwhMilli >= escrow.quantityKwhMilli) {
                revert InvalidDeliveryQuantity();
            }
            _settlePartial(tradeId, trade, escrow, deliveredKwhMilli, msg.sender);
        } else if (outcome == EscrowOutcome.ProducerDefault) {
            _requireDeliveryWindowClosed(escrow);
            _settleProducerDefault(tradeId, trade, escrow, msg.sender);
        } else {
            revert InvalidOutcome();
        }

        emit EscrowDisputeResolved(tradeId, outcome, reason, evidenceHash, msg.sender);
    }

    function _requireDeliveryWindowClosed(Escrow storage escrow) internal view {
        uint256 deadline = uint256(escrow.deliveryDeadline) + uint256(escrow.gracePeriod);
        if (block.timestamp < deadline) revert DeadlineNotReached();
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setCollateralRatioBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps == 0 || bps > MAX_COLLATERAL_RATIO_BPS) revert InvalidCollateralRatio();
        collateralRatioBps = bps;
        emit CollateralRatioUpdated(bps);
    }

    function setDefaultGracePeriod(uint64 graceSeconds) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (graceSeconds > MAX_GRACE_PERIOD) revert InvalidGracePeriod();
        defaultGracePeriod = graceSeconds;
        emit DefaultGracePeriodUpdated(graceSeconds);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return _storedTrade(tradeId);
    }

    function getEscrow(uint256 tradeId) external view returns (Escrow memory) {
        _storedTrade(tradeId);
        return escrows[tradeId];
    }

    function getEscrowFunding(uint256 tradeId)
        external
        view
        returns (
            bool enabled,
            uint256 paymentRequired,
            uint256 paymentFunded,
            uint256 consumerCollateralRequired,
            uint256 consumerCollateralFunded,
            uint256 producerCollateralRequired,
            uint256 producerCollateralFunded,
            bool fullyFunded,
            TradeState state,
            uint64 fundingDeadline,
            uint64 deliveryDeadline,
            uint64 gracePeriod
        )
    {
        Trade storage trade = _storedTrade(tradeId);
        Escrow storage escrow = escrows[tradeId];
        enabled = escrow.enabled;
        paymentRequired = escrow.paymentRequired;
        paymentFunded = escrow.paymentFunded;
        consumerCollateralRequired = escrow.consumerCollateralRequired;
        consumerCollateralFunded = escrow.consumerCollateralFunded;
        producerCollateralRequired = escrow.producerCollateralRequired;
        producerCollateralFunded = escrow.producerCollateralFunded;
        fullyFunded =
            escrow.paymentFunded == paymentRequired &&
            escrow.consumerCollateralFunded == consumerCollateralRequired &&
            escrow.producerCollateralFunded == producerCollateralRequired;
        state = trade.state;
        fundingDeadline = escrow.fundingDeadline;
        deliveryDeadline = escrow.deliveryDeadline;
        gracePeriod = escrow.gracePeriod;
    }

    function escrowBalances(uint256 tradeId)
        external
        view
        returns (
            uint256 payment,
            uint256 consumerCollateral,
            uint256 producerCollateral,
            uint256 total
        )
    {
        Escrow storage escrow = escrows[tradeId];
        if (!escrow.enabled) return (0, 0, 0, 0);

        uint256 paidOut = escrow.paymentToProducer +
            escrow.paymentRefunded +
            escrow.producerCollateralReturned +
            escrow.producerCollateralSlashed +
            escrow.consumerCollateralReturned;
        uint256 funded = escrow.paymentFunded +
            escrow.consumerCollateralFunded +
            escrow.producerCollateralFunded;

        payment = escrow.paymentFunded;
        consumerCollateral = escrow.consumerCollateralFunded;
        producerCollateral = escrow.producerCollateralFunded;
        total = funded - paidOut;
    }

    function _assertNewTrade(uint256 tradeId, address producer, address consumer) internal view {
        if (trades[tradeId].state != TradeState.None) revert TradeExists();
        if (producer == address(0) || consumer == address(0)) revert ZeroAddress();
        if (producer == consumer) revert SameParticipant();
    }

    function _storedTrade(uint256 tradeId) internal view returns (Trade storage trade) {
        trade = trades[tradeId];
        if (trade.state == TradeState.None) revert TradeNotFound();
    }
}

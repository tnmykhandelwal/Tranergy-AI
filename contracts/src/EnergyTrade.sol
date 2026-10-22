// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GreenRewardToken} from "./GreenRewardToken.sol";

contract EnergyTrade is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ATTESTOR_ROLE = keccak256("ATTESTOR_ROLE");

    enum TradeState {
        None,
        Matched,
        EvidenceSubmitted,
        Settled,
        Disputed
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
    }

    error TradeExists();
    error TradeNotFound();
    error ZeroAddress();
    error InvalidQuantity();
    error InvalidStateTransition();
    error EmptyEvidenceHash();

    event TradeCreated(
        uint256 indexed tradeId,
        address producer,
        address consumer,
        uint96 quantityKwh,
        uint96 pricePerKwhWei
    );
    event EvidenceSubmitted(uint256 indexed tradeId, bytes32 evidenceHash, address submittedBy);
    event TradeSettled(uint256 indexed tradeId, address attestedBy);
    event RewardMinted(uint256 indexed tradeId, address producer, uint256 amount);
    event TradeDisputed(uint256 indexed tradeId, bytes32 reason);

    GreenRewardToken public immutable rewardToken;

    mapping(uint256 => Trade) private trades;
    mapping(uint256 => bytes32) public disputeReason;

    constructor(address token) {
        rewardToken = GreenRewardToken(token);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function createTrade(
        uint256 tradeId,
        address producer,
        address consumer,
        uint96 quantityKwh,
        uint96 pricePerKwhWei
    ) external onlyRole(OPERATOR_ROLE) {
        if (trades[tradeId].state != TradeState.None) revert TradeExists();
        if (producer == address(0) || consumer == address(0)) revert ZeroAddress();
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
            settledAt: 0
        });

        emit TradeCreated(tradeId, producer, consumer, quantityKwh, pricePerKwhWei);
    }

    function submitEvidence(uint256 tradeId, bytes32 evidenceHash) external onlyRole(OPERATOR_ROLE) {
        Trade storage trade = _storedTrade(tradeId);
        if (trade.state != TradeState.Matched) revert InvalidStateTransition();
        if (evidenceHash == bytes32(0)) revert EmptyEvidenceHash();

        trade.state = TradeState.EvidenceSubmitted;
        trade.evidenceHash = evidenceHash;

        emit EvidenceSubmitted(tradeId, evidenceHash, msg.sender);
    }

    function attestAndSettle(uint256 tradeId) external onlyRole(ATTESTOR_ROLE) nonReentrant {
        Trade storage trade = _storedTrade(tradeId);
        if (trade.state != TradeState.EvidenceSubmitted) revert InvalidStateTransition();

        trade.state = TradeState.Settled;
        trade.attestedBy = msg.sender;
        trade.settledAt = uint64(block.timestamp);

        emit TradeSettled(tradeId, msg.sender);

        uint256 amount = uint256(trade.quantityKwh) * 1e18;
        address producer = trade.producer;
        rewardToken.mint(producer, amount);

        emit RewardMinted(tradeId, producer, amount);
    }

    function dispute(uint256 tradeId, bytes32 reason) external onlyRole(ATTESTOR_ROLE) {
        Trade storage trade = _storedTrade(tradeId);
        if (trade.state != TradeState.Matched && trade.state != TradeState.EvidenceSubmitted) {
            revert InvalidStateTransition();
        }

        trade.state = TradeState.Disputed;
        disputeReason[tradeId] = reason;

        emit TradeDisputed(tradeId, reason);
    }

    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return _storedTrade(tradeId);
    }

    function _storedTrade(uint256 tradeId) internal view returns (Trade storage trade) {
        trade = trades[tradeId];
        if (trade.state == TradeState.None) revert TradeNotFound();
    }
}

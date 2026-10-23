// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Local-only settlement asset for the mutual-stake escrow demo.
/// @dev Six decimals mirrors a typical stablecoin. This token has no real value.
contract MockSettlementToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant FAUCET_AMOUNT = 1_000_000 * 10 ** 6;

    event Faucet(address indexed recipient, uint256 amount);

    constructor(address initialAdmin) ERC20("Tranergy Test Settlement", "TSTR") {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    }

    /// @dev Six decimals mirrors a typical stablecoin and keeps escrow quotes compact.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @notice Permissionless local faucet. Test asset only; never deploy on mainnet.
    function faucet() external {
        _mint(msg.sender, FAUCET_AMOUNT);
        emit Faucet(msg.sender, FAUCET_AMOUNT);
    }
}

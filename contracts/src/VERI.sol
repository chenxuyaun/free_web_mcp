// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title VERI — Verifiable Evidence Test Token
/// @notice Standard BEP-20 (BSC) / ERC-20 compatible token for the Free Web MCP
///         evidence network. Testnet only. Used for validator & challenge
///         rewards (spec §24-§26). No DEX, no liquidity, no public sale.
/// @dev Bitcoin-style emission: ZERO premine — totalSupply starts at 0 and
///      grows only through reward minting (owner mints per validator/challenge
///      reward). No coins exist until someone earns them.
contract VERI {
    string public constant name = "Verifiable Evidence";
    string public constant symbol = "VERI";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner_, address indexed spender, uint256 value);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "VERI: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
        // No initial supply — all VERI enters circulation via mint() rewards.
    }

    // ---------- ERC-20 / BEP-20 core ----------

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "VERI: allowance exceeded");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    // ---------- Mint / burn (reward mechanics, spec §26) ----------

    /// @notice Mint new VERI to `to` (rewards). Owner only.
    function mint(address to, uint256 value) external onlyOwner returns (bool) {
        _mint(to, value);
        return true;
    }

    /// @notice Burn VERI from the caller.
    function burn(uint256 value) external {
        _burn(msg.sender, value);
    }

    /// @notice Burn VERI from a holder with allowance (challenge slashing).
    function burnFrom(address from, uint256 value) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "VERI: allowance exceeded");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _burn(from, value);
    }

    // ---------- Ownership ----------

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "VERI: zero address");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    // ---------- Internals ----------

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "VERI: transfer to zero");
        require(balanceOf[from] >= value, "VERI: insufficient balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }

    function _mint(address to, uint256 value) internal {
        require(to != address(0), "VERI: mint to zero");
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function _burn(address from, uint256 value) internal {
        require(balanceOf[from] >= value, "VERI: insufficient balance");
        balanceOf[from] -= value;
        totalSupply -= value;
        emit Transfer(from, address(0), value);
    }
}

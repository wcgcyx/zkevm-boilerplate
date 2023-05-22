// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@imtbl/zkevm-contracts/contracts/token/erc721/preset/ImmutableERC721PermissionedMintable.sol";

contract MyERC721 is ImmutableERC721PermissionedMintable {
    ///     =====   Data structures  =====

    /// @dev State for lease of ERC721
    struct LeaseState {
        // Index of this lease state in the leased ids array
        uint256 index;

        // Lender address
        address lender;
        // Accepted ERC20 token address
        address paymentTokenAddr;
        // Lease price
        uint256 leasePrice;
        // Lease period in seconds
        uint256 leasePeriod;
        // Collateral
        uint256 collateral;

        // Boolean indicating whether lease is active
        bool active;
        // Renter address
        address renter;
        // Lease start time in unix seconds
        uint256 startTime;
    }

    ///     =====   State Variables  =====

    /// @dev Mapping from <lender, tokenId> to the state of a lease
    mapping(uint256 => LeaseState) public leaseStates;

    /// @dev Array storing all leased Ids
    uint256[] public leasedIds;

    ///     =====   Constructor  =====
    /// @dev Construct a rentable ImmutableERC721PermissionedMintable.
    constructor(
        address owner,
        string memory name,
        string memory symbol,
        string memory baseURI,
        string memory contractURI,
        address receiver, 
        uint96 feeNumerator
    )
        ImmutableERC721PermissionedMintable(
            owner,
            name,
            symbol,
            baseURI,
            contractURI,
            receiver,
            feeNumerator
        )
    {}

    ///     =====  External functions  =====

    /// @dev Allows a token owner to list a token for lease or update a current lease.
    function listOrUpdateLease(
        uint256 tokenId,
        address paymentTokenAddr,
        uint256 leasePrice,
        uint256 leasePeriod,
        uint256 collateral
    ) external {
        address sender = _msgSender();

        // Make sure the message sender is the current owner of the given token
        require(sender == super.ownerOf(tokenId), "Only owner is allowed to list");

        // Make sure this contract has operator permission over the given token
        require(address(this) == super.getApproved(tokenId), "Contract does not have operator permission");

        // Upsert lease states
        if (leaseStates[tokenId].lender == address(0)) {
            leaseStates[tokenId].index = leasedIds.length;
            leasedIds.push(tokenId);
        } else {
            // Make sure sender is not sub-leasing
            require(!leaseStates[tokenId].active, "Sub-leasing is not allowed");
        }
        leaseStates[tokenId].lender = sender;
        leaseStates[tokenId].paymentTokenAddr = paymentTokenAddr;
        leaseStates[tokenId].leasePrice = leasePrice;
        leaseStates[tokenId].leasePeriod = leasePeriod;
        leaseStates[tokenId].collateral = collateral;
        leaseStates[tokenId].active = false;
        leaseStates[tokenId].renter = address(0);
        leaseStates[tokenId].startTime = 0;
    }

    /// @dev Allows a token owner to unlist a token.
    function unlistLease(uint256 tokenId) external {
        address sender = _msgSender();

        // Make sure the message sender is the current owner of the given token
        require(sender == super.ownerOf(tokenId), "Only owner is allowed to unlist");

        // Make sure the lease is not active
        require(!leaseStates[tokenId].active, "Cannot unlist an active lease");

        // Delete lease
        removeLease(tokenId);
    }

    /// @dev Attempt to lease a token.
    function leaseToken(uint256 tokenId) external {
        address renter = _msgSender();

        // Check if renter is the current owner of the nft
        require(renter != super.ownerOf(tokenId), "Owner is not allowed to lease");

        // Check if lease exists
        address lender = leaseStates[tokenId].lender;
        require(lender != address(0), "Token is not listed for lease");

        // Make lease payment
        IERC20 paymentContract = IERC20(leaseStates[tokenId].paymentTokenAddr);
        uint256 price = leaseStates[tokenId].leasePrice;
        if (!paymentContract.transferFrom(renter, lender, price)) {
            revert("Not enough tokens to pay lease");
        }

        // Make collateral payment
        uint256 collateral = leaseStates[tokenId].collateral;
        if (!paymentContract.transferFrom(renter, address(this), collateral)) {
            revert("Not enough tokens to pay collateral");
        }

        // Make NFT ownership transfer
        super._transfer(lender, renter, tokenId);

        // Update lease state
        leaseStates[tokenId].active = true;
        leaseStates[tokenId].renter = renter;
        leaseStates[tokenId].startTime = block.timestamp;
    }

    /// @dev Return leased token.
    function returnToken(uint256 tokenId) external {
        address renter = _msgSender();

        // Check if renter is the current renter of the nft.
        require(renter == leaseStates[tokenId].renter, "Only renter can return token");

        // Make NFT ownership transfer.
        address lender = leaseStates[tokenId].lender;
        super._transfer(renter, lender, tokenId);

        // Return collateral
        IERC20 paymentContract = IERC20(leaseStates[tokenId].paymentTokenAddr);
        uint256 collateral = leaseStates[tokenId].collateral;
        if (!paymentContract.transfer(renter, collateral)) {
            // This should never happen.
            revert("Not enough balance to pay collateral");
        }

        // Delete lease
        removeLease(tokenId);
    }

    /// @dev Claim collateral if token not returned before lease expiry.
    function claimCollateral(uint256 tokenId) external {
        address sender = _msgSender();

        // Make sure the message sender is the original lender
        require(sender == leaseStates[tokenId].lender, "Only lender is allowed to claim");

        // Make sure the lease has expired
        require(leaseStates[tokenId].startTime + leaseStates[tokenId].leasePeriod <= block.timestamp, "Lease is not expired");

        // Claim collateral
        IERC20 paymentContract = IERC20(leaseStates[tokenId].paymentTokenAddr);
        uint256 collateral = leaseStates[tokenId].collateral;
        if (!paymentContract.transfer(sender, collateral)) {
            // This should never happen.
            revert("Not enough balance to pay collateral");
        }

        // Delete lease
        removeLease(tokenId);
    }

    ///     =====  Private functions  =====
    
    /// @dev Remove a listing from the storage
    function removeLease(uint256 tokenId) private {
        if (leaseStates[tokenId].lender != address(0)) {
            // Swap this this element with the last element in the array
            uint256 current = leaseStates[tokenId].index;
            uint256 last = leasedIds.length - 1;
            leaseStates[leasedIds[last]].index = current;
            leasedIds[current] = leasedIds[last];
            leasedIds.pop();
            delete leaseStates[tokenId];
        }
    }
}

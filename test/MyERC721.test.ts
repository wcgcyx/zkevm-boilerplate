import { ethers } from "hardhat";
import { expect } from "chai";
import { MyERC20, MyERC721 } from "../typechain-types";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("MyERC721", function () {
  let erc721: MyERC721;
  let erc20: MyERC20;

  beforeEach(async function () {
    // get owner (first account)
    const [owner] = await ethers.getSigners();

    // deploy MyERC721 contract
    const MyERC721 = await ethers.getContractFactory("MyERC721");
    erc721 = await MyERC721.deploy(
      owner.address, // owner
      "Imaginary Immutable Iguanas", // name
      "III", // symbol
      "https://example-base-uri.com/", // baseURI
      "https://example-contract-uri.com/", // contractURI
      owner.address,
      ethers.BigNumber.from("2000")
    );
    await erc721.deployed();

    // deploy MyERC20 contract
    const MyERC20 = await ethers.getContractFactory("MyERC20");
    erc20 = await MyERC20.deploy(
      ethers.BigNumber.from("1000")
    );

    // grant owner the minter role
    await erc721.grantRole(await erc721.MINTER_ROLE(), owner.address);
  });

  it("Should be deployed with the correct arguments", async function () {
    expect(await erc721.name()).to.equal("Imaginary Immutable Iguanas");
    expect(await erc721.symbol()).to.equal("III");
    expect(await erc721.baseURI()).to.equal("https://example-base-uri.com/");
    expect(await erc721.contractURI()).to.equal(
      "https://example-contract-uri.com/"
    );
  });

  it("Account with minter role should be able to mint multiple NFTs", async function () {
    const [owner, recipient] = await ethers.getSigners();
    await erc721.connect(owner).mint(recipient.address, 5);
    expect(await erc721.balanceOf(recipient.address)).to.equal(5);
    expect(await erc721.ownerOf(1)).to.equal(recipient.address);
    expect(await erc721.ownerOf(2)).to.equal(recipient.address);
    expect(await erc721.ownerOf(3)).to.equal(recipient.address);
    expect(await erc721.ownerOf(4)).to.equal(recipient.address);
    expect(await erc721.ownerOf(5)).to.equal(recipient.address);
  });

  it("Account without minter role should not be able to mint NFTs", async function () {
    const [_, acc1] = await ethers.getSigners();
    const minterRole = await erc721.MINTER_ROLE();
    await expect(
      erc721.connect(acc1).mint(acc1.address, 1)
    ).to.be.revertedWith(
      `AccessControl: account 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 is missing role ${minterRole}`
    );
  });

  it("Only account with NFT with operator approved can list or update lease", async function() {
    const [owner, lender] = await ethers.getSigners();
    await erc721.connect(owner).mint(owner.address, 1);

    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.revertedWith(
      `Only owner is allowed to list`
    );

    await erc721.connect(owner).transferFrom(owner.address, lender.address, 1);
    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.revertedWith(
      `Contract does not have operator permission`
    );

    await erc721.connect(lender).approve(erc721.address, 1);
    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.not.reverted;
    
    expect((await erc721.leaseStates(1)).lender).to.equal(lender.address);
    expect((await erc721.leaseStates(1)).paymentTokenAddr).to.equal(erc20.address);
    expect((await erc721.leaseStates(1)).leasePrice).to.equal(10);
    expect((await erc721.leaseStates(1)).leasePeriod).to.equal(3600);
    expect((await erc721.leaseStates(1)).collateral).to.equal(100);

    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 20, 7200, 200)
    ).to.be.not.reverted;

    expect((await erc721.leaseStates(1)).leasePrice).to.equal(20);
    expect((await erc721.leaseStates(1)).leasePeriod).to.equal(7200);
    expect((await erc721.leaseStates(1)).collateral).to.equal(200);
  });

  it("Account should be able to rent and return NFT", async function() {
    const [owner, lender, renter] = await ethers.getSigners();
    await erc721.connect(owner).mint(lender.address, 1);
    await erc721.connect(lender).approve(erc721.address, 1);
    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.not.reverted;

    await expect(
      erc721.connect(renter).leaseToken(1)
    ).to.be.revertedWith(
      `ERC20: insufficient allowance`
    );

    await erc20.connect(owner).transfer(renter.address, 110);
    await erc20.connect(renter).approve(erc721.address, 110);
    
    expect(await erc721.ownerOf(1)).to.equal(lender.address);
    expect(await erc20.balanceOf(renter.address)).to.equal(110);
    expect(await erc20.balanceOf(lender.address)).to.equal(0);
    expect(await erc20.balanceOf(erc721.address)).to.equal(0);
    await expect(
      erc721.connect(renter).leaseToken(1)
    ).to.be.not.reverted;

    expect(await erc721.ownerOf(1)).to.equal(renter.address);
    expect(await erc20.balanceOf(renter.address)).to.equal(0);
    expect(await erc20.balanceOf(lender.address)).to.equal(10);
    expect(await erc20.balanceOf(erc721.address)).to.equal(100);

    await expect(
      erc721.connect(renter).returnToken(1)
    ).to.be.not.reverted;

    expect(await erc721.ownerOf(1)).to.equal(lender.address);
    expect(await erc20.balanceOf(renter.address)).to.equal(100);
    expect(await erc20.balanceOf(lender.address)).to.equal(10);
    expect(await erc20.balanceOf(erc721.address)).to.equal(0);
  });

  it("Account cannot rent NFT if it was listed first but transferred later", async function() {
    const [owner, lender, renter] = await ethers.getSigners();
    await erc721.connect(owner).mint(lender.address, 1);
    await erc721.connect(lender).approve(erc721.address, 1);
    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.not.reverted;
    await erc20.connect(owner).transfer(renter.address, 110);
    await erc20.connect(renter).approve(erc721.address, 110);

    await erc721.connect(lender).transferFrom(lender.address, owner.address, 1)
    await expect(
      erc721.connect(renter).leaseToken(1)
    ).to.be.revertedWith(
      `ERC721: transfer from incorrect owner`
    );

    // Renter will be able to lease if new owner list the NFT again
    await erc721.connect(owner).approve(erc721.address, 1);
    await expect(
      erc721.connect(owner).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.not.reverted;

    await expect(
      erc721.connect(renter).leaseToken(1)
    ).to.be.not.reverted;
  })

  it("Account cannot sub lease NFT", async function() {
    const [owner, lender, renter] = await ethers.getSigners();
    await erc721.connect(owner).mint(lender.address, 1);
    await erc721.connect(lender).approve(erc721.address, 1);
    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.not.reverted;
    await erc20.connect(owner).transfer(renter.address, 110);
    await erc20.connect(renter).approve(erc721.address, 110);
    await expect(
      erc721.connect(renter).leaseToken(1)
    ).to.be.not.reverted;

    await erc721.connect(renter).approve(erc721.address, 1);
    await expect(
      erc721.connect(renter).listOrUpdateLease(1, erc20.address, 20, 1800, 100)
    ).to.be.revertedWith(
      `Sub-leasing is not allowed`
    );
  })

  it("Account only claim collateral when lease is expired", async function() {
    const [owner, lender, renter] = await ethers.getSigners();
    await erc721.connect(owner).mint(lender.address, 1);
    await erc721.connect(lender).approve(erc721.address, 1);
    await expect(
      erc721.connect(lender).listOrUpdateLease(1, erc20.address, 10, 3600, 100)
    ).to.be.not.reverted;
    await erc20.connect(owner).transfer(renter.address, 110);
    await erc20.connect(renter).approve(erc721.address, 110);
    await expect(
      erc721.connect(renter).leaseToken(1)
    ).to.be.not.reverted;

    await expect(
      erc721.connect(lender).claimCollateral(1)
    ).to.be.revertedWith(
      `Lease is not expired`
    );

    await time.increase(3601)
    await expect(
      erc721.connect(lender).claimCollateral(1)
    ).to.be.not.reverted;
    expect(await erc20.balanceOf(lender.address)).to.equal(110);
  })
});

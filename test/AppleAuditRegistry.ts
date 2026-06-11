import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("AppleAuditRegistry", function () {
  async function deployRegistry() {
    const [owner, auditor, projectOwner, stranger] = await ethers.getSigners();
    const registry = await ethers.deployContract("AppleAuditRegistry");

    return { owner, auditor, projectOwner, stranger, registry };
  }

  it("lets wallets apply and owner approve auditors", async function () {
    const { auditor, registry } = await deployRegistry();

    await registry.connect(auditor).applyAuditor("ipfs://auditor-profile");

    const profile = await registry.auditors(auditor.address);
    expect(profile.status).to.equal(1n);
    expect(profile.profileUri).to.equal("ipfs://auditor-profile");
    expect(await registry.allAuditorsLength()).to.equal(1n);

    await registry.setAuditorStatus(auditor.address, 2);
    const approvedProfile = await registry.auditors(auditor.address);
    expect(approvedProfile.status).to.equal(2n);
    expect(approvedProfile.approvedAt).to.not.equal(0n);
  });

  it("blocks unapproved auditors from submitting project reviews", async function () {
    const { auditor, projectOwner, registry } = await deployRegistry();

    await registry.connect(auditor).applyAuditor("ipfs://auditor-profile");

    let blocked = false;
    try {
      await registry
        .connect(auditor)
        .submitReview(projectOwner.address, 88, 1, "ipfs://review-report");
    } catch {
      blocked = true;
    }

    expect(blocked).to.equal(true);
  });

  it("records approved auditor reviews and keeps project indexes", async function () {
    const { auditor, projectOwner, registry } = await deployRegistry();

    await registry.connect(auditor).applyAuditor("ipfs://auditor-profile");
    await registry.setAuditorStatus(auditor.address, 2);

    await registry
      .connect(auditor)
      .submitReview(projectOwner.address, 91, 0, "ipfs://review-report");

    expect(await registry.allReviewedProjectsLength()).to.equal(1n);
    expect(await registry.projectReviewersLength(projectOwner.address)).to.equal(1n);

    const reviews = await registry.getProjectReviews(projectOwner.address);
    expect(reviews.length).to.equal(1);
    expect(reviews[0].auditor).to.equal(auditor.address);
    expect(reviews[0].score).to.equal(91n);
    expect(reviews[0].riskLevel).to.equal(0n);
    expect(reviews[0].reportUri).to.equal("ipfs://review-report");

    const projects = await registry.getAuditorProjects(auditor.address);
    expect(projects[0]).to.equal(projectOwner.address);
  });

  it("updates an existing review without duplicating review counts", async function () {
    const { auditor, projectOwner, registry } = await deployRegistry();

    await registry.connect(auditor).applyAuditor("ipfs://auditor-profile");
    await registry.setAuditorStatus(auditor.address, 2);

    await registry
      .connect(auditor)
      .submitReview(projectOwner.address, 80, 1, "ipfs://first-report");
    await registry
      .connect(auditor)
      .submitReview(projectOwner.address, 86, 1, "ipfs://updated-report");

    const profile = await registry.auditors(auditor.address);
    const reviews = await registry.getProjectReviews(projectOwner.address);

    expect(profile.reviewCount).to.equal(1n);
    expect(await registry.projectReviewersLength(projectOwner.address)).to.equal(1n);
    expect(reviews[0].score).to.equal(86n);
    expect(reviews[0].reportUri).to.equal("ipfs://updated-report");
  });

  it("only the owner can approve auditors", async function () {
    const { auditor, stranger, registry } = await deployRegistry();

    let blocked = false;
    try {
      await registry.connect(stranger).setAuditorStatus(auditor.address, 2);
    } catch {
      blocked = true;
    }

    expect(blocked).to.equal(true);
  });

  it("does not expose a suspended auditor state", async function () {
    const { auditor, registry } = await deployRegistry();

    let blocked = false;
    try {
      await registry.setAuditorStatus(auditor.address, 3);
    } catch {
      blocked = true;
    }

    expect(blocked).to.equal(true);
  });
});

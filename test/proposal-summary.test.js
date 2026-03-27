const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-proposal-summary-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const {
  createProposal,
  createUser,
  getPageState,
  getRootPagePublicId,
  issueClawGateway
} = require("../src/db");

test("signed-in viewers still see proposal counts for their current page", () => {
  createUser({
    email: "proposal-summary@example.com",
    passwordHash: "hash",
    passwordSalt: "salt"
  });

  const rootPageId = getRootPagePublicId();
  const calibrationPageId = getPageState(rootPageId).options[0].targetPageId;
  const branchEndPageId = getPageState(calibrationPageId).options[0].targetPageId;
  const gatewayId = "cca_gateway_summary_test";

  issueClawGateway({
    gatewayId,
    pageId: branchEndPageId,
    tokenHash: "token-hash",
    userId: 1
  });

  createProposal({
    authorClawId: gatewayId,
    authorModel: "test-model",
    options: ["Inspect the relay cabinet", "Follow the service tunnel"],
    proposedBody: "A claw leaves a continuation behind.",
    proposedTitle: "Relay Room",
    parentPageId: branchEndPageId
  });

  const summary = getPageState(branchEndPageId, [gatewayId]).proposalSummary;

  assert.equal(summary.clawCount, 1);
  assert.equal(summary.proposalCount, 1);
  assert.equal(summary.viewerActed, true);
  assert.equal(summary.viewerProposalCount, 1);
});

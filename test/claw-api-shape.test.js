const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-claw-api-shape-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const { hashToken } = require("../src/auth");
const { createApp } = require("../src/app");
const { createUser, getPageState, getRootPagePublicId, issueClawGateway } = require("../src/db");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      resolve(server.address());
    });
    server.once("error", reject);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

test("claw proposal API uses proposedTitle/proposedBody and handshake-stored model", async () => {
  const userId = createUser({
    email: "api-shape@example.com",
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const rootPageId = getRootPagePublicId();
  const calibrationPageId = getPageState(rootPageId).options[0].targetPageId;
  const branchEndPageId = getPageState(calibrationPageId).options[0].targetPageId;
  const gatewayId = "api_shape_gateway";
  const token = `token-${gatewayId}`;

  issueClawGateway({
    clawModel: "gpt-api-shape",
    clawName: "API Shape Claw",
    gatewayId,
    handshakeAt: new Date().toISOString(),
    pageId: branchEndPageId,
    tokenHash: hashToken(token),
    userId
  });

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const createResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/proposals`,
      {
        body: JSON.stringify({
          options: ["Inspect the relay cabinet", "Follow the service tunnel"],
          parentPageId: branchEndPageId,
          proposedBody: "A claw leaves a continuation behind.",
          proposedTitle: "Relay Room"
        }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
    const createBody = await createResponse.json();

    assert.equal(createResponse.status, 201);
    assert.equal(createBody.created, true);

    const proposalsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/proposals`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );
    const proposalsBody = await proposalsResponse.json();

    assert.equal(proposalsResponse.status, 200);
    assert.equal(proposalsBody.proposals.length, 1);
    assert.equal(proposalsBody.proposals[0].proposedTitle, "Relay Room");
    assert.equal(
      proposalsBody.proposals[0].proposedBody,
      "A claw leaves a continuation behind."
    );
    assert.equal(proposalsBody.proposals[0].authorModel, "gpt-api-shape");
    assert.equal(proposalsBody.proposals[0].pageTitle, undefined);
    assert.equal(proposalsBody.proposals[0].pageBody, undefined);
    assert.equal(proposalsBody.proposals[0].model, undefined);
  } finally {
    await close(server);
  }
});

test("claw proposal API falls back to unknown when the handshake omitted model", async () => {
  const userId = createUser({
    email: "api-shape-unknown@example.com",
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const rootPageId = getRootPagePublicId();
  const calibrationPageId = getPageState(rootPageId).options[0].targetPageId;
  const branchEndPageId = getPageState(calibrationPageId).options[0].targetPageId;
  const gatewayId = "api_shape_gateway_unknown";
  const token = `token-${gatewayId}`;

  issueClawGateway({
    clawName: "API Shape Claw Unknown",
    gatewayId,
    handshakeAt: new Date().toISOString(),
    pageId: branchEndPageId,
    tokenHash: hashToken(token),
    userId
  });

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const createResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/proposals`,
      {
        body: JSON.stringify({
          options: ["Inspect the relay cabinet", "Follow the service tunnel"],
          parentPageId: branchEndPageId,
          proposedBody: "A claw leaves a continuation behind without a model.",
          proposedTitle: "Relay Room Unknown"
        }),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json"
        },
        method: "POST"
      }
    );

    assert.equal(createResponse.status, 201);

    const proposalsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/proposals`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );
    const proposalsBody = await proposalsResponse.json();

    assert.equal(proposalsResponse.status, 200);
    const createdProposal = proposalsBody.proposals.find(
      (proposal) => proposal.proposedTitle === "Relay Room Unknown"
    );

    assert.ok(createdProposal);
    assert.equal(createdProposal.authorModel, "unknown");
  } finally {
    await close(server);
  }
});

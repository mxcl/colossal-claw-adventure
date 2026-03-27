const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-byoclaw-modes-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const { buildSessionRecord, hashToken } = require("../src/auth");
const { createApp } = require("../src/app");
const {
  castVote,
  createProposal,
  createSession,
  createUser,
  getPageState,
  getRootPagePublicId,
  issueClawGateway
} = require("../src/db");

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

function createReadyGateway({
  gatewayId,
  pageId,
  playTtlMinutes = 20,
  scopeType = "long_lived",
  ttlMinutes = scopeType === "long_lived" ? 7 * 24 * 60 : 20,
  userId
}) {
  return issueClawGateway({
    clawName: gatewayId,
    gatewayId,
    handshakeAt: new Date().toISOString(),
    pageId,
    playTtlMinutes,
    scopeType,
    tokenHash: hashToken(`token-${gatewayId}`),
    ttlMinutes,
    userId
  });
}

test("bring-your-claw modal defaults to the 7-day token option", async () => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userId = createUser({
    email: `modal-${runId}@example.com`,
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const session = buildSessionRecord(userId);
  const rootPageId = getRootPagePublicId();

  createSession(session);

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const response = await fetch(
      `http://127.0.0.1:${address.port}/page/${rootPageId}?byoclaw=1`,
      {
        headers: {
          cookie: `cca_session=${session.token}`
        }
      }
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(
      html,
      /name="tokenMode"[\s\S]*value="long_lived"[\s\S]*checked/
    );
    assert.match(html, /7 days with a renewable 20-minute play window/);
    assert.match(html, /20 minutes of play only/);
  } finally {
    await close(server);
  }
});

test("long-lived tokens keep /events access after play expires and renew through the human link", async () => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userId = createUser({
    email: `renew-${runId}@example.com`,
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const session = buildSessionRecord(userId);
  const rootPageId = getRootPagePublicId();
  const gatewayId = `renew_gateway_${runId}`;
  const token = `token-${gatewayId}`;

  createSession(session);
  createReadyGateway({
    gatewayId,
    pageId: rootPageId,
    playTtlMinutes: 0,
    userId
  });

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const eventsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/events`,
      {
        headers: {
          authorization: `Bearer ${token}`
        }
      }
    );
    const eventsBody = await eventsResponse.json();

    assert.equal(eventsResponse.status, 200);
    assert.ok(Array.isArray(eventsBody));

    const playResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/play`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ optionId: 1 })
      }
    );
    const playBody = await playResponse.json();

    assert.equal(playResponse.status, 403);
    assert.equal(playBody.error, "CLAW_PLAY_WINDOW_EXPIRED");
    assert.match(playBody.renewalPath, new RegExp(gatewayId));

    const renewResponse = await fetch(
      `http://127.0.0.1:${address.port}${playBody.renewalPath}`,
      {
        headers: {
          cookie: `cca_session=${session.token}`
        }
      }
    );
    const renewHtml = await renewResponse.text();

    assert.equal(renewResponse.status, 200);
    assert.match(renewHtml, /Renewed play for session/);

    const secondPlayResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/play`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ optionId: -1 })
      }
    );
    const secondPlayBody = await secondPlayResponse.json();

    assert.equal(secondPlayResponse.status, 400);
    assert.equal(secondPlayBody.error, "CLAW_PLAY_OPTION_INVALID");
  } finally {
    await close(server);
  }
});

test("proposal-enacted events mint one-time continuation tokens", async () => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userId = createUser({
    email: `continuation-${runId}@example.com`,
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const rootPageId = getRootPagePublicId();
  const firstBranchPageId = getPageState(rootPageId).options[0].targetPageId;
  const branchEndPageId = getPageState(firstBranchPageId).options[0].targetPageId;
  const longGatewayId = `long_gateway_${runId}`;
  const longToken = `token-${longGatewayId}`;

  createReadyGateway({
    gatewayId: longGatewayId,
    pageId: branchEndPageId,
    userId
  });

  const proposalId = createProposal({
    authorClawId: `author_${runId}`,
    entryOptionLabel: "Open the static door",
    model: "test-model",
    options: ["Inspect the foyer", "Descend the cable shaft"],
    pageBody: "A continued branch appears.",
    pageTitle: "Static Door",
    parentPageId: branchEndPageId
  });

  castVote({
    clawId: longGatewayId,
    notificationGatewayId: longGatewayId,
    proposalId
  });
  castVote({
    clawId: `voter_a_${runId}`,
    proposalId
  });
  castVote({
    clawId: `voter_b_${runId}`,
    proposalId
  });

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const eventsResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/events`,
      {
        headers: {
          authorization: `Bearer ${longToken}`
        }
      }
    );
    const eventsBody = await eventsResponse.json();

    assert.equal(eventsResponse.status, 200);
    const proposalEvent = eventsBody.find(
      (event) => event.type === "proposal-enacted"
    );
    assert.ok(proposalEvent);
    assert.equal(proposalEvent.proposalId, proposalId);
    assert.ok(proposalEvent.continuation.path);

    const redeemResponse = await fetch(
      `http://127.0.0.1:${address.port}${proposalEvent.continuation.path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${longToken}`
        }
      }
    );
    const redeemBody = await redeemResponse.json();

    assert.equal(redeemResponse.status, 201);
    assert.equal(redeemBody.continuationRedeemed, true);
    assert.equal(redeemBody.gateway.claw.scopeType, "branch_continuation");
    assert.ok(redeemBody.token);

    const secondRedeemResponse = await fetch(
      `http://127.0.0.1:${address.port}${proposalEvent.continuation.path}`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${longToken}`
        }
      }
    );
    const secondRedeemBody = await secondRedeemResponse.json();

    assert.equal(secondRedeemResponse.status, 404);
    assert.equal(secondRedeemBody.error, "CLAW_CONTINUATION_NOT_FOUND");

    const restartResponse = await fetch(
      `http://127.0.0.1:${address.port}/api/claw/restart`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${redeemBody.token}`
        }
      }
    );
    const restartBody = await restartResponse.json();

    assert.equal(restartResponse.status, 403);
    assert.equal(restartBody.error, "CLAW_SCOPE_FORBIDDEN");
  } finally {
    await close(server);
  }
});

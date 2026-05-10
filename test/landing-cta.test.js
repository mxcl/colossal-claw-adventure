const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildSessionRecord } = require("../src/auth");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-landing-cta-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const { createApp } = require("../src/app");
const {
  createSession,
  createUser,
  getPageState,
  getRootPagePublicId,
  issueClawGateway,
  updateGatewayCurrentPage
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

test("landing page shows continue for signed-in users with saved progress before handshake", async () => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const userId = createUser({
    email: `landing-continue-${runId}@example.com`,
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const session = buildSessionRecord(userId);
  const rootPageId = getRootPagePublicId();
  const branchPageId = getPageState(rootPageId).options[0].targetPageId;
  const gatewayId = `landing_continue_${runId}`;
  const tokenHash = `landing-continue-token-${runId}`;

  createSession(session);
  issueClawGateway({
    gatewayId,
    pageId: rootPageId,
    tokenHash,
    userId
  });
  updateGatewayCurrentPage({
    gatewayId,
    pageId: branchPageId
  });

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/`, {
      headers: {
        cookie: `cca_session=${session.token}`
      }
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(
      html,
      new RegExp(
        `<a class="primary-btn landing-cta" href="/page/${branchPageId}">\\s*Continue\\s*</a>`
      )
    );
    assert.doesNotMatch(html, /Begin the Adventure/);
  } finally {
    await close(server);
  }
});

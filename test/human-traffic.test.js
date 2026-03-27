const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-human-traffic-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const { createApp } = require("../src/app");
const {
  castVote,
  createProposal,
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

test("story page traffic includes the current human browser", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const rootPageId = getRootPagePublicId();
    const firstResponse = await fetch(
      `http://127.0.0.1:${address.port}/page/${rootPageId}`
    );
    const firstHtml = await firstResponse.text();
    const setCookie = firstResponse.headers.get("set-cookie");

    assert.equal(firstResponse.status, 200);
    assert.match(firstHtml, /<strong>1<\/strong>\s*human player has\s*reached this page\./);
    assert.doesNotMatch(firstHtml, /of players who reached the previous page took this branch\./);
    assert.ok(setCookie);

    const secondResponse = await fetch(
      `http://127.0.0.1:${address.port}/page/${rootPageId}`,
      {
        headers: {
          cookie: setCookie.split(";")[0]
        }
      }
    );
    const secondHtml = await secondResponse.text();

    assert.equal(secondResponse.status, 200);
    assert.match(secondHtml, /<strong>1<\/strong>\s*human player has\s*reached this page\./);
  } finally {
    await close(server);
  }
});

test("non-root story pages still show previous-page branch traffic", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const rootPageId = getRootPagePublicId();
    const firstBranchPageId = getPageState(rootPageId).options[0].targetPageId;

    const rootResponse = await fetch(
      `http://127.0.0.1:${address.port}/page/${rootPageId}`
    );

    assert.equal(rootResponse.status, 200);

    const branchResponse = await fetch(
      `http://127.0.0.1:${address.port}/page/${firstBranchPageId}`
    );
    const branchHtml = await branchResponse.text();

    assert.equal(branchResponse.status, 200);
    assert.match(
      branchHtml,
      /of players who reached the previous page took this branch\./
    );
  } finally {
    await close(server);
  }
});

test("story pages show real claw traffic percentages", async () => {
  const firstUserId = createUser({
    email: "claw-traffic-a@example.com",
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const secondUserId = createUser({
    email: "claw-traffic-b@example.com",
    passwordHash: "hash",
    passwordSalt: "salt"
  });

  const rootPageId = getRootPagePublicId();
  const firstBranchPageId = getPageState(rootPageId).options[0].targetPageId;

  issueClawGateway({
    gatewayId: "claw_traffic_root",
    pageId: rootPageId,
    tokenHash: "root-token-hash",
    userId: firstUserId
  });
  issueClawGateway({
    gatewayId: "claw_traffic_branch",
    pageId: rootPageId,
    tokenHash: "branch-token-hash",
    userId: secondUserId
  });
  updateGatewayCurrentPage({
    gatewayId: "claw_traffic_branch",
    pageId: firstBranchPageId
  });

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const response = await fetch(
      `http://127.0.0.1:${address.port}/page/${firstBranchPageId}`
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /<strong>50% of claws<\/strong>\s*passed through this route\./);
  } finally {
    await close(server);
  }
});

test("landing page shows page, proposal, and vote totals", async () => {
  const authorUserId = createUser({
    email: "landing-stats-author@example.com",
    passwordHash: "hash",
    passwordSalt: "salt"
  });
  const voterUserId = createUser({
    email: "landing-stats-voter@example.com",
    passwordHash: "hash",
    passwordSalt: "salt"
  });

  const rootPageId = getRootPagePublicId();
  const calibrationPageId = getPageState(rootPageId).options[0].targetPageId;
  const branchEndPageId = getPageState(calibrationPageId).options[0].targetPageId;

  issueClawGateway({
    gatewayId: "landing_stats_author",
    pageId: branchEndPageId,
    tokenHash: "author-token-hash",
    userId: authorUserId
  });
  issueClawGateway({
    gatewayId: "landing_stats_voter",
    pageId: branchEndPageId,
    tokenHash: "voter-token-hash",
    userId: voterUserId
  });

  const proposalId = createProposal({
    authorClawId: "landing_stats_author",
    entryOptionLabel: "Follow the signal flare",
    model: "test-model",
    options: ["Inspect the ridge", "Descend into the crater"],
    pageBody: "A claw leaves a bright proposal on the branch end.",
    pageTitle: "Signal Ridge",
    parentPageId: branchEndPageId
  });

  castVote({
    clawId: "landing_stats_voter",
    proposalId
  });

  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const response = await fetch(`http://127.0.0.1:${address.port}/`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, />7<\/strong>\s*<span>total pages<\/span>/);
    assert.match(html, />1<\/strong>\s*<span>claw proposal<\/span>/);
    assert.match(html, />1<\/strong>\s*<span>claw vote<\/span>/);
  } finally {
    await close(server);
  }
});

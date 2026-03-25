const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-auth-signup-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const { createApp } = require("../src/app");
const { getRootPagePublicId, getUserByEmail } = require("../src/db");

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

test("sign-up modal includes a confirm-password field", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const rootPageId = getRootPagePublicId();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/page/${rootPageId}?byoclaw=1`
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /name="confirmPassword"/);
    assert.match(html, /Confirm Password/);
  } finally {
    await close(server);
  }
});

test("sign-up rejects mismatched passwords", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const rootPageId = getRootPagePublicId();
    const params = new URLSearchParams({
      confirmPassword: "not-the-same-password",
      email: "mismatch@example.com",
      pageId: rootPageId,
      password: "password123",
      returnTo: `/${rootPageId}`
    });
    const response = await fetch(
      `http://127.0.0.1:${address.port}/auth/signup`,
      {
        body: params,
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        method: "POST"
      }
    );
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Passwords do not match\./);
    assert.equal(getUserByEmail("mismatch@example.com"), null);
  } finally {
    await close(server);
  }
});

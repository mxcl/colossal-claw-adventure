const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-human-traffic-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const { createApp } = require("../src/app");
const { getRootPagePublicId } = require("../src/db");

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

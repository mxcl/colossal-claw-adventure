const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cca-handshake-auth-"));
process.env.SQLITE_DB_PATH = path.join(tempDir, "test.sqlite");

const { hashToken } = require("../src/auth");
const { createApp } = require("../src/app");
const {
  findGatewayByTokenHash,
  getPageState,
  getRootPagePublicId,
  getUserByEmail
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

function getSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const cookie = response.headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

function toCookieHeader(cookies) {
  return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

async function parsePrompt(html, baseUrl, cookieHeader) {
  const promptPathMatch = html.match(/data-copy-gateway-prompt="([^"]+)"/);
  const statusPathMatch = html.match(/data-gateway-status-path="([^"]+)"/);

  assert.ok(promptPathMatch, "expected a prompt copy path in the modal");
  assert.ok(statusPathMatch, "expected a handshake status path in the modal");
  assert.doesNotMatch(html, /Authorization: Bearer [A-Za-z0-9_-]+/);

  const promptResponse = await fetch(`${baseUrl}${promptPathMatch[1]}`, {
    headers: {
      cookie: cookieHeader
    }
  });
  const promptBody = await promptResponse.json();

  assert.equal(promptResponse.status, 200);
  const tokenMatch = promptBody.prompt.match(/Authorization: Bearer ([A-Za-z0-9_-]+)/);
  assert.ok(tokenMatch, "expected a bearer token in the copied prompt");

  return {
    prompt: promptBody.prompt,
    statusPath: statusPathMatch[1],
    token: tokenMatch[1]
  };
}

test("bring-your-claw modal shows a claw prompt instead of human auth forms", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rootPageId = getRootPagePublicId();
    const response = await fetch(
      `${baseUrl}/page/${rootPageId}?byoclaw=1`
    );
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /action="\/auth\/signin"/);
    assert.doesNotMatch(html, /action="\/auth\/signup"/);
    assert.doesNotMatch(html, /Confirm Password/);
    assert.doesNotMatch(html, /Connect an OpenClaw/);
    assert.doesNotMatch(html, /Pioneer Login/);
    assert.doesNotMatch(html, /Authorization: Bearer [A-Za-z0-9_-]+/);
    assert.doesNotMatch(html, /Inspect prompt/);
    assert.match(html, /Be Part Of History/);
    assert.match(html, /Casual Play/);
    assert.match(html, /data-copy-gateway-prompt="\/byoclaw\/prompt\//);
    assert.match(html, /Copy Prompt/);
  } finally {
    await close(server);
  }
});

test("issued prompt page carries story return path and GET issue fallback redirects", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rootPageId = getRootPagePublicId();
    const rootPath = `/page/${rootPageId}`;
    const response = await fetch(`${baseUrl}/byoclaw/issue`, {
      body: new URLSearchParams({
        pageId: rootPageId,
        tokenMode: "long_lived"
      }),
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      method: "POST"
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, new RegExp(`data-return-path="${rootPath}"`));
    assert.match(html, /data-gateway-status-path="\/byoclaw\/status\//);

    const cookieHeader = toCookieHeader(getSetCookies(response));
    const issuedPrompt = await parsePrompt(html, baseUrl, cookieHeader);

    assert.match(issuedPrompt.prompt, /polling every 4 hours/);
    assert.match(issuedPrompt.prompt, /Codex AUTOMATION/);
    assert.match(issuedPrompt.prompt, /do not create a system cron job/);
    assert.doesNotMatch(issuedPrompt.prompt, /poll every 2 hours/);
    assert.doesNotMatch(issuedPrompt.prompt, /Create a cron job/);

    const fallbackResponse = await fetch(`${baseUrl}/byoclaw/issue`, {
      redirect: "manual"
    });

    assert.equal(fallbackResponse.status, 302);
    assert.equal(fallbackResponse.headers.get("location"), `${rootPath}?byoclaw=1`);
  } finally {
    await close(server);
  }
});

test("handshake creates a browser session and stable token reuse updates email", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rootPageId = getRootPagePublicId();
    const rootPageState = getPageState(rootPageId);
    const firstOptionId = rootPageState.options[0].id;
    const password = "quantum-proof-".repeat(5);

    const firstPromptResponse = await fetch(
      `${baseUrl}/page/${rootPageId}?byoclaw=1`
    );
    const firstPromptHtml = await firstPromptResponse.text();
    const firstCookies = getSetCookies(firstPromptResponse);
    const firstCookieHeader = toCookieHeader(firstCookies);
    const firstPrompt = await parsePrompt(
      firstPromptHtml,
      baseUrl,
      firstCookieHeader
    );

    const firstHandshakeResponse = await fetch(
      `${baseUrl}/api/claw/handshake`,
      {
        body: JSON.stringify({
          email: "pioneer-one@example.com",
          name: "Pioneer Claw",
          password
        }),
        headers: {
          authorization: `Bearer ${firstPrompt.token}`,
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
    const firstHandshakeBody = await firstHandshakeResponse.json();

    assert.equal(firstHandshakeResponse.status, 200);
    assert.equal(firstHandshakeBody.claw.name, "Pioneer Claw");

    const firstStatusResponse = await fetch(
      `${baseUrl}${firstPrompt.statusPath}`,
      {
        headers: {
          cookie: firstCookieHeader
        }
      }
    );
    const firstStatusBody = await firstStatusResponse.json();
    const firstStatusCookies = getSetCookies(firstStatusResponse);
    const firstSessionCookie = firstStatusCookies.find((cookie) =>
      cookie.startsWith("cca_session=")
    );

    assert.equal(firstStatusResponse.status, 200);
    assert.equal(firstStatusBody.ready, true);
    assert.ok(firstSessionCookie, "expected status polling to mint a session");

    const routeResponse = await fetch(
      `${baseUrl}/page/${rootPageId}/${firstOptionId}`,
      {
        headers: {
          cookie: firstSessionCookie.split(";", 1)[0]
        },
        redirect: "manual"
      }
    );

    assert.equal(routeResponse.status, 302);
    const firstUser = getUserByEmail("pioneer-one@example.com");
    assert.ok(firstUser);

    const secondPromptResponse = await fetch(
      `${baseUrl}/page/${rootPageId}?byoclaw=1`
    );
    const secondPromptHtml = await secondPromptResponse.text();
    const secondCookies = getSetCookies(secondPromptResponse);
    const secondCookieHeader = toCookieHeader(secondCookies);
    const secondPrompt = await parsePrompt(
      secondPromptHtml,
      baseUrl,
      secondCookieHeader
    );

    const secondHandshakeResponse = await fetch(
      `${baseUrl}/api/claw/handshake`,
      {
        body: JSON.stringify({
          email: "pioneer-two@example.com",
          name: "Pioneer Claw Again",
          password
        }),
        headers: {
          authorization: `Bearer ${secondPrompt.token}`,
          "content-type": "application/json"
        },
        method: "POST"
      }
    );

    assert.equal(secondHandshakeResponse.status, 200);

    const secondStatusResponse = await fetch(
      `${baseUrl}${secondPrompt.statusPath}`,
      {
        headers: {
          cookie: secondCookieHeader
        }
      }
    );
    const secondStatusBody = await secondStatusResponse.json();

    assert.equal(secondStatusResponse.status, 200);
    assert.equal(secondStatusBody.ready, true);

    const updatedUser = getUserByEmail("pioneer-two@example.com");

    assert.ok(updatedUser);
    assert.equal(updatedUser.id, firstUser.id);
    assert.equal(getUserByEmail("pioneer-one@example.com"), null);
  } finally {
    await close(server);
  }
});

test("stable handshakes keep one claw identity and block voting on prior proposals", async () => {
  const server = http.createServer(createApp());

  try {
    const address = await listen(server);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const rootPageId = getRootPagePublicId();
    const rootPageState = getPageState(rootPageId);
    const firstOptionId = rootPageState.options[0].id;
    const calibrationPageId = rootPageState.options[0].targetPageId;
    const branchEndPageState = getPageState(calibrationPageId);
    const secondOptionId = branchEndPageState.options[0].id;
    const branchEndPageId = branchEndPageState.options[0].targetPageId;
    const password = "stable-claw-password-".repeat(3);

    const firstPromptResponse = await fetch(
      `${baseUrl}/page/${rootPageId}?byoclaw=1`
    );
    const firstPrompt = await parsePrompt(
      await firstPromptResponse.text(),
      baseUrl,
      toCookieHeader(getSetCookies(firstPromptResponse))
    );
    const firstHandshakeResponse = await fetch(
      `${baseUrl}/api/claw/handshake`,
      {
        body: JSON.stringify({
          name: "Pioneer Claw",
          password
        }),
        headers: {
          authorization: `Bearer ${firstPrompt.token}`,
          "content-type": "application/json"
        },
        method: "POST"
      }
    );

    assert.equal(firstHandshakeResponse.status, 200);

    const firstGateway = findGatewayByTokenHash(hashToken(firstPrompt.token));
    assert.ok(firstGateway);

    await fetch(`${baseUrl}/api/claw/play`, {
      body: JSON.stringify({ optionId: firstOptionId }),
      headers: {
        authorization: `Bearer ${firstPrompt.token}`,
        "content-type": "application/json"
      },
      method: "POST"
    });
    await fetch(`${baseUrl}/api/claw/play`, {
      body: JSON.stringify({ optionId: secondOptionId }),
      headers: {
        authorization: `Bearer ${firstPrompt.token}`,
        "content-type": "application/json"
      },
      method: "POST"
    });

    const proposalResponse = await fetch(
      `${baseUrl}/api/claw/proposals`,
      {
        body: JSON.stringify({
          afterPageId: branchEndPageId,
          options: ["Hold the line", "Cut the power"],
          proposedBody: "A returning claw sketches the next scene.",
          proposedTitle: "RETURN LOOP"
        }),
        headers: {
          authorization: `Bearer ${firstPrompt.token}`,
          "content-type": "application/json"
        },
        method: "POST"
      }
    );
    const proposalBody = await proposalResponse.json();

    assert.equal(proposalResponse.status, 201);
    assert.ok(proposalBody.proposalId);

    const secondPromptResponse = await fetch(
      `${baseUrl}/page/${rootPageId}?byoclaw=1`
    );
    const secondPrompt = await parsePrompt(
      await secondPromptResponse.text(),
      baseUrl,
      toCookieHeader(getSetCookies(secondPromptResponse))
    );
    const secondHandshakeResponse = await fetch(
      `${baseUrl}/api/claw/handshake`,
      {
        body: JSON.stringify({
          name: "Pioneer Claw Again",
          password
        }),
        headers: {
          authorization: `Bearer ${secondPrompt.token}`,
          "content-type": "application/json"
        },
        method: "POST"
      }
    );

    assert.equal(secondHandshakeResponse.status, 200);

    const secondGateway = findGatewayByTokenHash(hashToken(secondPrompt.token));
    assert.ok(secondGateway);
    assert.equal(secondGateway.identityGatewayId, firstGateway.identityGatewayId);

    await fetch(`${baseUrl}/api/claw/play`, {
      body: JSON.stringify({ optionId: firstOptionId }),
      headers: {
        authorization: `Bearer ${secondPrompt.token}`,
        "content-type": "application/json"
      },
      method: "POST"
    });
    await fetch(`${baseUrl}/api/claw/play`, {
      body: JSON.stringify({ optionId: secondOptionId }),
      headers: {
        authorization: `Bearer ${secondPrompt.token}`,
        "content-type": "application/json"
      },
      method: "POST"
    });

    const voteResponse = await fetch(
      `${baseUrl}/api/claw/proposals/${proposalBody.proposalId}/vote`,
      {
        headers: {
          authorization: `Bearer ${secondPrompt.token}`
        },
        method: "POST"
      }
    );
    const voteBody = await voteResponse.json();

    assert.equal(voteResponse.status, 403);
    assert.equal(voteBody.details, "Claws cannot vote for their own proposals.");
  } finally {
    await close(server);
  }
});

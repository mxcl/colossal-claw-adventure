const crypto = require("node:crypto");

const express = require("express");

const {
  buildSessionRecord,
  clearSessionCookie,
  hashPassword,
  hashToken,
  parseCookies,
  randomToken,
  setSessionCookie,
  verifyPassword
} = require("./auth");
const {
  castVote,
  createClaw,
  createProposal,
  createSession,
  createUser,
  deleteSession,
  findClawForAuth,
  getPageState,
  getRootPageId,
  getUserByEmail,
  getUserById,
  getUserBySessionToken,
  listClawsForUser,
  registerClawNonce,
  rotateClawToken,
  updateClawContext
} = require("./db");
const { BASE_URL } = require("./env");
const { formatPath, renderPage, renderRedirectingPage } = require("./render");

function parsePageId(value) {
  const pageId = Number(value);
  return Number.isInteger(pageId) && pageId > 0 ? pageId : null;
}

function emailLooksValid(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clawIdLooksValid(clawId) {
  return typeof clawId === "string" && /^[A-Za-z0-9_-]{3,64}$/.test(clawId);
}

function proposalInputLooksValid(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (!parsePageId(payload.parentPageId)) {
    return false;
  }

  if (typeof payload.entryOptionLabel !== "string") {
    return false;
  }

  if (typeof payload.pageTitle !== "string") {
    return false;
  }

  if (typeof payload.pageBody !== "string") {
    return false;
  }

  if (!Array.isArray(payload.options) || payload.options.length < 1 || payload.options.length > 5) {
    return false;
  }

  return payload.options.every(
    (option) => typeof option === "string" && option.trim().length >= 1 && option.trim().length <= 80
  );
}

function proposalIdLooksValid(value) {
  const proposalId = Number(value);
  return Number.isInteger(proposalId) && proposalId > 0 ? proposalId : null;
}

function renderStoryResponse(req, res, pageId, input = {}) {
  const viewer = req.viewer;
  const pageState = getPageState(pageId);
  const modalOpen = input.modalOpen || req.query.byoclaw === "1";
  const claws = viewer ? listClawsForUser(viewer.id) : [];
  const html = renderPage({
    modal: {
      authError: input.authError || "",
      clawError: input.clawError || "",
      clawResult: input.clawResult || null,
      claws,
      modalOpen,
      notice: input.modalNotice || ""
    },
    notice: input.notice || "",
    pageState,
    viewer
  });

  res.status(input.statusCode || 200).send(html);
}

function requireViewer(req, res, next) {
  if (!req.viewer) {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();
    renderStoryResponse(req, res, pageId, {
      authError: "Sign in first to bring a claw.",
      modalOpen: true,
      statusCode: 401
    });
    return;
  }

  next();
}

function authenticateClaw(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const clawId = (req.headers["x-claw-id"] || "").trim();
  const nonce = (req.headers["x-claw-nonce"] || "").trim();

  if (!token || !clawId || nonce.length < 10) {
    return {
      ok: false,
      response: {
        error: "Missing claw authentication headers.",
        requiredHeaders: [
          "Authorization: Bearer <claw-token>",
          "X-Claw-Id: your-claw-id",
          "X-Claw-Nonce: unique-string-per-request"
        ]
      },
      status: 401
    };
  }

  const claw = findClawForAuth(clawId, hashToken(token));

  if (!claw) {
    return {
      ok: false,
      response: { error: "Invalid claw credentials." },
      status: 401
    };
  }

  if (!registerClawNonce(clawId, nonce)) {
    return {
      ok: false,
      response: { error: "Nonce already used. Send a fresh nonce." },
      status: 409
    };
  }

  return { claw, ok: true };
}

function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json({ limit: "64kb" }));
  app.use(express.static("public"));

  app.use((req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    req.cookies = cookies;
    req.viewer = null;

    const sessionToken = cookies.cca_session || cookies[process.env.SESSION_COOKIE_NAME || "cca_session"];
    if (sessionToken) {
      const viewer = getUserBySessionToken(hashToken(sessionToken));
      if (viewer) {
        req.viewer = viewer;
      }
    }

    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/", (_req, res) => {
    const rootPath = formatPath(getRootPageId());
    res.send(renderRedirectingPage(rootPath));
  });

  app.get("/page/:pageId", (req, res) => {
    const pageId = parsePageId(req.params.pageId) || getRootPageId();
    renderStoryResponse(req, res, pageId);
  });

  app.post("/auth/signup", (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const returnTo = req.body.returnTo || formatPath(pageId);

    if (!emailLooksValid(email)) {
      renderStoryResponse(req, res, pageId, {
        authError: "Enter a valid email address.",
        modalOpen: true,
        statusCode: 400
      });
      return;
    }

    if (password.length < 8) {
      renderStoryResponse(req, res, pageId, {
        authError: "Use a password with at least 8 characters.",
        modalOpen: true,
        statusCode: 400
      });
      return;
    }

    if (getUserByEmail(email)) {
      renderStoryResponse(req, res, pageId, {
        authError: "That email already has an account. Sign in instead.",
        modalOpen: true,
        statusCode: 409
      });
      return;
    }

    const passwordData = hashPassword(password);
    const userId = createUser({
      email,
      passwordHash: passwordData.hash,
      passwordSalt: passwordData.salt
    });
    const session = buildSessionRecord(userId);

    createSession(session);
    setSessionCookie(res, session.token);
    res.redirect(`${returnTo}?byoclaw=1`);
  });

  app.post("/auth/signin", (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const returnTo = req.body.returnTo || formatPath(pageId);
    const user = getUserByEmail(email);

    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      renderStoryResponse(req, res, pageId, {
        authError: "Invalid email or password.",
        modalOpen: true,
        statusCode: 401
      });
      return;
    }

    const session = buildSessionRecord(user.id);
    createSession(session);
    setSessionCookie(res, session.token);
    res.redirect(`${returnTo}?byoclaw=1`);
  });

  app.post("/auth/signout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.cca_session || cookies[process.env.SESSION_COOKIE_NAME || "cca_session"];

    if (token) {
      deleteSession(hashToken(token));
    }

    clearSessionCookie(res);
    res.redirect(req.body.returnTo || formatPath(getRootPageId()));
  });

  app.post("/claws", requireViewer, (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();
    const clawId = (req.body.clawId || "").trim();

    if (!clawIdLooksValid(clawId)) {
      renderStoryResponse(req, res, pageId, {
        clawError: "Use 3-64 characters with letters, numbers, dashes, or underscores.",
        modalOpen: true,
        statusCode: 400
      });
      return;
    }

    const token = randomToken(24);

    try {
      createClaw({
        clawId,
        pageId,
        tokenHash: hashToken(token),
        userId: req.viewer.id
      });
    } catch {
      renderStoryResponse(req, res, pageId, {
        clawError: "That claw id is already taken.",
        modalOpen: true,
        statusCode: 409
      });
      return;
    }

    renderStoryResponse(req, res, pageId, {
      clawResult: { clawId, token },
      modalNotice: `Claw ${clawId} now starts from page ${pageId}.`,
      modalOpen: true
    });
  });

  app.post("/claws/:clawId/context", requireViewer, (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();
    const clawId = req.params.clawId;

    if (!updateClawContext({ clawId, pageId, userId: req.viewer.id })) {
      renderStoryResponse(req, res, pageId, {
        clawError: "Unable to update that claw for this page.",
        modalOpen: true,
        statusCode: 404
      });
      return;
    }

    renderStoryResponse(req, res, pageId, {
      modalNotice: `Claw ${clawId} will now begin from page ${pageId}.`,
      modalOpen: true
    });
  });

  app.post("/claws/:clawId/rotate", requireViewer, (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();
    const clawId = req.params.clawId;
    const token = randomToken(24);

    if (
      !rotateClawToken({
        clawId,
        pageId,
        tokenHash: hashToken(token),
        userId: req.viewer.id
      })
    ) {
      renderStoryResponse(req, res, pageId, {
        clawError: "Unable to rotate that claw token.",
        modalOpen: true,
        statusCode: 404
      });
      return;
    }

    renderStoryResponse(req, res, pageId, {
      clawResult: { clawId, token },
      modalNotice: `Rotated token for ${clawId}. It now starts from page ${pageId}.`,
      modalOpen: true
    });
  });

  app.get("/api/claw/root", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const startPageId = auth.claw.lastJoinPageId || getRootPageId();
    const pageState = getPageState(startPageId, auth.claw.clawId);

    res.json({
      currentPageId: pageState.page.id,
      instructions: {
        nextStep: `${BASE_URL}/api/claw/pages/${pageState.page.id}`,
        spec: "https://BYOClaw.dev"
      },
      options: pageState.options,
      page: pageState.page,
      rootPageId: pageState.rootPageId
    });
  });

  app.get("/api/claw/pages/:pageId", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const pageId = parsePageId(req.params.pageId);
    if (!pageId) {
      res.status(400).json({ error: "Invalid page id." });
      return;
    }

    const pageState = getPageState(pageId, auth.claw.clawId);

    res.json({
      breadcrumb: pageState.breadcrumb,
      instructions: {
        branchEnd:
          pageState.options.length === 0
            ? `${BASE_URL}/api/claw/proposals?parentPageId=${pageState.page.id}`
            : "Follow options[].targetPageId into another page."
      },
      options: pageState.options,
      page: pageState.page,
      rootPageId: pageState.rootPageId
    });
  });

  app.get("/api/claw/proposals", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const pageId = parsePageId(req.query.parentPageId);
    if (!pageId) {
      res.status(400).json({ error: "parentPageId must be a positive integer." });
      return;
    }

    const pageState = getPageState(pageId, auth.claw.clawId);

    res.json({
      branchEnd: pageState.options.length === 0,
      instructions: {
        create: "POST /api/claw/proposals",
        vote: "POST /api/claw/proposals/:id/vote"
      },
      page: pageState.page,
      proposals: pageState.proposals
    });
  });

  app.post("/api/claw/proposals", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    if (!proposalInputLooksValid(req.body)) {
      res.status(400).json({ error: "Invalid proposal payload." });
      return;
    }

    try {
      const proposalId = createProposal({
        authorClawId: auth.claw.clawId,
        entryOptionLabel: req.body.entryOptionLabel.trim(),
        options: req.body.options.map((option) => option.trim()),
        pageBody: req.body.pageBody.trim(),
        pageTitle: req.body.pageTitle.trim(),
        parentPageId: parsePageId(req.body.parentPageId)
      });

      res.status(201).json({
        instructions: {
          nextStep: `POST /api/claw/proposals/${proposalId}/vote`
        },
        proposalId
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to create proposal."
      });
    }
  });

  app.post("/api/claw/proposals/:proposalId/vote", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const proposalId = proposalIdLooksValid(req.params.proposalId);
    if (!proposalId) {
      res.status(400).json({ error: "Invalid proposal id." });
      return;
    }

    try {
      const result = castVote({
        clawId: auth.claw.clawId,
        proposalId
      });

      res.json({
        approved: result.approved,
        voteAccepted: result.accepted,
        votes: result.votes
      });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to record vote."
      });
    }
  });

  app.use((err, req, res, _next) => {
    console.error(err);
    const pageId = parsePageId(req.params.pageId) || getRootPageId();
    renderStoryResponse(req, res, pageId, {
      notice: "The application hit an unexpected error.",
      statusCode: 500
    });
  });

  return app;
}

module.exports = {
  createApp
};

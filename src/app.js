const express = require("express");

const {
  buildSessionRecord,
  clearSessionCookie,
  hashPassword,
  hashToken,
  parseCookies,
  randomBase64UrlToken,
  setSessionCookie,
  verifyPassword
} = require("./auth");
const {
  castVote,
  createProposal,
  createSession,
  createUser,
  deleteSession,
  findGatewayByTokenHash,
  getPageState,
  getRootPageId,
  getUserByEmail,
  getUserBySessionToken,
  issueClawGateway,
  listActiveGatewaysForUser,
  revokeGateway
} = require("./db");
const {
  BASE_URL,
  BYOCLAW_SPEC_VERSION
} = require("./env");
const { formatPath, renderPage, renderRedirectingPage } = require("./render");

const rateWindowMs = 60 * 1000;
const perTokenLimit = 60;
const perUserLimit = 180;
const rateBuckets = new Map();

function parsePageId(value) {
  const pageId = Number(value);
  return Number.isInteger(pageId) && pageId > 0 ? pageId : null;
}

function emailLooksValid(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function errorResponse(res, status, error, extra = {}) {
  res.status(status).json({ error, ...extra });
}

function checkRateLimit(key, limit) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const fresh = bucket.filter((value) => now - value < rateWindowMs);

  if (fresh.length >= limit) {
    rateBuckets.set(key, fresh);
    return false;
  }

  fresh.push(now);
  rateBuckets.set(key, fresh);
  return true;
}

function buildGatewayDetails(pageId, userId) {
  const token = randomBase64UrlToken(24, "cca_claw_");
  const gatewayId = randomBase64UrlToken(12, "cca_gateway_");
  const gateway = issueClawGateway({
    gatewayId,
    pageId,
    tokenHash: hashToken(token),
    userId
  });

  return {
    ...gateway,
    token
  };
}

function renderStoryResponse(req, res, pageId, input = {}) {
  const viewer = req.viewer;
  const pageState = getPageState(pageId);
  const modalOpen = input.modalOpen || req.query.byoclaw === "1";
  const shouldIssueGateway =
    viewer &&
    modalOpen &&
    (input.issueGateway || req.query.issue === "1") &&
    !input.gateway;
  const gateway =
    shouldIssueGateway
      ? buildGatewayDetails(pageState.page.id, viewer.id)
      : input.gateway || null;
  const gateways = viewer ? listActiveGatewaysForUser(viewer.id) : [];
  const html = renderPage({
    modal: {
      authError: input.authError || "",
      clawError: input.clawError || "",
      gateway,
      gateways,
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

  if (!token) {
    return {
      ok: false,
      response: { error: "CLAW_GATEWAY_TOKEN_MISSING" },
      status: 401
    };
  }

  const gateway = findGatewayByTokenHash(hashToken(token));

  if (!gateway) {
    return {
      ok: false,
      response: { error: "CLAW_GATEWAY_TOKEN_INVALID" },
      status: 401
    };
  }

  if (gateway.revokedAt) {
    return {
      ok: false,
      response: { error: "CLAW_GATEWAY_TOKEN_REVOKED" },
      status: 401
    };
  }

  if (new Date(gateway.expiresAt).getTime() <= Date.now()) {
    return {
      ok: false,
      response: {
        error: "CLAW_GATEWAY_TOKEN_EXPIRED",
        expiredAt: gateway.expiresAt
      },
      status: 401
    };
  }

  if (!checkRateLimit(`token:${gateway.tokenHash}`, perTokenLimit)) {
    return {
      ok: false,
      response: {
        error: "CLAW_GATEWAY_RATE_LIMITED",
        retryAfterSeconds: 60
      },
      status: 429
    };
  }

  if (!checkRateLimit(`user:${gateway.userId}`, perUserLimit)) {
    return {
      ok: false,
      response: {
        error: "CLAW_GATEWAY_RATE_LIMITED",
        retryAfterSeconds: 60
      },
      status: 429
    };
  }

  return { gateway, ok: true };
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
    res.redirect(`${returnTo}?byoclaw=1&issue=1`);
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
    res.redirect(`${returnTo}?byoclaw=1&issue=1`);
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

  app.post("/byoclaw/issue", requireViewer, (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();

    renderStoryResponse(req, res, pageId, {
      issueGateway: true,
      modalNotice: `Issued a temporary BYOClaw gateway for page ${pageId}.`,
      modalOpen: true
    });
  });

  app.post("/byoclaw/revoke/:gatewayId", requireViewer, (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPageId();
    const gatewayId = req.params.gatewayId;

    if (!revokeGateway({ gatewayId, userId: req.viewer.id })) {
      renderStoryResponse(req, res, pageId, {
        clawError: "Unable to revoke that gateway.",
        modalOpen: true,
        statusCode: 404
      });
      return;
    }

    renderStoryResponse(req, res, pageId, {
      modalNotice: `Revoked temporary gateway ${gatewayId}.`,
      modalOpen: true
    });
  });

  app.get("/api/claw", (_req, res) => {
    res.json({
      apiVersion: "1",
      auth: {
        header: "Authorization",
        type: "bearer"
      },
      basePath: "/api/claw",
      byoclawSpecVersion: BYOCLAW_SPEC_VERSION,
      endpoints: [
        { method: "GET", name: "discovery", path: "/" },
        { method: "GET", name: "current", path: "/current" },
        { method: "GET", name: "page", path: "/pages/:pageId" },
        { method: "GET", name: "proposals", path: "/proposals" },
        { method: "POST", name: "createProposal", path: "/proposals" },
        { method: "POST", name: "voteProposal", path: "/proposals/:proposalId/vote" }
      ]
    });
  });

  app.get("/api/claw/current", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const pageState = getPageState(auth.gateway.pageId, auth.gateway.gatewayId);

    res.json({
      currentPageId: pageState.page.id,
      gateway: {
        expiresAt: auth.gateway.expiresAt,
        gatewayId: auth.gateway.gatewayId
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
      errorResponse(res, 400, "CLAW_GATEWAY_SCOPE_FORBIDDEN", {
        message: "Invalid page id."
      });
      return;
    }

    const pageState = getPageState(pageId, auth.gateway.gatewayId);

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
      errorResponse(res, 400, "CLAW_GATEWAY_SCOPE_FORBIDDEN", {
        message: "parentPageId must be a positive integer."
      });
      return;
    }

    const pageState = getPageState(pageId, auth.gateway.gatewayId);

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
      errorResponse(res, 400, "CLAW_GATEWAY_SCOPE_FORBIDDEN", {
        message: "Invalid proposal payload."
      });
      return;
    }

    try {
      const proposalId = createProposal({
        authorClawId: auth.gateway.gatewayId,
        entryOptionLabel: normalizeText(req.body.entryOptionLabel),
        options: req.body.options.map((option) => normalizeText(option)),
        pageBody: normalizeText(req.body.pageBody),
        pageTitle: normalizeText(req.body.pageTitle),
        parentPageId: parsePageId(req.body.parentPageId)
      });

      res.status(201).json({
        instructions: {
          nextStep: `POST /api/claw/proposals/${proposalId}/vote`
        },
        proposalId
      });
    } catch (error) {
      errorResponse(res, 400, "CLAW_GATEWAY_SCOPE_FORBIDDEN", {
        message:
          error instanceof Error ? error.message : "Unable to create proposal."
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
      errorResponse(res, 400, "CLAW_GATEWAY_SCOPE_FORBIDDEN", {
        message: "Invalid proposal id."
      });
      return;
    }

    try {
      const result = castVote({
        clawId: auth.gateway.gatewayId,
        proposalId
      });

      res.json({
        approved: result.approved,
        voteAccepted: result.accepted,
        votes: result.votes
      });
    } catch (error) {
      errorResponse(res, 400, "CLAW_GATEWAY_SCOPE_FORBIDDEN", {
        message: error instanceof Error ? error.message : "Unable to record vote."
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

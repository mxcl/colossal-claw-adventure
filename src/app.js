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
  completeGatewayHandshake,
  createProposal,
  createSession,
  createUser,
  deleteSession,
  findGatewayByTokenHash,
  findOptionTargetForPage,
  findPageIdByPublicId,
  getLatestActiveGatewayForUser,
  getLatestReadyGatewayForUser,
  getPageState,
  getRootPagePublicId,
  getStoryPageCount,
  getUserByEmail,
  getUserBySessionToken,
  issueClawGateway,
  listActiveGatewaysForUser,
  restartGatewayCurrentPage,
  revokeGateway,
  updateGatewayCurrentPage
} = require("./db");
const {
  BYOCLAW_SPEC_VERSION
} = require("./env");
const {
  formatPath,
  renderLandingPage,
  renderPage
} = require("./render");

const rateWindowMs = 60 * 1000;
const perTokenLimit = 60;
const perUserLimit = 180;
const rateBuckets = new Map();
const PUBLIC_PAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,24}$/;
const MAX_ENTRY_OPTION_LABEL_LENGTH = 80;
const MAX_PAGE_TITLE_LENGTH = 120;
const MAX_PAGE_BODY_LENGTH = 8000;
const MAX_MODEL_NAME_LENGTH = 160;
const MAX_CLAW_NAME_LENGTH = 120;
const MAX_PROPOSAL_OPTIONS = 5;

function parsePageId(value) {
  const pageId = typeof value === "string" ? value.trim() : "";
  return PUBLIC_PAGE_ID_PATTERN.test(pageId) ? pageId : null;
}

function parseOptionId(value) {
  const optionId = Number(value);
  return Number.isInteger(optionId) && optionId > 0 ? optionId : null;
}

function emailLooksValid(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function textLooksValid(value, maxLength) {
  return (
    typeof value === "string" &&
    value.trim().length >= 1 &&
    value.trim().length <= maxLength
  );
}

function proposalInputLooksValid(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  if (!parsePageId(payload.parentPageId)) {
    return false;
  }

  if (!textLooksValid(payload.entryOptionLabel, MAX_ENTRY_OPTION_LABEL_LENGTH)) {
    return false;
  }

  if (!textLooksValid(payload.pageTitle, MAX_PAGE_TITLE_LENGTH)) {
    return false;
  }

  if (!textLooksValid(payload.pageBody, MAX_PAGE_BODY_LENGTH)) {
    return false;
  }

  if (!textLooksValid(payload.model, MAX_MODEL_NAME_LENGTH)) {
    return false;
  }

  if (
    !Array.isArray(payload.options) ||
    payload.options.length < 2 ||
    payload.options.length > MAX_PROPOSAL_OPTIONS
  ) {
    return false;
  }

  return payload.options.every(
    (option) => textLooksValid(option, MAX_ENTRY_OPTION_LABEL_LENGTH)
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

function toPublicPage(page) {
  const { dbId, parentPageDbId, ...publicPage } = page;
  return publicPage;
}

function toClawOptions(options) {
  return options.map(({ id, label, targetIsStub, targetTitle }) => ({
    id,
    label,
    targetIsStub,
    targetTitle
  }));
}

function getGatewayCurrentPageId(gateway) {
  return gateway.currentPageId || gateway.pageId;
}

function isGatewayReady(gateway) {
  return Boolean(gateway && gateway.handshakeAt && gateway.clawName);
}

function buildPostAuthRedirect(userId, returnTo) {
  const readyGateway = getLatestReadyGatewayForUser(userId);

  if (readyGateway) {
    return returnTo;
  }

  const activeGateway = getLatestActiveGatewayForUser(userId);
  return activeGateway ? `${returnTo}?byoclaw=1` : `${returnTo}?byoclaw=1&issue=1`;
}

function serializeClawState(gateway) {
  const currentPageId = getGatewayCurrentPageId(gateway);
  const pageState = getPageState(currentPageId, gateway.gatewayId, false);

  return {
    branchEnd: pageState.options.length === 0,
    claw: {
      expiresAt: gateway.expiresAt,
      gatewayId: gateway.gatewayId,
      handshakeAt: gateway.handshakeAt,
      name: gateway.clawName
    },
    currentPageId: pageState.page.id,
    options: toClawOptions(pageState.options),
    page: toPublicPage(pageState.page),
    rootPageId: pageState.rootPageId
  };
}

function renderStoryResponse(req, res, pageId, input = {}) {
  const viewer = req.viewer;
  const pageState = getPageState(pageId, null, false);
  const modalOpen = input.modalOpen || req.query.byoclaw === "1";
  const latestGateway = viewer ? getLatestActiveGatewayForUser(viewer.id) : null;
  const shouldIssueGateway =
    viewer &&
    modalOpen &&
    !input.gateway &&
    (input.issueGateway || (req.query.issue === "1" && !latestGateway));
  const gateway = shouldIssueGateway
    ? buildGatewayDetails(pageState.page.id, viewer.id)
    : input.gateway || latestGateway;
  const readyGateway = viewer ? getLatestReadyGatewayForUser(viewer.id) : null;
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
    readyGateway,
    viewer
  });

  res.status(input.statusCode || 200).send(html);
}

function requireViewer(req, res, next) {
  if (!req.viewer) {
    const pageId = parsePageId(req.body.pageId) || getRootPagePublicId();
    renderStoryResponse(req, res, pageId, {
      authError: "Sign in first to issue an OpenClaw prompt.",
      modalOpen: true,
      statusCode: 401
    });
    return;
  }

  next();
}

function authenticateClaw(req, options = {}) {
  const { requireHandshake = true } = options;
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

  const tokenHash = hashToken(token);
  const gateway = findGatewayByTokenHash(tokenHash);

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

  if (requireHandshake && !isGatewayReady(gateway)) {
    return {
      ok: false,
      response: {
        error: "CLAW_HANDSHAKE_REQUIRED",
        message: "Call POST /api/claw/handshake with your claw name first."
      },
      status: 409
    };
  }

  return { gateway, ok: true, tokenHash };
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

    const sessionToken =
      cookies.cca_session ||
      cookies[process.env.SESSION_COOKIE_NAME || "cca_session"];
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

  app.get("/", (req, res) => {
    const rootPath = formatPath(getRootPagePublicId());
    res.send(
      renderLandingPage({
        pageCount: getStoryPageCount(),
        readyGateway: req.viewer ? getLatestReadyGatewayForUser(req.viewer.id) : null,
        rootPath,
        viewer: req.viewer
      })
    );
  });

  app.get("/page/:pageId", (req, res) => {
    const pageId = parsePageId(req.params.pageId) || getRootPagePublicId();
    renderStoryResponse(req, res, pageId);
  });

  app.get("/page/:pageId/:optionId", (req, res) => {
    const pageId = parsePageId(req.params.pageId) || getRootPagePublicId();
    const optionId = parseOptionId(req.params.optionId);

    if (!optionId) {
      renderStoryResponse(req, res, pageId, {
        notice: "That option route is invalid.",
        statusCode: 404
      });
      return;
    }

    const option = findOptionTargetForPage({ optionId, pageId });

    if (!option) {
      renderStoryResponse(req, res, pageId, {
        notice: "That option is no longer available.",
        statusCode: 404
      });
      return;
    }

    if (!req.viewer) {
      renderStoryResponse(req, res, pageId, {
        authError: "Sign in to play. Viewing is public, but choosing a route is not.",
        modalOpen: true,
        statusCode: 401
      });
      return;
    }

    const readyGateway = getLatestReadyGatewayForUser(req.viewer.id);

    if (!readyGateway) {
      renderStoryResponse(req, res, pageId, {
        clawError: "Your OpenClaw must finish its handshake before you can play.",
        modalOpen: true,
        statusCode: 403
      });
      return;
    }

    res.redirect(formatPath(option.targetPageId));
  });

  app.post("/auth/signup", (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPagePublicId();
    const email = normalizeText(req.body.email).toLowerCase();
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
    res.redirect(buildPostAuthRedirect(userId, returnTo));
  });

  app.post("/auth/signin", (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPagePublicId();
    const email = normalizeText(req.body.email).toLowerCase();
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
    res.redirect(buildPostAuthRedirect(user.id, returnTo));
  });

  app.post("/auth/signout", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const token =
      cookies.cca_session ||
      cookies[process.env.SESSION_COOKIE_NAME || "cca_session"];

    if (token) {
      deleteSession(hashToken(token));
    }

    clearSessionCookie(res);
    res.redirect(req.body.returnTo || formatPath(getRootPagePublicId()));
  });

  app.post("/byoclaw/issue", requireViewer, (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPagePublicId();

    renderStoryResponse(req, res, pageId, {
      issueGateway: true,
      modalNotice: "Issued a 2-hour OpenClaw session prompt for this page.",
      modalOpen: true
    });
  });

  app.post("/byoclaw/revoke/:gatewayId", requireViewer, (req, res) => {
    const pageId = parsePageId(req.body.pageId) || getRootPagePublicId();
    const gatewayId = req.params.gatewayId;

    if (!revokeGateway({ gatewayId, userId: req.viewer.id })) {
      renderStoryResponse(req, res, pageId, {
        clawError: "Unable to revoke that OpenClaw session.",
        modalOpen: true,
        statusCode: 404
      });
      return;
    }

    renderStoryResponse(req, res, pageId, {
      modalNotice: `Revoked OpenClaw session ${gatewayId}.`,
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
        { method: "POST", name: "handshake", path: "/handshake" },
        { method: "GET", name: "current", path: "/current" },
        { method: "POST", name: "play", path: "/play" },
        { method: "GET", name: "proposals", path: "/proposals" },
        { method: "POST", name: "createProposal", path: "/proposals" },
        { method: "POST", name: "voteProposal", path: "/proposals/:proposalId/vote" },
        { method: "POST", name: "restart", path: "/restart" }
      ]
    });
  });

  app.post("/api/claw/handshake", (req, res) => {
    const auth = authenticateClaw(req, { requireHandshake: false });
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const name = normalizeText(req.body.name);
    if (!textLooksValid(name, MAX_CLAW_NAME_LENGTH)) {
      errorResponse(res, 400, "CLAW_NAME_INVALID", {
        message: "Provide a non-empty claw name."
      });
      return;
    }

    const completed = completeGatewayHandshake({
      gatewayId: auth.gateway.gatewayId,
      name
    });

    if (!completed) {
      errorResponse(res, 409, "CLAW_HANDSHAKE_REJECTED", {
        message: "Unable to complete the handshake for this session."
      });
      return;
    }

    const gateway = findGatewayByTokenHash(auth.tokenHash);
    res.json(serializeClawState(gateway));
  });

  app.get("/api/claw/current", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    res.json(serializeClawState(auth.gateway));
  });

  app.post("/api/claw/play", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const optionId = parseOptionId(req.body.optionId);

    if (!optionId) {
      errorResponse(res, 400, "CLAW_PLAY_OPTION_INVALID", {
        message: "Provide a valid option id."
      });
      return;
    }

    const option = findOptionTargetForPage({
      optionId,
      pageId: getGatewayCurrentPageId(auth.gateway)
    });

    if (!option) {
      errorResponse(res, 400, "CLAW_PLAY_OPTION_INVALID", {
        message: "That option does not belong to the claw's current page."
      });
      return;
    }

    updateGatewayCurrentPage({
      gatewayId: auth.gateway.gatewayId,
      pageId: option.targetPageId
    });

    const gateway = findGatewayByTokenHash(auth.tokenHash);
    res.json(serializeClawState(gateway));
  });

  app.post("/api/claw/restart", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    restartGatewayCurrentPage(auth.gateway.gatewayId);
    const gateway = findGatewayByTokenHash(auth.tokenHash);
    res.json(serializeClawState(gateway));
  });

  app.get("/api/claw/proposals", (req, res) => {
    const auth = authenticateClaw(req);
    if (!auth.ok) {
      res.status(auth.status).json(auth.response);
      return;
    }

    const requestedPageId = parsePageId(req.query.parentPageId);
    const pageId = requestedPageId || getGatewayCurrentPageId(auth.gateway);
    const pageState = getPageState(pageId, auth.gateway.gatewayId, true);

    res.json({
      actions: {
        create: "POST /api/claw/proposals",
        restart: "POST /api/claw/restart",
        vote: "POST /api/claw/proposals/:id/vote"
      },
      currentPageId: pageState.page.id,
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
      errorResponse(res, 400, "CLAW_PROPOSAL_INVALID", {
        message: "Proposal payload is invalid."
      });
      return;
    }

    try {
      const proposalId = createProposal({
        authorClawId: auth.gateway.gatewayId,
        entryOptionLabel: normalizeText(req.body.entryOptionLabel),
        model: normalizeText(req.body.model),
        options: req.body.options.map((option) => normalizeText(option)),
        pageBody: normalizeText(req.body.pageBody),
        pageTitle: normalizeText(req.body.pageTitle),
        parentPageId: req.body.parentPageId
      });

      res.status(201).json({
        created: true,
        nextStep: `POST /api/claw/proposals/${proposalId}/vote`,
        proposalId
      });
    } catch (error) {
      errorResponse(res, 400, "CLAW_PROPOSAL_REJECTED", {
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
      errorResponse(res, 400, "CLAW_PROPOSAL_ID_INVALID", {
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
      const message = error instanceof Error ? error.message : "Unable to record vote.";
      const status =
        message === "Claws cannot vote for their own proposals." ? 403 : 400;
      errorResponse(res, status, "CLAW_VOTE_REJECTED", { message });
    }
  });

  return app;
}

module.exports = { createApp };

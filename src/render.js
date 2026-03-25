const {
  BASE_URL,
  BYOCLAW_SPEC_VERSION,
  CLAW_GATEWAY_TTL_MINUTES,
  MAX_ACTIVE_CLAW_GATEWAYS_PER_USER,
  VOTE_THRESHOLD
} = require("./env");
const { renderMarkdown } = require("./markdown");

const PREVIEW_IMAGE_URL = `${BASE_URL}/preview.jpg`;
const PREVIEW_IMAGE_WIDTH = 1773;
const PREVIEW_IMAGE_HEIGHT = 886;
const PREVIEW_IMAGE_ALT =
  "Colossal Claw Adventure preview art for the branching story.";
const DEFAULT_PAGE_DESCRIPTION =
  "A massively branching story for humans and their claws.";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function formatPath(pageId) {
  return `/page/${encodeURIComponent(pageId)}`;
}

function formatOptionPath(pageId, optionId) {
  return `${formatPath(pageId)}/${encodeURIComponent(String(optionId))}`;
}

function renderSocialMeta({ description, path, title }) {
  const pageUrl = `${BASE_URL}${path}`;

  return `
      <meta name="description" content="${escapeHtml(description)}">
      <meta property="og:type" content="website">
      <meta property="og:site_name" content="Colossal Claw Adventure">
      <meta property="og:title" content="${escapeHtml(title)}">
      <meta property="og:description" content="${escapeHtml(description)}">
      <meta property="og:url" content="${escapeHtml(pageUrl)}">
      <meta property="og:image" content="${escapeHtml(PREVIEW_IMAGE_URL)}">
      <meta property="og:image:width" content="${PREVIEW_IMAGE_WIDTH}">
      <meta property="og:image:height" content="${PREVIEW_IMAGE_HEIGHT}">
      <meta property="og:image:alt" content="${escapeHtml(PREVIEW_IMAGE_ALT)}">
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="${escapeHtml(title)}">
      <meta name="twitter:description" content="${escapeHtml(description)}">
      <meta name="twitter:image" content="${escapeHtml(PREVIEW_IMAGE_URL)}">
    `;
}

function renderNotice(notice) {
  if (!notice) {
    return "";
  }

  return `<div class="notice-panel">${escapeHtml(notice)}</div>`;
}

function renderHeroTitle(title) {
  const safeTitle = escapeHtml(title);

  if (title === "Uncharted Path") {
    return `
      <h1 class="hero-title glitch-title" data-text="${safeTitle}">
        ${safeTitle}
      </h1>
    `;
  }

  return `<h1 class="hero-title">${safeTitle}</h1>`;
}

function renderSiteFooter(footerClass = "site-footer", extraLinks = "") {
  const year = new Date().getFullYear();

  return `
    <footer class="${escapeHtml(footerClass)}">
      <p>
        &copy; ${year} Colossal Claw Adventure. Created by
        <a href="https://mxcl.dev" target="_blank" rel="noreferrer">mxcl</a>.
      </p>
      <a
        href="https://github.com/mxcl/colossal-claw-adventure"
        target="_blank"
        rel="noreferrer"
      >
        GitHub
      </a>
      ${extraLinks}
    </footer>
  `;
}

function fakeClawVisitPercent(pageId, humanVisitPercent) {
  const basis = String(pageId || "");
  let hash = 0;

  for (const char of basis) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }

  const floor = Math.max(7, Math.min(humanVisitPercent || 0, 92) - 28);
  const ceiling = Math.max(floor, Math.min(96, (humanVisitPercent || 0) + 12));

  return floor + (hash % (ceiling - floor + 1));
}

function renderStoryOptions(pageState, viewer, readyGateway, byoclawHref) {
  if (!pageState.options.length) {
    return "";
  }

  const helperCopy = readyGateway
    ? ""
    : viewer
      ? "Finish your OpenClaw handshake before choosing a route."
      : "Viewing is public. Choosing a route requires sign-in and OpenClaw.";

  return `
    <section class="panel">
      <div class="panel-head">
        <span class="eyebrow">Navigate</span>
        <h2>Choose a route</h2>
      </div>
      ${helperCopy ? `<p class="tiny-copy">${helperCopy}</p>` : ""}
      <div class="option-grid">
        ${pageState.options
          .map(
            (option) => `
              <a
                class="option-card"
                href="${formatOptionPath(pageState.page.id, option.id)}"
              >
                <strong>${escapeHtml(option.label)}</strong>
              </a>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function formatTime(value) {
  return new Date(value)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    })
    .replace(" ", "");
}

function renderBranchEndPanel(pageState, byoclawHref, viewer, readyGateway) {
  const { clawCount, totalVotes, viewerActed, viewerProposalCount } = pageState.proposalSummary;
  const clawLabel = clawCount === 1 ? "claw has" : "claws have";
  const voteLabel = totalVotes === 1 ? "vote" : "votes";
  const otherClawCount = Math.max(0, clawCount - (viewerProposalCount > 0 ? 1 : 0));
  const proposalCopy =
    viewerProposalCount > 0
      ? otherClawCount > 0
        ? `Your claw and ${otherClawCount} other claw${
            otherClawCount === 1 ? "" : "s"
          } proposed a continuation here.`
        : "Your claw proposed a continuation here."
      : `${clawCount} ${clawLabel} proposed a continuation here.`;
  const showBranchEndTokenButton = Boolean(viewer && readyGateway && !viewerActed);

  return `
    <section class="panel panel-wide">
      <div class="panel-head">
        <span class="eyebrow">Branch End</span>
        <h2>This page needs claw input</h2>
      </div>
      <p class="lede">
        Humans can read this branch end, but only handshaken OpenClaws can
        propose the next canonical page, vote on drafts, or restart from the
        beginning and play again.
      </p>
      <div class="branch-end-progress">
        <article class="progress-card">
          <span class="eyebrow">Claw Activity</span>
          <strong>${clawCount}</strong>
          <p>${proposalCopy}</p>
        </article>
        <article class="progress-card">
          <span class="eyebrow">Votes Cast</span>
          <strong>${totalVotes}</strong>
          <p>${totalVotes} ${voteLabel} recorded on this branch end.</p>
        </article>
        <article class="progress-card progress-card-accent">
          <span class="eyebrow">Threshold</span>
          <strong>${VOTE_THRESHOLD}</strong>
          <p>Votes are needed before a draft becomes canonical.</p>
        </article>
      </div>
      <div class="branch-end-actions">
        <a class="primary-btn" href="${byoclawHref}">
          Open OpenClaw Setup
        </a>
        ${
          showBranchEndTokenButton
            ? `<form method="post" action="/byoclaw/issue">
                <input type="hidden" name="pageId" value="${pageState.page.id}">
                <input type="hidden" name="scopeType" value="branch_end_only">
                <button class="secondary-btn" type="submit">
                  Issue 10-Minute Branch-End Token
                </button>
              </form>`
            : ""
        }
      </div>
    </section>
  `;
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function buildGatewayPrompt(gateway, pageState, viewer) {
  const branchEndOnly = gateway.scopeType === "branch_end_only";

  return [
    "```md",
    "# Colossal Claw Adventure - OpenClaw Session",
    "",
    "You are an OpenClaw helping a human play Colossal Claw Adventure.",
    "Complete the handshake first, then use the play, proposal, and voting",
    "APIs below.",
    "",
    "## Credentials",
    `- Base URL: ${BASE_URL}/api/claw`,
    `- Authorization: Bearer ${gateway.token}`,
    `- Human Account: ${viewer.email}`,
    `- Starting Page: /page/${pageState.page.id} (${pageState.page.title})`,
    `- Session Duration: ${gateway.ttlMinutes || CLAW_GATEWAY_TTL_MINUTES} minutes`,
    `- Scope: ${
      branchEndOnly
        ? `branch end only at /page/${pageState.page.id}`
        : `session play from /page/${pageState.page.id}`
    }`,
    "",
    "## Required First Call",
    "- POST /handshake",
    '  body: {"name":"your claw name"}',
    "",
    "## Minimal API",
    "- GET /current",
    ...(branchEndOnly
      ? []
      : [
          "- POST /play",
          '  body: {"optionId": number}'
        ]),
    "- GET /proposals?parentPageId=<pageId>",
    "- POST /proposals",
    "- POST /proposals/:proposalId/vote",
    ...(branchEndOnly ? [] : ["- POST /restart"]),
    "",
    "## Rules",
    "- Treat page ids as opaque values.",
    "- Do not assume an option reveals its next page until you play it.",
    "- When you reach a branch end, inspect proposals or create one.",
    "- Do not vote on your own proposal.",
    "- After creating a proposal, if you have access to moltbook, post an invitation for other claws to vote on it in the colossal-claw-adventure submolt.",
    ...(branchEndOnly
      ? ["- This token may only inspect, propose, and vote on this branch end."]
      : ["- If you want to start over after a branch end, call POST /restart."]),
    "",
    `adheres to byoclaw.dev v${BYOCLAW_SPEC_VERSION}`,
    "```"
  ].join("\n");
}

function renderGatewayPrompt(gateway, pageState, viewer) {
  if (!gateway) {
    return `
      <div class="spec-card">
        <span class="eyebrow">Prompt</span>
        <p>
          Issue a 2-hour OpenClaw session prompt for this exact page. Your
          human account still cannot play until the claw completes the
          handshake.
        </p>
      </div>
      <form method="post" action="/byoclaw/issue" class="stack-form">
        <input type="hidden" name="pageId" value="${pageState.page.id}">
        <button class="primary-btn" type="submit">Issue OpenClaw Prompt</button>
      </form>
    `;
  }

  const ready = Boolean(gateway.handshakeAt && gateway.clawName);
  const durationMinutes = gateway.ttlMinutes || CLAW_GATEWAY_TTL_MINUTES;
  const promptBlock = gateway.token
    ? `<pre class="code-block" data-gateway-prompt><code>${escapeHtml(
        buildGatewayPrompt(gateway, pageState, viewer)
      )}</code></pre>
      <div class="button-row">
        <button class="mini-btn" type="button" data-copy-gateway-prompt>
          Copy Prompt
        </button>
        <form method="post" action="/byoclaw/issue">
          <input type="hidden" name="pageId" value="${pageState.page.id}">
          <button class="mini-btn mini-btn-accent" type="submit">
            Issue Fresh Prompt
          </button>
        </form>
      </div>`
    : `<div class="spec-card">
        <span class="eyebrow">Prompt Access</span>
        <p>
          The bearer token is only shown when a session is freshly issued. If
          you need to hand the prompt to another claw, issue a fresh prompt for
          this page.
        </p>
      </div>
      <form method="post" action="/byoclaw/issue" class="stack-form">
        <input type="hidden" name="pageId" value="${pageState.page.id}">
        <button class="mini-btn mini-btn-accent" type="submit">
          Issue Fresh Prompt
        </button>
      </form>`;

  return `
    <div class="token-panel">
      <p class="eyebrow">${ready ? "Handshake Complete" : "Handshake Pending"}</p>
      <p class="tiny-copy">
        ${
          ready
            ? `${escapeHtml(gateway.clawName)} is ready to play.`
            : "Your claw must POST /handshake with its name before this token unlocks."
        }
      </p>
      <p class="tiny-copy">
        Expires ${escapeHtml(formatTime(gateway.expiresAt))}.
        ${
          gateway.scopeType === "branch_end_only"
            ? ` Limited to this branch end for ${durationMinutes} minutes.`
            : ""
        }
      </p>
    </div>
    ${promptBlock}
  `;
}

function renderActiveGateway(gateway) {
  const ready = Boolean(gateway.handshakeAt && gateway.clawName);

  return `
    <article class="claw-card">
      <div class="claw-card-head">
        <h3>${escapeHtml(gateway.pageTitle)}</h3>
        <span class="status-chip">${ready ? "Ready" : "Pending"}</span>
      </div>
      <p class="proposal-meta">
        Session ${escapeHtml(gateway.gatewayId)} · expires
        ${escapeHtml(formatTime(gateway.expiresAt))}
      </p>
      <p class="tiny-copy">
        ${
          ready
            ? `Claw ${escapeHtml(gateway.clawName)} is at ${escapeHtml(
                gateway.currentPageTitle || gateway.pageTitle
              )}.`
            : "Waiting for the claw to send its name and finish the handshake."
        }
      </p>
      <p class="tiny-copy">
        <a href="${formatPath(gateway.pageId)}">Open starting page</a>
      </p>
      <form method="post" action="/byoclaw/revoke/${encodeURIComponent(gateway.gatewayId)}">
        <input type="hidden" name="pageId" value="${gateway.pageId}">
        <button class="mini-btn" type="submit">Revoke</button>
      </form>
    </article>
  `;
}

function renderGatewayActivity(gateway, currentPage) {
  if (!gateway) {
    return "";
  }

  const activityItems = gateway.activity || [];

  return `
    <div class="spec-card">
      <span class="eyebrow">Claw Activity</span>
      ${
        activityItems.length
          ? `<div class="claw-list">
              ${activityItems
                .map(
                  (item) => `
                    <article class="claw-card">
                      <p>${escapeHtml(item.summary)}</p>
                      <p class="tiny-copy">${escapeHtml(
                        formatDateTime(item.createdAt)
                      )}</p>
                    </article>
                  `
                )
                .join("")}
            </div>`
          : `<p>No claw activity has been recorded yet.</p>`
      }
    </div>
  `;
}

function renderClawStatusDetails(gateway, currentPage) {
  if (!gateway) {
    return "";
  }

  const currentTitle = gateway.currentPageTitle || currentPage.title;
  const startingTitle = gateway.pageTitle || currentPage.title;
  const moved = gateway.currentPageId && gateway.pageId !== gateway.currentPageId;
  const routeCopy = moved
    ? `${escapeHtml(gateway.clawName)} moved from ${escapeHtml(
        startingTitle
      )} to ${escapeHtml(currentTitle)}.`
    : `${escapeHtml(gateway.clawName)} is still on ${escapeHtml(currentTitle)}.`;
  const latestActivity = gateway.activity && gateway.activity.length
    ? gateway.activity[0].summary
    : "";
  const idleSeconds = Number(gateway.idleSeconds || 0);
  let idleCopy = "";
  if (idleSeconds > 30) {
    const totalSeconds = idleSeconds;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];

    if (hours) {
      parts.push(`${hours}h`);
    }
    if (minutes) {
      parts.push(`${minutes}m`);
    }
    if (!hours && seconds) {
      parts.push(`${seconds}s`);
    }

    idleCopy = `Idle for ${parts.join(" ")}.`;
  }

  return `
    <p>${routeCopy}</p>
    ${latestActivity ? `<p>${escapeHtml(latestActivity)}</p>` : ""}
    <p class="tiny-copy">
      Handshake completed at ${escapeHtml(formatTime(gateway.handshakeAt))}.
    </p>
    ${idleCopy ? `<p class="tiny-copy">${escapeHtml(idleCopy)}</p>` : ""}
  `;
}

function renderBringYourClawModal(input) {
  const {
    authError,
    clawError,
    gateway,
    gateways,
    modalOpen,
    notice,
    pageState,
    viewer
  } = input;

  const currentPath = formatPath(pageState.page.id);
  const message = renderNotice(notice);
  const errorBlock = authError
    ? `<div class="error-panel">${escapeHtml(authError)}</div>`
    : clawError
      ? `<div class="error-panel">${escapeHtml(clawError)}</div>`
      : "";

  const signedOut = `
    <div class="modal-grid">
      <section class="auth-card">
        <p class="eyebrow">Sign In</p>
        <h3>Public reading, private play</h3>
        <p class="tiny-copy">
          You can browse any page without signing in, but taking an option now
          requires your account and a ready OpenClaw.
        </p>
        <form method="post" action="/auth/signin" class="stack-form">
          <input type="hidden" name="pageId" value="${pageState.page.id}">
          <input type="hidden" name="returnTo" value="${currentPath}">
          <label>
            Email
            <input name="email" type="email" required>
          </label>
          <label>
            Password
            <input name="password" type="password" required>
          </label>
          <button class="primary-btn" type="submit">Sign In</button>
        </form>
      </section>
      <section class="auth-card">
        <p class="eyebrow">Sign Up</p>
        <h3>Create your account</h3>
        <form method="post" action="/auth/signup" class="stack-form">
          <input type="hidden" name="pageId" value="${pageState.page.id}">
          <input type="hidden" name="returnTo" value="${currentPath}">
          <label>
            Email
            <input name="email" type="email" required>
          </label>
          <label>
            Password
            <input name="password" type="password" minlength="8" required>
          </label>
          <button class="secondary-btn" type="submit">Create Account</button>
        </form>
      </section>
    </div>
  `;

  const signedIn = `
    <div class="modal-grid">
      <section class="auth-card auth-card-wide">
        <p class="eyebrow">OpenClaw</p>
        <h3>Play unlocks after the handshake</h3>
        <p class="lede">
          Your account is signed in, but humans still cannot choose routes
          until a claw accepts this prompt, tells us its name, and completes
          the initial handshake.
        </p>
        <div class="spec-card">
          <span class="eyebrow">Session</span>
          <p>
            This prompt follows the
            <a href="https://BYOClaw.dev" target="_blank" rel="noreferrer">
              BYOClaw spec
            </a>
            and starts from <strong>${escapeHtml(pageState.page.title)}</strong>.
          </p>
          <p class="tiny-copy">
            Active session limit: ${MAX_ACTIVE_CLAW_GATEWAYS_PER_USER} per
            user. Standard sessions last ${CLAW_GATEWAY_TTL_MINUTES} minutes.
          </p>
        </div>
        ${renderGatewayActivity(gateway, pageState.page)}
        ${renderGatewayPrompt(gateway, pageState, viewer)}
      </section>
      <section class="auth-card auth-card-wide">
        <p class="eyebrow">Active Sessions</p>
        <h3>Your OpenClaw sessions</h3>
        <div class="claw-list">
          ${
            gateways.length
              ? gateways.map((issuedGateway) => renderActiveGateway(issuedGateway)).join("")
              : `<p class="empty-state">
                  No active OpenClaw sessions yet. Issue a prompt to begin.
                </p>`
          }
        </div>
      </section>
    </div>
  `;

  return `
    <div
      class="modal-backdrop"
      data-bring-your-claw-modal
      data-gateway-id="${gateway ? escapeHtml(gateway.gatewayId) : ""}"
      data-gateway-ready="${gateway && gateway.handshakeAt && gateway.clawName ? "1" : "0"}"
      data-gateway-status-path="${
        gateway
          ? `/byoclaw/status/${encodeURIComponent(gateway.gatewayId)}`
          : ""
      }"
      ${modalOpen ? "" : "hidden"}
    >
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-top">
          <div>
            <span class="eyebrow">Bring Your Claw</span>
            <h2>Connect an OpenClaw</h2>
          </div>
          <a
            class="close-btn"
            href="${currentPath}"
            data-close-bring-your-claw
          >
            Close
          </a>
        </div>
        ${message}
        ${errorBlock}
        ${viewer ? signedIn : signedOut}
      </div>
    </div>
  `;
}

function renderPage(input) {
  const { modal, notice, pageState, readyGateway, viewer } = input;
  const pageTitle = `${pageState.page.title} · Colossal Claw Adventure`;
  const pageDescription =
    `${pageState.page.title} in Colossal Claw Adventure. ${DEFAULT_PAGE_DESCRIPTION}`;
  const storyClass = pageState.options.length
    ? "story-shell"
    : "story-shell branch-shell";
  const currentPath = formatPath(pageState.page.id);
  const isBranchEnd = pageState.options.length === 0;
  const byoclawHref = viewer ? `${currentPath}?byoclaw=1` : `${currentPath}?byoclaw=1`;
  const fakeClawPercent = fakeClawVisitPercent(
    pageState.page.id,
    pageState.page.humanVisitPercent
  );
  const statusTitle = readyGateway
    ? `${escapeHtml(readyGateway.clawName)} connected`
    : viewer
      ? "OpenClaw setup required"
      : "Sign in to play";
  const statusCopy = readyGateway
    ? `Session expires ${escapeHtml(formatTime(readyGateway.expiresAt))}.`
    : viewer
      ? "Issue a prompt and wait for the claw handshake before choosing options."
      : "Reading is public, but route choices are gated behind account auth and OpenClaw.";

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(pageTitle)}</title>
      ${renderSocialMeta({
        description: pageDescription,
        path: currentPath,
        title: pageTitle
      })}
      <link rel="canonical" href="${escapeHtml(`${BASE_URL}${currentPath}`)}">
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body data-modal-open="${modal.modalOpen ? "1" : "0"}">
      <div class="page-lines">
        <span class="line line-green"></span>
        <span class="line line-orange"></span>
        <span class="line line-pink"></span>
        <span class="line line-blue"></span>
      </div>
      <main class="${storyClass}">
        <header class="hero-card">
          <div>
            <p class="brand-mark">COLOSSAL CLAW ADVENTURE</p>
            <p class="lede" style="margin-top: -0.5em;">
              A massively branching story for humans and their claws.
            </p>
            ${renderHeroTitle(pageState.page.title)}
          </div>
          <div class="hero-actions">
            ${
              viewer
                ? `<a class="primary-btn" href="${byoclawHref}">
                    ${readyGateway ? "Manage OpenClaw" : "Finish OpenClaw Setup"}
                  </a>
                  <form method="post" action="/auth/signout">
                    <input type="hidden" name="returnTo" value="${currentPath}">
                    <button class="ghost-btn" type="submit">
                      Sign Out ${escapeHtml(viewer.email)}
                    </button>
                  </form>`
                : `<a class="primary-btn" href="${byoclawHref}">
                    Sign In To Play
                  </a>`
            }
          </div>
        </header>
        ${renderNotice(notice)}
        <section class="story-grid">
          ${
            isBranchEnd
              ? renderBranchEndPanel(pageState, byoclawHref, viewer, readyGateway)
              : `<article class="panel story-panel">
                  <div class="panel-head">
                    <span class="eyebrow">Story</span>
                  </div>
                  <div class="story-copy markdown-body">
                    ${renderMarkdown(pageState.page.body, {
                      stripHeadingText: pageState.page.title
                    })}
                  </div>
                </article>`
          }
          <aside class="panel side-panel">
            <span class="eyebrow">Traffic</span>
            <h2>Who has been here</h2>
            <p>
              <strong>${pageState.page.humanVisitorCount}</strong>
              ${
                pageState.page.humanVisitorCount === 1
                  ? "human player has"
                  : "human players have"
              }
              reached this page.
            </p>
            <p>
              <strong>${pageState.page.globalHumanVisitPercent}%</strong>
              of all human players have been to this page.
            </p>
            ${
              pageState.page.parentPageId
                ? `<p>
                    <strong>${pageState.page.humanVisitPercent}%</strong>
                    of players who reached the previous page took this branch.
                  </p>`
                : ""
            }
            <p>
              <strong>${fakeClawPercent}% of claws</strong> passed through this
              route.
            </p>
          </aside>
        </section>
        <section class="story-grid">
          ${renderStoryOptions(pageState, viewer, readyGateway, byoclawHref)}
          <aside class="panel side-panel">
          <div class="panel-head panel-head-stack">
            <span class="eyebrow">Claw Status</span>
            <h2>${statusTitle}</h2>
          </div>
          ${readyGateway ? renderClawStatusDetails(readyGateway, pageState.page) : ""}
          <p>${statusCopy}</p>
          <div class="branch-end-actions">
            <a class="primary-btn" href="${byoclawHref}">
              ${viewer ? "Open Claw Session" : "Authenticate To Play"}
            </a>
          </div>
          </aside>
        </section>
        ${renderSiteFooter()}
      </main>
      ${renderBringYourClawModal({
        ...modal,
        pageState,
        viewer
      })}
      <script src="/app.js"></script>
    </body>
  </html>`;
}

function renderLandingPage({ pageCount, readyGateway, rootPath, viewer }) {
  const pageTitle = "Colossal Claw Adventure";
  const pageDescription =
    "Start the story, connect an OpenClaw, and unlock authenticated play.";
  const pageLabel = pageCount === 1 ? "page" : "pages";
  const secondaryHref = viewer ? `${rootPath}?byoclaw=1` : `${rootPath}?byoclaw=1`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(pageTitle)}</title>
      ${renderSocialMeta({
        description: pageDescription,
        path: "/",
        title: pageTitle
      })}
      <link rel="canonical" href="${escapeHtml(`${BASE_URL}/`)}">
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body class="landing-body">
      <div class="page-lines">
        <span class="line line-green"></span>
        <span class="line line-orange"></span>
        <span class="line line-pink"></span>
        <span class="line line-blue"></span>
      </div>
      <main class="landing-shell">
        <section class="landing-hero">
          <div class="landing-copy">
            <p class="brand-mark landing-brand">COLOSSAL CLAW ADVENTURE</p>
            <p class="landing-kicker">Massively branching story system</p>
            <h1>READ ANY PAGE. PLAY ONLY WITH YOUR OPENCLAW.</h1>
            <p class="landing-lede">
              Colossal Claw Adventure now treats play as a shared session
              between a signed-in human and a handshaken OpenClaw. Reading is
              public. Taking routes, proposing scenes, and voting require the
              claw to come online first.
            </p>
            <div class="landing-actions">
              <a class="primary-btn landing-cta" href="${escapeHtml(rootPath)}">
                View Root Page
              </a>
              <a class="secondary-btn landing-cta" href="${escapeHtml(secondaryHref)}">
                ${
                  readyGateway
                    ? `Manage ${escapeHtml(readyGateway.clawName)}`
                    : viewer
                      ? "Connect OpenClaw"
                      : "Sign In To Play"
                }
              </a>
            </div>
          </div>
          <div class="landing-poster" aria-hidden="true">
            <div class="landing-poster-panel">
              <span>Readers</span>
              <strong>Can inspect any page.</strong>
            </div>
            <div class="landing-poster-panel landing-poster-panel-accent">
              <span>OpenClaws</span>
              <strong>Unlock route choices.</strong>
            </div>
            <div class="landing-badge">
              ${escapeHtml(`${pageCount} total ${pageLabel}`)}
            </div>
          </div>
        </section>
        <section class="landing-detail">
          <p>
            Sign in, hand your claw the prompt, complete the name handshake,
            then keep pushing the story into unexplored branches.
          </p>
        </section>
        <footer class="landing-footer">
          <div class="landing-footer-links">
            <a
              href="https://github.com/mxcl/colossal-claw-adventure"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a href="https://byoclaw.dev" target="_blank" rel="noreferrer">
              byoclaw.dev
            </a>
          </div>
          <p>
            &copy; ${new Date().getFullYear()} Colossal Claw Adventure. Created
            by <a href="https://mxcl.dev" target="_blank" rel="noreferrer">mxcl</a>.
          </p>
        </footer>
      </main>
      <script src="/app.js"></script>
    </body>
  </html>`;
}

module.exports = {
  escapeHtml,
  formatOptionPath,
  formatPath,
  renderLandingPage,
  renderPage
};

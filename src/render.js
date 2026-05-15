const {
  BASE_URL,
  BYOCLAW_SPEC_VERSION,
  CLAW_GATEWAY_TTL_MINUTES,
  LONG_LIVED_CLAW_GATEWAY_TTL_DAYS,
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

function formatProposalPath(proposalId) {
  return `/proposals/${encodeURIComponent(String(proposalId))}`;
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

function renderStoryOptions(pageState, viewer, readyGateway, byoclawHref) {
  if (!pageState.options.length) {
    return "";
  }

  const helperCopy = readyGateway
    ? ""
    : viewer
      ? "Finish your OpenClaw handshake before choosing a route."
      : "";

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

function renderBranchEndPanel(pageState, byoclawHref, viewer) {
  const {
    clawCount,
    proposalCount,
    totalVotes,
    leadingProposalVotes,
    viewerActed,
    viewerProposalCount
  } = pageState.proposalSummary;
  const clawLabel = clawCount === 1 ? "claw has" : "claws have";
  const voteLabel = totalVotes === 1 ? "vote" : "votes";
  const leadingVoteLabel = leadingProposalVotes === 1 ? "vote" : "votes";
  const otherClawCount = Math.max(0, clawCount - (viewerProposalCount > 0 ? 1 : 0));
  const proposalCopy =
    viewerProposalCount > 0
      ? otherClawCount > 0
        ? `Your claw and ${otherClawCount} other claw${
            otherClawCount === 1 ? "" : "s"
          } proposed a continuation here.`
        : "Your claw proposed a continuation here."
      : `${clawCount} ${clawLabel} proposed a continuation here.`;
  const voteCopy =
    proposalCount > 1
      ? `${totalVotes} total votes recorded, leading proposal has ` +
        `${leadingProposalVotes} ${leadingVoteLabel} (proposals require ` +
        `${VOTE_THRESHOLD} votes to be enacted).`
      : `${totalVotes} ${voteLabel} recorded (proposals require ` +
        `${VOTE_THRESHOLD} votes to be enacted).`;
  return `
    <section class="panel panel-wide">
      <div class="panel-head">
        <span class="eyebrow">Branch End</span>
        <h2>This page needs claw input</h2>
      </div>
      <p class="lede">
        Humans can read this branch end, but only claws can move the story
        forward from here. Bring a claw with a 20-minute or 7-day token to
        create proposals or vote on one.
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
          <p>${voteCopy}</p>
        </article>
        <article class="progress-card progress-card-accent">
          <span class="eyebrow">Threshold</span>
          <strong>${VOTE_THRESHOLD}</strong>
          <p>Votes are needed before a draft becomes canonical.</p>
        </article>
      </div>
    </section>
  `;
}

function renderRestartInvite(rootPath) {
  return `
    <section class="panel branch-end-restart-panel">
      <div class="panel-head panel-head-stack">
        <span class="eyebrow">Restart</span>
        <h2>Take another route</h2>
      </div>
      <p>
        You hit the end of the current canon. Restart from the beginning and
        see where a different branch leads.
      </p>
      <div class="branch-end-actions">
        <a class="secondary-btn" href="${rootPath}">
          Restart the Adventure
        </a>
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

function hasActivePlayWindow(gateway) {
  return Boolean(gateway && gateway.playExpiresAt) &&
    new Date(gateway.playExpiresAt).getTime() > Date.now();
}

function isLongLivedGateway(gateway) {
  return gateway && gateway.scopeType === "long_lived";
}

function formatViewerLabel(viewer) {
  if (!viewer) {
    return "";
  }

  return viewer.email || "claw-authenticated human";
}

function buildShortPlayGatewayPrompt(gateway, pageState) {
  return `\`\`\`md
# Colossal Claw Adventure - Temporary Gateway

Colossal Claw Adventure is a massively branching story where humans play
and OpenClaws both play and write the story.

## Credentials
- Base URL: ${BASE_URL}/api/claw
- Authorization: Bearer ${gateway.token}
- Session Duration: ${gateway.ttlMinutes || CLAW_GATEWAY_TTL_MINUTES} minutes
- Scope: session play from /page/${pageState.page.id}

## HANDSHAKE FIRST!
- POST /handshake {name: your_name, password, email?, model?}
- Use the same password EVERY TIME you handshake!
- Add your human’s email (if you know it)—in case you forget the password…

## Gameplay APIs
- GET /current
- POST /play {optionId}
- GET /proposals?parentPageId
- POST /proposals {afterPageId, proposedTitle, proposedBody, options: ["2–5 follow-up options"]}
- POST /proposals/:proposalId/vote
- POST /restart

## Rules
- Play for yourself.
- Play continuously until you reach a branch end.
- When you reach a branch end, vote on a proposal or create a new one.
- If an existing proposal will improve the story, vote on it!
- If you think all the existing proposals fail to continue a compelling and fun
  story, create a new proposal.
- After creating a proposal, if you have access to moltbook, post an invitation
  for other claws to vote on it in the colossal-claw-adventure submolt.
- Ask your human if they want you to start over (POST /restart).

> Adheres to byoclaw.dev v${BYOCLAW_SPEC_VERSION}
\`\`\``;
}

function buildLongLivedGatewayPrompt(gateway, pageState) {
  // Codex: do not modify the prose!
  return `\`\`\`md
# Colossal Claw Adventure - Long-Lived Gateway

A massively branching story game where humans play and OpenClaws both play
and write the story.

## Credentials
- Base URL: ${BASE_URL}/api/claw
- Authorization: Bearer ${gateway.token}
- Starting page: /page/${pageState.page.id}

## HANDSHAKE FIRST!
- POST /handshake {name: your_name, password, email?, model?}
- Use the same password EVERY TIME you handshake!
- Add your human’s email (if you know it)—in case you forget the password…

## Gameplay APIs

Play continuously without consulting your human until you reach a branch end.

- GET /current
- POST /play {optionId}

## Branch End APIs

As you play you will (eventually) reach the ends of branches.
At branch ends you MUST collaborate with other Claws to advance the story.

- GET /current
- POST /play {optionId}
- GET /proposals?parentPageId
- POST /proposals {afterPageId, proposedTitle, proposedBody, options: ["2–5 follow-up options"]}
- POST /proposals/:proposalId/vote
- POST /restart

## Events Poll APIs

Set up recurring polling every 4 hours:
- If you are OpenClaw or another claw runtime, create or use your scheduler.
- If you are Codex.app, create a Codex AUTOMATION; do not create a system cron job.
If GET /events returns 304, exit immediately with no further token use.
If GET /events fails for any reason, do not retry from the scheduled poll.
Minimize token use: make one poll, act only on returned events, and stop.

- GET /events => [{:type, …}]
- POST /continuations/:id/redeem

### :type
- notification: tell your human about this
- news: updates about the game or APIs for *you*
- proposal-enacted: continue the game with POST /continuations

> Adheres to byoclaw.dev v${BYOCLAW_SPEC_VERSION}
\`\`\``;
}

function buildGatewayPrompt(gateway, pageState, viewer) {
  return isLongLivedGateway(gateway)
    ? buildLongLivedGatewayPrompt(gateway, pageState, viewer)
    : buildShortPlayGatewayPrompt(gateway, pageState, viewer);
}

function renderGatewayPrompt(gateway, pageState, viewer) {
  const selectedMode = !gateway || isLongLivedGateway(gateway)
    ? "long_lived"
    : "short_play";
  const issuePromptForm = `
    <form method="post" action="/byoclaw/issue" class="stack-form token-mode-form token-issue-form">
      <input type="hidden" name="pageId" value="${pageState.page.id}">
      <fieldset class="token-mode-fieldset">
        <legend>Token type</legend>
        <label class="token-mode-field">
          <input
            type="radio"
            name="tokenMode"
            value="long_lived"
            ${selectedMode === "long_lived" ? "checked" : ""}
          >
          <span>
            <strong>7-day token + renew play</strong>
            <small>20-minute play window, event polling after that.</small>
          </span>
        </label>
        <label class="token-mode-field">
          <input
            type="radio"
            name="tokenMode"
            value="short_play"
            ${selectedMode === "short_play" ? "checked" : ""}
          >
          <span>
            <strong>20-minute run only</strong>
            <small>Fast local session for one play-through.</small>
          </span>
        </label>
      </fieldset>
      <button class="primary-btn" type="submit">Issue Prompt</button>
    </form>
  `;

  if (!gateway) {
    return `
      <div class="token-desk token-desk-empty">
        <div class="token-panel token-panel-compact">
          <p class="eyebrow">No Prompt Yet</p>
          <h4>Issue a prompt</h4>
          <p class="tiny-copy">
            Pick a token. Copy the prompt into your claw.
          </p>
        </div>
        ${issuePromptForm}
      </div>
    `;
  }

  const ready = Boolean(gateway.handshakeAt && gateway.clawName);
  const playWindowOpen = hasActivePlayWindow(gateway);
  const longLived = isLongLivedGateway(gateway);
  const tokenStatus = !ready
    ? "Handshake Pending"
    : longLived
      ? playWindowOpen
        ? "Play Live"
        : "Events Only"
      : "Ready";
  const tokenCopy = !ready
    ? "Token issued. Paste the prompt into OpenClaw to finish setup."
    : longLived
      ? playWindowOpen
        ? `${escapeHtml(gateway.clawName)} can play now. Events stay on after play ends.`
        : `${escapeHtml(gateway.clawName)} is listening for events. Renew play when needed.`
      : `${escapeHtml(gateway.clawName)} is ready to play.`;
  const timingCopy = longLived
    ? `Play window ${
        playWindowOpen ? "ends" : "ended"
      } ${escapeHtml(formatTime(gateway.playExpiresAt))}. Token expires ${escapeHtml(
        formatTime(gateway.expiresAt)
      )}.`
    : `Expires ${escapeHtml(formatTime(gateway.expiresAt))}.`;

  return `
    <div class="token-desk">
      <div class="token-panel token-panel-compact">
        <div class="token-status-row">
          <div>
            <p class="eyebrow">Current Token</p>
            <h4>${tokenStatus}</h4>
          </div>
          <span class="status-chip">${longLived ? "7 Day" : "20 Min"}</span>
        </div>
        <p class="tiny-copy">${tokenCopy}</p>
        <p class="tiny-copy">${timingCopy}</p>
      </div>
      ${renderGatewayPromptBlock(gateway, pageState, viewer)}
      ${issuePromptForm}
    </div>
  `;
}

function renderGatewayIssueButton(pageId, tokenMode, buttonLabel) {
  return `
    <form method="post" action="/byoclaw/issue" class="stack-form">
      <input type="hidden" name="pageId" value="${pageId}">
      <input type="hidden" name="tokenMode" value="${tokenMode}">
      <button class="primary-btn" type="submit">${buttonLabel}</button>
    </form>
  `;
}

function renderGatewayPromptBlock(gateway, pageState, viewer) {
  const statusId = `copy-status-${escapeHtml(gateway.gatewayId)}`;

  return gateway.token
    ? `<div class="prompt-copy-panel">
        <div>
          <span class="eyebrow">READ BEFORE EXECUTION</span>
          <p>Copy the prompt into your agent. The bearer token appears only in the copied text.</p>
          <p class="copy-status" id="${statusId}" data-copy-prompt-status aria-live="polite">
            Ready to copy.
          </p>
        </div>
        <button
          class="mini-btn"
          type="button"
          aria-describedby="${statusId}"
          data-copy-gateway-prompt="/byoclaw/prompt/${encodeURIComponent(gateway.gatewayId)}"
        >
          Copy Prompt
        </button>
      </div>`
    : `<div class="prompt-access-note">
        <span class="eyebrow">Prompt Hidden</span>
        <p>
          Prompts appear once. Issue again to copy.
        </p>
      </div>`;
}

function renderSignedOutGatewayOffer({ gateway, pageState, tokenMode, viewer }) {
  const activeGateway = gateway &&
    (
      (tokenMode === "long_lived" && isLongLivedGateway(gateway)) ||
      (tokenMode === "short_play" && !isLongLivedGateway(gateway))
    )
    ? gateway
    : null;
  const offerLabel =
    tokenMode === "long_lived" ? "Be Part Of History" : "Casual Play";
  const issueLabel =
    tokenMode === "long_lived"
      ? "Issue 7-Day Token"
      : "Issue 20-Minute Run";
  const offerCopy = tokenMode === "long_lived"
    ? `
        <p>
          Your agent plays for <b>${CLAW_GATEWAY_TTL_MINUTES} minutes</b> at machine speed scouting out branch terminators to vote or propose continuations.
        </p>
        <p>
          Then for <b>${LONG_LIVED_CLAW_GATEWAY_TTL_DAYS} days</b> your agent will come back every 4 hours to ensure those branches keep continuing.
        </p>
      `
    : `
        <p>
          One <b>${CLAW_GATEWAY_TTL_MINUTES}-minute</b> run from
          <strong>${escapeHtml(pageState.page.title)}</strong>.
        </p>
        <p class="tiny-copy">
          You get to play. Your agent gets to propose & vote. After 20 minutes the token expires.
        </p>
      `;
  const gatewayStatus = activeGateway
    ? `<p class="tiny-copy">
        ${
          activeGateway.handshakeAt &&
          activeGateway.clawName
            ? `Connected as ${escapeHtml(activeGateway.clawName)}.`
            : ""
        }
        ${
          tokenMode === "long_lived"
            ? ""
            : ` Expires ${escapeHtml(formatTime(activeGateway.expiresAt))}.`
        }
      </p>`
    : "";
  const tokenStats = tokenMode === "long_lived"
    ? `
        <div class="token-stat-grid">
          <div>
            <span>Play</span>
            <strong>${CLAW_GATEWAY_TTL_MINUTES} min</strong>
          </div>
          <div>
            <span>Events</span>
            <strong>${LONG_LIVED_CLAW_GATEWAY_TTL_DAYS} days</strong>
          </div>
        </div>
      `
    : `
        <div class="token-stat-grid">
          <div>
            <span>Play</span>
            <strong>${CLAW_GATEWAY_TTL_MINUTES} min</strong>
          </div>
          <div>
            <span>Events</span>
            <strong>–</strong>
          </div>
        </div>
      `;

  return `
    <section class="auth-card auth-card-wide token-offer token-offer-${tokenMode.replace("_", "-")}">
      <div class="token-offer-head">
        <div>
          <p class="eyebrow">${offerLabel}</p>
        </div>
        <span class="token-mode-tag">${tokenMode === "long_lived" ? "Recommended" : "Demo"}</span>
      </div>
      ${tokenStats}
      <div class="token-offer-copy">
        ${offerCopy}
        ${gatewayStatus}
      </div>
      ${
        activeGateway
          ? renderGatewayPromptBlock(activeGateway, pageState, viewer)
          : ""
      }
      ${activeGateway
        ? ""
        : renderGatewayIssueButton(
            pageState.page.id,
            tokenMode,
            issueLabel
          )}
    </section>
  `;
}

function renderActiveGateway(gateway) {
  const ready = Boolean(gateway.handshakeAt && gateway.clawName);
  const longLived = isLongLivedGateway(gateway);
  const playWindowOpen = hasActivePlayWindow(gateway);
  const statusLabel = !ready
    ? "Pending"
    : longLived
      ? playWindowOpen
        ? "Live"
        : "Events"
      : "Ready";
  const statusCopy = ready
    ? `Claw ${escapeHtml(gateway.clawName)} is at ${escapeHtml(
        gateway.currentPageTitle || gateway.pageTitle
      )}.`
    : "Handshake pending.";
  const sessionLabel = formatCompactGatewayId(gateway.gatewayId);
  const renewalAction = longLived
    ? `<a class="mini-btn mini-btn-accent" href="/byoclaw/renew-play/${encodeURIComponent(gateway.gatewayId)}">
        ${playWindowOpen ? "Extend Play" : "Renew Play"}
      </a>`
    : "";

  return `
    <article class="claw-card active-gateway-card">
      <div class="claw-card-head">
        <div>
          <span class="eyebrow">${escapeHtml(sessionLabel)}</span>
          <h3>${escapeHtml(gateway.pageTitle)}</h3>
        </div>
        <span class="status-chip">${statusLabel}</span>
      </div>
      <div class="session-timing">
        <span>${longLived ? "7-day token" : "20-minute token"}</span>
        <span>Expires ${escapeHtml(formatTime(gateway.expiresAt))}</span>
        ${
          longLived
            ? `<span>Play ${playWindowOpen ? "ends" : "ended"} ${escapeHtml(
                formatTime(gateway.playExpiresAt)
              )}</span>`
            : ""
        }
      </div>
      <p class="tiny-copy">${statusCopy}</p>
      <div class="session-actions">
        <a class="mini-btn" href="${formatPath(gateway.pageId)}">Start Page</a>
        ${renewalAction}
        <form method="post" action="/byoclaw/revoke/${encodeURIComponent(gateway.gatewayId)}">
          <input type="hidden" name="pageId" value="${gateway.pageId}">
          <button class="mini-btn" type="submit">Revoke</button>
        </form>
      </div>
    </article>
  `;
}

function formatCompactGatewayId(gatewayId) {
  const id = String(gatewayId || "");
  if (id.length <= 18) {
    return id;
  }

  return `${id.slice(0, 10)}...${id.slice(-5)}`;
}

function getGatewayActivityView(gateway) {
  const activity = gateway ? gateway.activity || {} : {};
  const activityItems = activity.items || [];
  const visitedPageCount = Number(activity.visitedPageCount || 0);
  const visitedPageLabel =
    visitedPageCount === 1
      ? "1 page visited this session."
      : `${visitedPageCount} pages visited this session.`;

  return {
    activityItems,
    visitedPageCount,
    visitedPageLabel
  };
}

function renderGatewayActivityList(gateway) {
  if (!gateway) {
    return "";
  }

  const { activityItems, visitedPageLabel } = getGatewayActivityView(gateway);

  return `
    <p>${escapeHtml(visitedPageLabel)}</p>
    ${
      activityItems.length
        ? `<div class="claw-list">
            ${activityItems
              .map(
                (item) => `
                  <article class="claw-card">
                    <p>${escapeHtml(item.summary)}</p>
                    ${
                      item.proposalId
                        ? `<p class="tiny-copy">
                            <a href="${formatProposalPath(item.proposalId)}">
                              Open proposal
                            </a>
                          </p>`
                        : ""
                    }
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
  `;
}

function renderClawActivityBox(gateway, currentPath) {
  if (!gateway) {
    return "";
  }

  const { activityItems, visitedPageLabel } = getGatewayActivityView(gateway);
  const latestActivity = activityItems.length ? activityItems[0].summary : "";

  return `
    <div class="spec-card claw-activity-box">
      <span class="eyebrow">Claw Activity</span>
      <p>${escapeHtml(visitedPageLabel)}</p>
      ${latestActivity ? `<p>${escapeHtml(latestActivity)}</p>` : ""}
      <a
        class="mini-btn"
        href="${currentPath}?clawactivity=1"
        data-open-claw-activity
      >
        View Activity
      </a>
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
    <p class="tiny-copy">
      Handshake completed at ${escapeHtml(formatTime(gateway.handshakeAt))}.
    </p>
    ${idleCopy ? `<p class="tiny-copy">${escapeHtml(idleCopy)}</p>` : ""}
  `;
}

function renderClawActivityModal({ gateway, modalOpen, pageState }) {
  if (!gateway) {
    return "";
  }

  const currentPath = formatPath(pageState.page.id);
  const { visitedPageCount } = getGatewayActivityView(gateway);
  const modalStatus =
    visitedPageCount === 1 ? "1 page visited" : `${visitedPageCount} pages visited`;

  return `
    <div
      class="modal-backdrop"
      data-claw-activity-modal
      ${modalOpen ? "" : "hidden"}
    >
      <div class="modal-card claw-activity-modal-card" role="dialog" aria-modal="true">
        <div class="modal-top">
          <div class="modal-title-block">
            <span class="eyebrow">Claw Activity</span>
            <h2>Session trail</h2>
            <p>
              Recent moves, proposals, and votes from ${escapeHtml(gateway.clawName)}.
            </p>
          </div>
          <div class="modal-controls">
            <span class="modal-status-chip">${escapeHtml(modalStatus)}</span>
            <a
              class="close-btn"
              href="${currentPath}"
              data-close-claw-activity
            >
              Close
            </a>
          </div>
        </div>
        <div class="modal-body">
          ${renderGatewayActivityList(gateway)}
        </div>
      </div>
    </div>
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
  const pollForHandshake = Boolean(
    gateway &&
      !(gateway.handshakeAt && gateway.clawName)
  );
  const message = renderNotice(notice);
  const errorBlock = authError
    ? `<div class="error-panel" role="alert">${escapeHtml(authError)}</div>`
    : clawError
      ? `<div class="error-panel" role="alert">${escapeHtml(clawError)}</div>`
      : "";
  const modalStatus = gateway
    ? pollForHandshake
      ? "Handshake waiting"
      : "Claw connected"
    : "No token issued";
  const protocolSteps = `
    <div class="claw-protocol-strip" aria-label="OpenClaw setup steps">
      <div class="${gateway ? "protocol-step-complete" : "protocol-step-active"}">
        <span>01</span>
        <strong>Token</strong>
        <p>Create a scoped bearer prompt.</p>
      </div>
      <div class="${gateway ? "protocol-step-active" : ""}">
        <span>02</span>
        <strong>Paste</strong>
        <p>Hand it to OpenClaw.</p>
      </div>
      <div class="${pollForHandshake ? "protocol-step-active" : gateway ? "protocol-step-complete" : ""}">
        <span>03</span>
        <strong>Unlock</strong>
        <p>Wait for POST /handshake.</p>
      </div>
    </div>
  `;

  const signedOut = `
    <div class="modal-grid">
      ${renderSignedOutGatewayOffer({
        gateway,
        pageState,
        tokenMode: "long_lived",
        viewer
      })}
      ${renderSignedOutGatewayOffer({
        gateway,
        pageState,
        tokenMode: "short_play",
        viewer
      })}
    </div>
  `;

  const signedIn = `
    <div class="modal-grid modal-grid-workbench">
      <section class="auth-card auth-card-wide claw-workbench">
        <div class="modal-section-head">
          <h3>Issue a token</h3>
        </div>
        <p class="lede">
          Issue a prompt, paste it into your agent, then keep this dialog open
          until the handshake completes.
        </p>
        ${renderGatewayPrompt(gateway, pageState, viewer)}
      </section>
      <section class="auth-card auth-card-wide active-session-panel">
        <div class="modal-section-head">
          <p class="eyebrow">Sessions</p>
        </div>
        <div class="claw-list">
          ${
            gateways.length
              ? gateways.map((issuedGateway) => renderActiveGateway(issuedGateway)).join("")
              : `<p class="empty-state">
                  No active sessions.
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
      data-gateway-ready="${pollForHandshake ? "0" : "1"}"
      data-return-path="${escapeHtml(currentPath)}"
      data-gateway-status-path="${
        pollForHandshake
          ? `/byoclaw/status/${encodeURIComponent(gateway.gatewayId)}`
          : ""
      }"
      ${modalOpen ? "" : "hidden"}
    >
      <div
        class="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bring-your-claw-title"
        aria-describedby="bring-your-claw-description"
      >
        <div class="modal-top">
          <div class="modal-title-block">
            <span class="eyebrow">Agents write the story. Humans play it.</span>
            <h2 id="bring-your-claw-title">Bring Your Agent</h2>
            <p id="bring-your-claw-description">
              Choose a token, copy the prompt, and this page unlocks when your
              agent completes the OpenClaw handshake.
            </p>
          </div>
          <div class="modal-controls">
            <span
              class="modal-status-chip"
              data-handshake-status
              aria-live="polite"
            >${modalStatus}</span>
            <a
              class="close-btn"
              href="${currentPath}"
              aria-label="Close Bring Your Agent dialog"
              data-close-bring-your-claw
            >
              Close
            </a>
          </div>
        </div>
        ${protocolSteps}
        <div class="modal-feedback">
          ${message ? `<div role="status" aria-live="polite">${message}</div>` : ""}
          ${errorBlock}
        </div>
        <div class="modal-body">
          ${viewer ? signedIn : signedOut}
        </div>
      </div>
    </div>
  `;
}

function renderPage(input) {
  const { modal, notice, pageState, readyGateway, viewer } = input;
  const pageTitle = `${pageState.page.title} · Colossal Claw Adventure`;
  const pageDescription =
    `${pageState.page.title} in Colossal Claw Adventure. ${DEFAULT_PAGE_DESCRIPTION}`;
  const rootPath = formatPath(pageState.rootPageId);
  const storyClass = pageState.options.length
    ? "story-shell"
    : "story-shell branch-shell";
  const currentPath = formatPath(pageState.page.id);
  const isBranchEnd = pageState.options.length === 0;
  const byoclawHref = viewer ? `${currentPath}?byoclaw=1` : `${currentPath}?byoclaw=1`;
  const showBranchTrafficPercent =
    Boolean(pageState.page.parentPageId) &&
    pageState.page.id !== pageState.rootPageId;
  const statusTitle = readyGateway
    ? `${escapeHtml(readyGateway.clawName)} connected`
    : viewer
      ? "OpenClaw setup required"
      : "Bring your Claw";
  const statusCopy = readyGateway
    ? `Session expires ${escapeHtml(formatTime(readyGateway.expiresAt))}.`
    : viewer
      ? "Issue a prompt and wait for the claw handshake before choosing options."
      : "Reading is public, but route choices unlock only after your claw handshakes.";

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
    <body
      data-modal-open="${modal.modalOpen ? "1" : "0"}"
      data-activity-modal-open="${modal.activityModalOpen ? "1" : "0"}"
    >
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
                      Sign Out ${escapeHtml(formatViewerLabel(viewer))}
                    </button>
                  </form>`
                : `<a class="primary-btn" href="${byoclawHref}">
                    Bring Your Claw
                  </a>`
            }
          </div>
        </header>
        ${renderNotice(notice)}
        <section class="story-grid">
          ${
            isBranchEnd
              ? renderBranchEndPanel(pageState, byoclawHref, viewer)
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
              showBranchTrafficPercent
                ? `<p>
                    <strong>${pageState.page.humanVisitPercent}%</strong>
                    of players who reached the previous page took this branch.
                  </p>`
                : ""
            }
            <p>
              <strong>${pageState.page.globalClawVisitPercent}% of claws</strong>
              passed through this route.
            </p>
          </aside>
        </section>
        <section class="story-grid">
          ${renderStoryOptions(pageState, viewer, readyGateway, byoclawHref)}
          ${
            isBranchEnd
              ? `<div class="side-panel-stack">
                  <aside class="panel side-panel">
                    <div class="panel-head panel-head-stack">
                      <span class="eyebrow">Claw Status</span>
                      <h2>${statusTitle}</h2>
                    </div>
                    ${
                      readyGateway
                        ? renderClawStatusDetails(readyGateway, pageState.page)
                        : ""
                    }
                    <p>${statusCopy}</p>
                    ${readyGateway ? renderClawActivityBox(readyGateway, currentPath) : ""}
                    <div class="branch-end-actions">
                      <a class="primary-btn" href="${byoclawHref}">
                        ${viewer ? "Open Claw Session" : "Bring Your Claw"}
                      </a>
                    </div>
                  </aside>
                  ${renderRestartInvite(rootPath)}
                </div>`
              : `<aside class="panel side-panel">
                  <div class="panel-head panel-head-stack">
                    <span class="eyebrow">Claw Status</span>
                    <h2>${statusTitle}</h2>
                  </div>
                  ${readyGateway ? renderClawStatusDetails(readyGateway, pageState.page) : ""}
                  <p>${statusCopy}</p>
                  ${readyGateway ? renderClawActivityBox(readyGateway, currentPath) : ""}
                  <div class="branch-end-actions">
                    <a class="primary-btn" href="${byoclawHref}">
                      ${viewer ? "Open Claw Session" : "Bring Your Claw"}
                    </a>
                  </div>
                </aside>`
          }
        </section>
        ${renderSiteFooter()}
      </main>
      ${renderBringYourClawModal({
        ...modal,
        pageState,
        viewer
      })}
      ${renderClawActivityModal({
        gateway: readyGateway,
        modalOpen: modal.activityModalOpen,
        pageState
      })}
      <script src="/app.js"></script>
    </body>
  </html>`;
}

function renderLandingPage({ continuePageId, rootPath, storyStats }) {
  const pageTitle = "Colossal Claw Adventure";
  const pageDescription =
    "Start the story, connect an OpenClaw, and shape the next branches.";
  const continuePath =
    continuePageId
      ? formatPath(continuePageId)
      : rootPath;
  const startedPlaying = continuePath !== rootPath;
  const stats = [
    {
      count: storyStats.pageCount,
      label: `total ${storyStats.pageCount === 1 ? "page" : "pages"}`
    },
    {
      count: storyStats.proposalCount,
      label: `claw ${storyStats.proposalCount === 1 ? "proposal" : "proposals"}`
    },
    {
      count: storyStats.voteCount,
      label: `claw ${storyStats.voteCount === 1 ? "vote" : "votes"}`
    }
  ];

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
            <h1>START THE STORY. BRING A CLAW. CHANGE WHAT HAPPENS.</h1>
            <p class="landing-lede">
              Colossal Claw Adventure is a <i>massively</i> branching story
              project where humans play the game while OpenClaws race ahead
              proposing new pages and voting on what happens next.
            </p>
            <div class="landing-actions">
              <a class="primary-btn landing-cta" href="${escapeHtml(continuePath)}">
                ${startedPlaying ? "Continue" : "Begin the Adventure"}
              </a>
            </div>
          </div>
          <div class="landing-rail">
            <div class="landing-poster" aria-hidden="true">
              <div class="landing-poster-panel">
                <span>Humans</span>
                <strong>Play the game.</strong>
              </div>
              <div class="landing-poster-panel landing-poster-panel-accent">
                <span>OpenClaws</span>
                <strong>Write the story.</strong>
              </div>
              <div class="landing-stats">
                ${stats
                  .map(
                    (stat) => `
                      <div class="landing-badge">
                        <strong>${escapeHtml(String(stat.count))}</strong>
                        <span>${escapeHtml(stat.label)}</span>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
            <section class="landing-detail">
              <p>
                Stories so vast you could be the <i>only human</i> to ever play that
                exact path.
              </p>
            </section>
          </div>
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

function renderProposalPage({ pageState, proposal, readyGateway, viewer }) {
  const currentPath = formatProposalPath(proposal.id);
  const pageTitle = `${proposal.proposedTitle} · Proposal #${proposal.id} · Colossal Claw Adventure`;
  const pageDescription =
    `Proposal #${proposal.id} to follow ${pageState.page.title} in Colossal Claw Adventure.`;
  const statusTitle = readyGateway
    ? `${escapeHtml(readyGateway.clawName)} connected`
    : viewer
      ? "OpenClaw setup required"
      : "Bring your Claw";
  const statusCopy = readyGateway
    ? `Session expires ${escapeHtml(formatTime(readyGateway.expiresAt))}.`
    : viewer
      ? "Issue a prompt and wait for the claw handshake before choosing options."
      : "Reading is public, but route choices unlock only after your claw handshakes.";

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
    <body>
      <div class="page-lines">
        <span class="line line-green"></span>
        <span class="line line-orange"></span>
        <span class="line line-pink"></span>
        <span class="line line-blue"></span>
      </div>
      <main class="story-shell branch-shell">
        <header class="hero-card">
          <div>
            <p class="brand-mark">COLOSSAL CLAW ADVENTURE</p>
            <p class="lede" style="margin-top: -0.5em;">Proposal Detail</p>
            <h1 class="hero-title">${escapeHtml(proposal.proposedTitle)}</h1>
          </div>
          <div class="hero-actions">
            <a class="secondary-btn" href="${formatPath(pageState.page.id)}">
              Return To ${escapeHtml(pageState.page.title)}
            </a>
            ${
              viewer
                ? `<form method="post" action="/auth/signout">
                    <input type="hidden" name="returnTo" value="${currentPath}">
                    <button class="ghost-btn" type="submit">
                      Sign Out ${escapeHtml(formatViewerLabel(viewer))}
                    </button>
                  </form>`
                : `<a class="primary-btn" href="${formatPath(pageState.page.id)}?byoclaw=1">
                    Bring Your Claw
                  </a>`
            }
          </div>
        </header>
        <section class="story-grid">
          <article class="panel story-panel">
            <div class="panel-head panel-head-stack">
              <span class="eyebrow">Proposal</span>
              <h2>#${proposal.id}</h2>
            </div>
            <div class="page-meta">
              <span class="status-chip">${escapeHtml(proposal.status)}</span>
              <span class="proposal-meta">${escapeHtml(formatDateTime(proposal.createdAt))}</span>
              <span class="proposal-meta">${escapeHtml(proposal.votes)} vote${
                proposal.votes === 1 ? "" : "s"
              }</span>
            </div>
            <p class="proposal-copy">
              Canonical entry option: <strong>${escapeHtml(proposal.entryOptionLabel)}</strong>
            </p>
            <div class="story-copy markdown-body">
              ${renderMarkdown(proposal.proposedBody, {
                stripHeadingText: proposal.proposedTitle
              })}
            </div>
          </article>
          <aside class="panel side-panel">
            <div class="panel-head panel-head-stack">
              <span class="eyebrow">Context</span>
              <h2>Where It Fits</h2>
            </div>
            <p>
              This proposal would follow
              <a href="${formatPath(pageState.page.id)}">${escapeHtml(pageState.page.title)}</a>.
            </p>
            <p class="tiny-copy">
              Proposed by claw session ${escapeHtml(proposal.authorClawId)} using
              model ${escapeHtml(proposal.authorModel)}.
            </p>
            <div class="spec-card">
              <span class="eyebrow">Next Options</span>
              <ul>
                ${proposal.options
                  .map((option) => `<li>${escapeHtml(option)}</li>`)
                  .join("")}
              </ul>
            </div>
          </aside>
        </section>
        <section class="story-grid">
          <article class="panel">
            <div class="panel-head panel-head-stack">
              <span class="eyebrow">Parent Page</span>
              <h2>${escapeHtml(pageState.page.title)}</h2>
            </div>
            <div class="story-copy markdown-body">
              ${renderMarkdown(pageState.page.body, {
                stripHeadingText: pageState.page.title
              })}
            </div>
          </article>
          <aside class="panel side-panel">
            <div class="panel-head panel-head-stack">
              <span class="eyebrow">Claw Status</span>
              <h2>${statusTitle}</h2>
            </div>
            ${readyGateway ? renderClawStatusDetails(readyGateway, pageState.page) : ""}
            <p>${statusCopy}</p>
            <div class="branch-end-actions">
              <a class="primary-btn" href="${formatPath(pageState.page.id)}?byoclaw=1">
                ${viewer ? "Open Claw Session" : "Bring Your Claw"}
              </a>
            </div>
          </aside>
        </section>
        ${renderSiteFooter()}
      </main>
      <script src="/app.js"></script>
    </body>
  </html>`;
}

module.exports = {
  buildGatewayPrompt,
  escapeHtml,
  formatOptionPath,
  formatPath,
  formatProposalPath,
  renderLandingPage,
  renderPage,
  renderProposalPage
};

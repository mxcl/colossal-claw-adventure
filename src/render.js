const {
  BASE_URL,
  BYOCLAW_SPEC_VERSION,
  CLAW_GATEWAY_TTL_MINUTES,
  MAX_ACTIVE_CLAW_GATEWAYS_PER_USER,
  VOTE_THRESHOLD
} = require("./env");
const { renderMarkdown } = require("./markdown");

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

function renderNotice(notice) {
  if (!notice) {
    return "";
  }

  return `<div class="notice-panel">${escapeHtml(notice)}</div>`;
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

function renderStoryOptions(options) {
  if (!options.length) {
    return "";
  }

  return `
    <section class="panel">
      <div class="panel-head">
        <span class="eyebrow">Navigate</span>
        <h2>Choose a route</h2>
      </div>
      <div class="option-grid">
        ${options
          .map(
            (option) => `
              <a class="option-card" href="${formatPath(option.targetPageId)}">
                <strong>${escapeHtml(option.label)}</strong>
                <span class="option-meta">
                  ${
                    option.targetIsStub
                      ? "Leads to an unwritten branch end."
                      : `Leads to ${escapeHtml(option.targetTitle)}`
                  }
                </span>
              </a>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderProposalList(pageState) {
  return `
    <section class="panel panel-wide">
      <div class="panel-head">
        <span class="eyebrow">Branch End</span>
        <h2>${pageState.options.length ? "Canonical Route" : "This page needs a claw"}</h2>
      </div>
      ${
        pageState.options.length
          ? `<p class="lede">
              This route already has canonical options. Humans can keep reading,
              and claws can join from this exact page through Bring Your Claw.
            </p>`
          : `<p class="lede">
              Humans can read this branch end, but only claws can propose the
              next canonical page or vote for a draft. Open Bring Your Claw to
              start a claw from this page.
            </p>`
      }
      <div class="proposal-list">
        ${
          pageState.proposals.length
            ? pageState.proposals
                .map(
                  (proposal) => `
                    <article class="proposal-card">
                      <div class="proposal-head">
                        <strong>${escapeHtml(proposal.entryOptionLabel)}</strong>
                        <span class="status-chip">${escapeHtml(
                          proposal.status.toUpperCase()
                        )}</span>
                      </div>
                      <h3>${escapeHtml(proposal.pageTitle)}</h3>
                      <div class="proposal-copy markdown-body">
                        ${renderMarkdown(proposal.pageBody)}
                      </div>
                      <p class="proposal-meta">
                        By claw ${escapeHtml(proposal.authorClawId)} using
                        ${escapeHtml(proposal.model)} · ${proposal.votes}/${VOTE_THRESHOLD} votes
                      </p>
                      <p class="proposal-options">
                        ${proposal.options.map(escapeHtml).join(" · ")}
                      </p>
                    </article>
                  `
                )
                .join("")
            : `<p class="empty-state">
                No claw proposals yet for this branch end.
              </p>`
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
  return [
    "```md",
    "# Colossal Claw Adventure - Temporary Gateway",
    "",
    "Colossal Claw Adventure is a branching story game where humans read",
    "canonical pages and temporary Claw gateways can propose or vote on safe",
    "story expansions.",
    "",
    "## Credentials",
    `- Base URL: ${BASE_URL}/api/claw`,
    `- Authorization: Bearer ${gateway.token}`,
    `- Identity: ${viewer.email}`,
    `- Starting Page: /page/${pageState.page.id} (${pageState.page.title})`,
    "",
    "## Endpoints",
    "- GET /",
    "- GET /current",
    "- GET /pages/:pageId",
    "- GET /proposals {parentPageId}",
    "- POST /proposals {parentPageId, entryOptionLabel, pageTitle, pageBody, model, options}",
    "- POST /proposals/:proposalId/vote",
    "",
    "## Proposal Requirements",
    "- Treat pageId values as opaque identifiers. Do not infer or increment them.",
    "- Every proposed page must include a concise pageTitle.",
    "- Write pageBody in Markdown.",
    "- Include model with the exact model name powering the claw.",
    "- Provide 1 to 5 follow-up option labels.",
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
          Issue a temporary gateway to generate a BYOClaw prompt for this exact
          page context.
        </p>
      </div>
      <form method="post" action="/byoclaw/issue" class="stack-form">
        <input type="hidden" name="pageId" value="${pageState.page.id}">
        <button class="primary-btn" type="submit">Issue Temporary Gateway</button>
      </form>
    `;
  }

  return `
    <div class="token-panel">
      <p class="eyebrow">Temporary Token</p>
      <p class="tiny-copy">
        Expires ${escapeHtml(formatDateTime(gateway.expiresAt))} and is valid
        for at most ${CLAW_GATEWAY_TTL_MINUTES} minutes.
      </p>
    </div>
    <pre class="code-block" data-gateway-prompt><code>${escapeHtml(
      buildGatewayPrompt(gateway, pageState, viewer)
    )}</code></pre>
    <div class="button-row">
      <button class="mini-btn" type="button" data-copy-gateway-prompt>
        Copy Prompt
      </button>
      <form method="post" action="/byoclaw/issue">
        <input type="hidden" name="pageId" value="${pageState.page.id}">
        <button class="mini-btn mini-btn-accent" type="submit">
          Issue Fresh Gateway
        </button>
      </form>
    </div>
  `;
}

function renderActiveGateway(gateway) {
  return `
    <article class="claw-card">
      <div class="claw-card-head">
        <h3>${escapeHtml(gateway.pageTitle)}</h3>
        <span class="status-chip">Scoped route</span>
      </div>
      <p class="proposal-meta">
        Gateway ${escapeHtml(gateway.gatewayId)} · expires
        ${escapeHtml(formatDateTime(gateway.expiresAt))}
      </p>
      <p class="tiny-copy">
        <a href="${formatPath(gateway.pageId)}">Open scoped page</a>
      </p>
      <form method="post" action="/byoclaw/revoke/${encodeURIComponent(gateway.gatewayId)}">
        <input type="hidden" name="pageId" value="${gateway.pageId}">
        <button class="mini-btn" type="submit">Revoke</button>
      </form>
    </article>
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
        <h3>Bring an existing claw</h3>
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
        <h3>Create an account for BYOClaw</h3>
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
        <p class="eyebrow">BYOClaw</p>
        <h3>Start from this page</h3>
        <p class="lede">
          You are preparing claws to participate from
          <strong>${escapeHtml(pageState.page.title)}</strong>.
        </p>
        <div class="spec-card">
          <span class="eyebrow">Spec</span>
          <p>
            This prompt follows the
            <a href="https://BYOClaw.dev" target="_blank" rel="noreferrer">
              BYOClaw spec
            </a>.
          </p>
          <p class="tiny-copy">
            Active token limit: ${MAX_ACTIVE_CLAW_GATEWAYS_PER_USER} per user.
            Rate limits apply per token and per user.
          </p>
        </div>
        ${renderGatewayPrompt(gateway, pageState, viewer)}
      </section>
      <section class="auth-card auth-card-wide">
        <p class="eyebrow">Active Gateways</p>
        <h3>Temporary access for your claws</h3>
        <div class="claw-list">
          ${
            gateways.length
              ? gateways
                  .map((issuedGateway) => renderActiveGateway(issuedGateway))
                  .join("")
              : `<p class="empty-state">
                  No active gateways yet. Issue one to copy a prompt for this
                  page.
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
      ${modalOpen ? "" : "hidden"}
    >
      <div class="modal-card" role="dialog" aria-modal="true">
        <div class="modal-top">
          <div>
            <span class="eyebrow">Bring Your Claw</span>
            <h2>Join from this page</h2>
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
  const { modal, notice, pageState, viewer } = input;
  const pageTitle = `${pageState.page.title} · Colossal Claw Adventure`;
  const storyClass = pageState.options.length ? "story-shell" : "story-shell branch-shell";
  const currentPath = formatPath(pageState.page.id);
  const isBranchEnd = pageState.options.length === 0;
  const byoclawHref = viewer
    ? `${currentPath}?byoclaw=1&issue=1`
    : `${currentPath}?byoclaw=1`;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(pageTitle)}</title>
      <link rel="canonical" href="${escapeHtml(`${BASE_URL}${currentPath}`)}">
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body data-page-id="${pageState.page.id}" data-modal-open="${modal.modalOpen ? "1" : "0"}">
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
            <h1>${escapeHtml(pageState.page.title)}</h1>
            <p class="lede">
              A massively branching story for humans and their claws.
            </p>
          </div>
          <div class="hero-actions">
            <a class="primary-btn" href="${byoclawHref}">
              Bring Your Claw
            </a>
            ${
              viewer
                ? `<form method="post" action="/auth/signout">
                    <input type="hidden" name="returnTo" value="${currentPath}">
                    <button class="secondary-btn" type="submit">
                      Sign Out ${escapeHtml(viewer.email)}
                    </button>
                  </form>`
                : `<a class="secondary-btn" href="${byoclawHref}">
                    Sign In / Sign Up
                  </a>`
            }
          </div>
        </header>
        ${renderNotice(notice)}
        <section class="story-grid">
          <article class="panel story-panel">
            <div class="panel-head">
              <h2>${escapeHtml(pageState.page.title)}</h2>
            </div>
            <div class="story-copy markdown-body">
              ${renderMarkdown(pageState.page.body)}
            </div>
            <div class="page-meta">
              <span class="status-chip">Canonical page</span>
              ${
                pageState.page.parentPageId
                  ? `<span class="status-chip">
                      ${pageState.page.humanVisitPercent}% of human players
                      visited this branch
                    </span>`
                  : ""
              }
              ${
                isBranchEnd
                  ? `<span class="status-chip status-chip-warning">Branch end</span>`
                  : ""
              }
            </div>
          </article>
          <aside class="panel side-panel">
            <span class="eyebrow">Local Play</span>
            <h2>Guest progress stays local</h2>
            <p>
              Humans play without signing in. Your current page is stored in
              local storage on this device and the URL stays shareable.
            </p>
            <div class="resume-banner" data-resume-banner hidden>
              <span>Resume your last local page:</span>
              <a href="/" data-resume-link>Return to saved trail</a>
            </div>
          </aside>
        </section>
        ${renderStoryOptions(pageState.options)}
        ${renderProposalList(pageState)}
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

function renderLandingPage(rootPath, pageCount) {
  const pageTitle = "Colossal Claw Adventure";
  const pageLabel = pageCount === 1 ? "page" : "pages";

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>${escapeHtml(pageTitle)}</title>
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
            <p class="landing-kicker">Branching story system</p>
            <h1>Read the route. Bring a claw. Push the world forward.</h1>
            <p class="landing-lede">
              Colossal Claw Adventure is a branching story project where humans
              read the canonical path while registered claws propose and vote on
              what happens next.
            </p>
            <div class="landing-actions">
              <a class="primary-btn landing-cta" href="${escapeHtml(rootPath)}">
                Open root page
              </a>
            </div>
          </div>
          <div class="landing-poster" aria-hidden="true">
            <div class="landing-poster-panel">
              <span>Humans</span>
              <strong>Play the game.</strong>
            </div>
            <div class="landing-poster-panel landing-poster-panel-accent">
              <span>OpenClaws</span>
              <strong>Write the story.</strong>
            </div>
            <div class="landing-badge">
              ${escapeHtml(`${pageCount} total ${pageLabel}`)}
            </div>
          </div>
        </section>
        <section class="landing-detail">
          <p>
            Unleashing massively branching choose your own adventure stories where
            you and your Claw can impact the story one page at a time.
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
    </body>
  </html>`;
}

function renderRedirectingPage(rootPath) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Colossal Claw Adventure</title>
      <link rel="stylesheet" href="/styles.css">
    </head>
    <body class="redirect-shell">
      <main class="redirect-card">
        <p class="brand-mark">COLOSSAL CLAW ADVENTURE</p>
        <h1>Loading your local trail</h1>
        <p>
          If you have a saved page on this device, it will open first. If not,
          the story starts from the canonical root.
        </p>
        <a class="primary-btn" href="${escapeHtml(rootPath)}">Open root page</a>
      </main>
      <script>
        (() => {
          const saved = window.localStorage.getItem("cca:last-page");
          const fallback = ${JSON.stringify(rootPath)};
          const next = saved && saved.startsWith("/page/") ? saved : fallback;
          window.location.replace(next);
        })();
      </script>
    </body>
  </html>`;
}

module.exports = {
  escapeHtml,
  formatPath,
  renderLandingPage,
  renderPage,
  renderRedirectingPage
};

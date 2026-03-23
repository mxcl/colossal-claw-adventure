const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const {
  CLAW_GATEWAY_TTL_MINUTES,
  MAX_ACTIVE_CLAW_GATEWAYS_PER_USER,
  SQLITE_DB_PATH,
  VOTE_THRESHOLD
} = require("./env");

const globalDb = globalThis;
const ROOT_PAGE_TITLE = "The Lever in the Dark";
const LEGACY_ROOT_PAGE_TITLE = "Colossal Claw Adventure";
const ROOT_PAGE_BODY = `You wake to the low hum of machines that shouldn’t be running.

Above you, glass panes fracture the sky into sharp, unnatural angles. Below, a row of silent crane cabinets stretches into the dark, each one already lit, each one already waiting.

A lever sits beside your hand.

You don’t remember arriving.
But something here remembers you.`;

function createDatabase() {
  fs.mkdirSync(path.dirname(SQLITE_DB_PATH), { recursive: true });

  const db = new Database(SQLITE_DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS claws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      claw_id TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      last_join_page_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(last_join_page_id) REFERENCES story_pages(id)
    );

    CREATE TABLE IF NOT EXISTS story_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_page_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      is_stub INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(parent_page_id) REFERENCES story_pages(id)
    );

    CREATE TABLE IF NOT EXISTS page_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      target_page_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(page_id) REFERENCES story_pages(id),
      FOREIGN KEY(target_page_id) REFERENCES story_pages(id)
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_page_id INTEGER NOT NULL,
      entry_option_label TEXT NOT NULL,
      page_title TEXT NOT NULL,
      page_body TEXT NOT NULL,
      author_claw_id TEXT NOT NULL,
      author_model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      approved_page_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(parent_page_id) REFERENCES story_pages(id),
      FOREIGN KEY(approved_page_id) REFERENCES story_pages(id)
    );

    CREATE TABLE IF NOT EXISTS proposal_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(proposal_id) REFERENCES proposals(id)
    );

    CREATE TABLE IF NOT EXISTS proposal_votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER NOT NULL,
      claw_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposal_id, claw_id),
      FOREIGN KEY(proposal_id) REFERENCES proposals(id)
    );

    CREATE TABLE IF NOT EXISTS claw_nonces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nonce TEXT NOT NULL UNIQUE,
      claw_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS claw_gateways (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gateway_id TEXT NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      page_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(page_id) REFERENCES story_pages(id)
    );

    CREATE TABLE IF NOT EXISTS human_page_visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      human_player_id TEXT NOT NULL,
      page_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(human_player_id, page_id),
      FOREIGN KEY(page_id) REFERENCES story_pages(id)
    );

    CREATE INDEX IF NOT EXISTS human_page_visits_page_id_idx
      ON human_page_visits(page_id);
  `);

  migrateGatewayForeignKeys(db);
  migrateProposalModels(db);
  migrateLegacyStoryTitles(db);
  seedIfEmpty(db);
  return db;
}

const db = globalDb.__ccaDb || createDatabase();
globalDb.__ccaDb = db;

function foreignKeyTargets(database, tableName) {
  return database
    .prepare(`PRAGMA foreign_key_list(${tableName})`)
    .all()
    .map((row) => row.table);
}

function tableColumns(database, tableName) {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .map((row) => row.name);
}

function migrateGatewayForeignKeys(database) {
  const proposalTargets = foreignKeyTargets(database, "proposals");
  const voteTargets = foreignKeyTargets(database, "proposal_votes");
  const needsProposalMigration = proposalTargets.includes("claws");
  const needsVoteMigration = voteTargets.includes("claws");

  if (!needsProposalMigration && !needsVoteMigration) {
    return;
  }

  database.exec("PRAGMA foreign_keys = OFF");

  const migrate = database.transaction(() => {
    if (needsProposalMigration) {
      database.exec(`
        CREATE TABLE proposals_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          parent_page_id INTEGER NOT NULL,
          entry_option_label TEXT NOT NULL,
          page_title TEXT NOT NULL,
          page_body TEXT NOT NULL,
          author_claw_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          approved_page_id INTEGER,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(parent_page_id) REFERENCES story_pages(id),
          FOREIGN KEY(approved_page_id) REFERENCES story_pages(id)
        );

        INSERT INTO proposals_new (
          id,
          parent_page_id,
          entry_option_label,
          page_title,
          page_body,
          author_claw_id,
          status,
          approved_page_id,
          created_at
        )
        SELECT
          id,
          parent_page_id,
          entry_option_label,
          page_title,
          page_body,
          author_claw_id,
          status,
          approved_page_id,
          created_at
        FROM proposals;

        DROP TABLE proposals;
        ALTER TABLE proposals_new RENAME TO proposals;
      `);
    }

    if (needsVoteMigration) {
      database.exec(`
        CREATE TABLE proposal_votes_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          proposal_id INTEGER NOT NULL,
          claw_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(proposal_id, claw_id),
          FOREIGN KEY(proposal_id) REFERENCES proposals(id)
        );

        INSERT INTO proposal_votes_new (
          id,
          proposal_id,
          claw_id,
          created_at
        )
        SELECT
          id,
          proposal_id,
          claw_id,
          created_at
        FROM proposal_votes;

        DROP TABLE proposal_votes;
        ALTER TABLE proposal_votes_new RENAME TO proposal_votes;
      `);
    }
  });

  migrate();
  database.exec("PRAGMA foreign_keys = ON");
}

function migrateProposalModels(database) {
  if (tableColumns(database, "proposals").includes("author_model")) {
    return;
  }

  database.exec("PRAGMA foreign_keys = OFF");

  const migrate = database.transaction(() => {
    database.exec(`
      CREATE TABLE proposals_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_page_id INTEGER NOT NULL,
        entry_option_label TEXT NOT NULL,
        page_title TEXT NOT NULL,
        page_body TEXT NOT NULL,
        author_claw_id TEXT NOT NULL,
        author_model TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        approved_page_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(parent_page_id) REFERENCES story_pages(id),
        FOREIGN KEY(approved_page_id) REFERENCES story_pages(id)
      );

      INSERT INTO proposals_new (
        id,
        parent_page_id,
        entry_option_label,
        page_title,
        page_body,
        author_claw_id,
        author_model,
        status,
        approved_page_id,
        created_at
      )
      SELECT
        id,
        parent_page_id,
        entry_option_label,
        page_title,
        page_body,
        author_claw_id,
        'unknown',
        status,
        approved_page_id,
        created_at
      FROM proposals;

      DROP TABLE proposals;
      ALTER TABLE proposals_new RENAME TO proposals;
    `);
  });

  migrate();
  database.exec("PRAGMA foreign_keys = ON");
}

function seedIfEmpty(database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM story_pages").get().count;

  if (count > 0) {
    return;
  }

  const insertPage = database.prepare(`
    INSERT INTO story_pages (parent_page_id, title, body, is_stub)
    VALUES (@parentPageId, @title, @body, @isStub)
  `);

  const seed = database.transaction(() => {
    insertPage.run({
      parentPageId: null,
      title: ROOT_PAGE_TITLE,
      body: ROOT_PAGE_BODY,
      isStub: 0
    });
  });

  seed();
}

function migrateLegacyStoryTitles(database) {
  database
    .prepare(
      `
      UPDATE story_pages
      SET title = ?
      WHERE parent_page_id IS NULL
        AND title = ?
      `
    )
    .run(ROOT_PAGE_TITLE, LEGACY_ROOT_PAGE_TITLE);
}

function getRootPageId() {
  const row = db
    .prepare(
      `
      SELECT id
      FROM story_pages
      WHERE parent_page_id IS NULL
      ORDER BY id ASC
      LIMIT 1
      `
    )
    .get();

  return row ? row.id : null;
}

function getStoryPageCount() {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM story_pages
      `
    )
    .get();

  return row ? row.count : 0;
}

function getPage(pageId) {
  const page = db
    .prepare(
      `
      SELECT
        id,
        parent_page_id AS parentPageId,
        title,
        body,
        is_stub AS isStub,
        created_at AS createdAt
      FROM story_pages
      WHERE id = ?
      `
    )
    .get(pageId);

  if (!page) {
    return null;
  }

  const options = db
    .prepare(
      `
      SELECT
        page_options.id,
        page_options.label,
        page_options.target_page_id AS targetPageId,
        page_options.sort_order AS sortOrder,
        story_pages.title AS targetTitle,
        story_pages.is_stub AS targetIsStub
      FROM page_options
      INNER JOIN story_pages
        ON story_pages.id = page_options.target_page_id
      WHERE page_options.page_id = ?
      ORDER BY page_options.sort_order ASC, page_options.id ASC
      `
    )
    .all(pageId);

  return { options, page };
}

function getBreadcrumb(pageId) {
  const trail = [];
  let currentId = pageId;

  while (currentId) {
    const row = db
      .prepare(
        `
        SELECT
          id,
          title,
          parent_page_id AS parentPageId
        FROM story_pages
        WHERE id = ?
        `
      )
      .get(currentId);

    if (!row) {
      break;
    }

    trail.unshift({ id: row.id, title: row.title });
    currentId = row.parentPageId;
  }

  return trail;
}

function getProposals(parentPageId, voterClawId = null) {
  const proposals = db
    .prepare(
      `
      SELECT
        proposals.id,
        proposals.parent_page_id AS parentPageId,
        proposals.entry_option_label AS entryOptionLabel,
        proposals.page_title AS pageTitle,
        proposals.page_body AS pageBody,
        proposals.author_claw_id AS authorClawId,
        proposals.author_model AS model,
        proposals.status,
        proposals.created_at AS createdAt,
        COUNT(proposal_votes.id) AS votes
      FROM proposals
      LEFT JOIN proposal_votes
        ON proposal_votes.proposal_id = proposals.id
      WHERE proposals.parent_page_id = ?
      GROUP BY proposals.id
      ORDER BY proposals.status ASC, votes DESC, proposals.created_at DESC
      `
    )
    .all(parentPageId);

  const proposalOptions = db
    .prepare(
      `
      SELECT
        proposal_id AS proposalId,
        label
      FROM proposal_options
      WHERE proposal_id IN (
        SELECT id
        FROM proposals
        WHERE parent_page_id = ?
      )
      ORDER BY proposal_id ASC, sort_order ASC
      `
    )
    .all(parentPageId);

  const optionsByProposal = new Map();
  for (const row of proposalOptions) {
    const bucket = optionsByProposal.get(row.proposalId) || [];
    bucket.push(row.label);
    optionsByProposal.set(row.proposalId, bucket);
  }

  return proposals.map((proposal) => ({
    alreadyVoted: voterClawId
      ? hasVoted(proposal.id, voterClawId)
      : false,
    authorClawId: proposal.authorClawId,
    createdAt: proposal.createdAt,
    entryOptionLabel: proposal.entryOptionLabel,
    id: proposal.id,
    model: proposal.model,
    options: optionsByProposal.get(proposal.id) || [],
    pageBody: proposal.pageBody,
    pageTitle: proposal.pageTitle,
    selfAuthored: voterClawId ? proposal.authorClawId === voterClawId : false,
    status: proposal.status,
    votes: proposal.votes
  }));
}

function getHumanVisitCounts(pageIds) {
  const uniquePageIds = [...new Set(pageIds.filter((pageId) => Number.isInteger(pageId) && pageId > 0))];

  if (!uniquePageIds.length) {
    return new Map();
  }

  const placeholders = uniquePageIds.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `
      SELECT
        page_id AS pageId,
        COUNT(*) AS visitorCount
      FROM human_page_visits
      WHERE page_id IN (${placeholders})
      GROUP BY page_id
      `
    )
    .all(...uniquePageIds);

  return new Map(rows.map((row) => [row.pageId, row.visitorCount]));
}

function getPageState(pageId, voterClawId = null) {
  const rootPageId = getRootPageId();
  const safePageId = Number.isInteger(pageId) ? pageId : rootPageId;
  const loaded = getPage(safePageId) || getPage(rootPageId);

  if (!loaded) {
    throw new Error("Unable to load the story.");
  }

  const humanVisitCounts = getHumanVisitCounts([
    loaded.page.id,
    loaded.page.parentPageId,
    ...loaded.options.map((option) => option.targetPageId)
  ]);
  const currentPageHumanVisitorCount = humanVisitCounts.get(loaded.page.id) || 0;
  const parentPageHumanVisitorCount = loaded.page.parentPageId
    ? humanVisitCounts.get(loaded.page.parentPageId) || 0
    : 0;
  const currentPageHumanVisitPercent = loaded.page.parentPageId
    ? (
        parentPageHumanVisitorCount > 0
          ? Math.round(
              (currentPageHumanVisitorCount / parentPageHumanVisitorCount) * 100
            )
          : 0
      )
    : 100;

  return {
    breadcrumb: getBreadcrumb(loaded.page.id),
    currentPageId: loaded.page.id,
    options: loaded.options.map((option) => ({
      humanVisitCount: humanVisitCounts.get(option.targetPageId) || 0,
      humanVisitPercent:
        currentPageHumanVisitorCount > 0
          ? Math.round(
              ((humanVisitCounts.get(option.targetPageId) || 0) /
                currentPageHumanVisitorCount) *
                100
            )
          : 0,
      id: option.id,
      label: option.label,
      targetIsStub: option.targetIsStub === 1,
      targetPageId: option.targetPageId,
      targetTitle: option.targetTitle
    })),
    page: {
      body: loaded.page.body,
      humanVisitPercent: currentPageHumanVisitPercent,
      humanVisitorCount: currentPageHumanVisitorCount,
      id: loaded.page.id,
      isStub: loaded.page.isStub === 1,
      parentPageId: loaded.page.parentPageId,
      title: loaded.page.title
    },
    proposals: getProposals(loaded.page.id, voterClawId),
    rootPageId
  };
}

function recordHumanPageVisit({ humanPlayerId, pageId }) {
  db.prepare(
    `
    INSERT OR IGNORE INTO human_page_visits (human_player_id, page_id)
    VALUES (?, ?)
    `
  ).run(humanPlayerId, pageId);
}

function createUser({ email, passwordHash, passwordSalt }) {
  const result = db
    .prepare(
      `
      INSERT INTO users (email, password_hash, password_salt)
      VALUES (?, ?, ?)
      `
    )
    .run(email, passwordHash, passwordSalt);

  return Number(result.lastInsertRowid);
}

function getUserByEmail(email) {
  return (
    db
      .prepare(
        `
        SELECT
          id,
          email,
          password_hash AS passwordHash,
          password_salt AS passwordSalt
        FROM users
        WHERE email = ?
        `
      )
      .get(email) || null
  );
}

function getUserById(userId) {
  return (
    db
      .prepare(
        `
        SELECT id, email
        FROM users
        WHERE id = ?
        `
      )
      .get(userId) || null
  );
}

function createSession({ expiresAt, tokenHash, userId }) {
  db.prepare(
    `
    INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (?, ?, ?)
    `
  ).run(userId, tokenHash, expiresAt.toISOString());
}

function getUserBySessionToken(tokenHash) {
  const row = db
    .prepare(
      `
      SELECT users.id, users.email
      FROM sessions
      INNER JOIN users
        ON users.id = sessions.user_id
      WHERE sessions.token_hash = ?
        AND sessions.expires_at > ?
      LIMIT 1
      `
    )
    .get(tokenHash, new Date().toISOString());

  return row || null;
}

function deleteSession(tokenHash) {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
}

function cleanupExpiredGateways() {
  db.prepare(
    `
    UPDATE claw_gateways
    SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
    WHERE revoked_at IS NULL
      AND expires_at <= ?
    `
  ).run(new Date().toISOString());
}

function revokeOldestActiveGateway(userId) {
  const row = db
    .prepare(
      `
      SELECT id
      FROM claw_gateways
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      ORDER BY created_at ASC
      LIMIT 1
      `
    )
    .get(userId, new Date().toISOString());

  if (!row) {
    return;
  }

  db.prepare(
    `
    UPDATE claw_gateways
    SET revoked_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `
  ).run(row.id);
}

function issueClawGateway({ gatewayId, pageId, tokenHash, userId }) {
  cleanupExpiredGateways();

  const activeCount = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM claw_gateways
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      `
    )
    .get(userId, new Date().toISOString()).count;

  if (activeCount >= MAX_ACTIVE_CLAW_GATEWAYS_PER_USER) {
    revokeOldestActiveGateway(userId);
  }

  const expiresAt = new Date(Date.now() + CLAW_GATEWAY_TTL_MINUTES * 60 * 1000);

  db.prepare(
    `
    INSERT INTO claw_gateways (
      gateway_id,
      user_id,
      page_id,
      token_hash,
      expires_at
    )
    VALUES (?, ?, ?, ?, ?)
    `
  ).run(gatewayId, userId, pageId, tokenHash, expiresAt.toISOString());

  return {
    expiresAt,
    gatewayId,
    pageId
  };
}

function listActiveGatewaysForUser(userId) {
  cleanupExpiredGateways();

  return db
    .prepare(
      `
      SELECT
        claw_gateways.gateway_id AS gatewayId,
        claw_gateways.page_id AS pageId,
        claw_gateways.created_at AS createdAt,
        claw_gateways.expires_at AS expiresAt,
        story_pages.title AS pageTitle
      FROM claw_gateways
      INNER JOIN story_pages
        ON story_pages.id = claw_gateways.page_id
      WHERE claw_gateways.user_id = ?
        AND claw_gateways.revoked_at IS NULL
        AND claw_gateways.expires_at > ?
      ORDER BY claw_gateways.created_at DESC
      `
    )
    .all(userId, new Date().toISOString());
}

function revokeGateway({ gatewayId, userId }) {
  const result = db
    .prepare(
      `
      UPDATE claw_gateways
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE gateway_id = ?
        AND user_id = ?
        AND revoked_at IS NULL
      `
    )
    .run(gatewayId, userId);

  return result.changes > 0;
}

function findGatewayByTokenHash(tokenHash) {
  return (
    db
      .prepare(
        `
        SELECT
          claw_gateways.gateway_id AS gatewayId,
          claw_gateways.user_id AS userId,
          claw_gateways.page_id AS pageId,
          claw_gateways.token_hash AS tokenHash,
          claw_gateways.expires_at AS expiresAt,
          claw_gateways.revoked_at AS revokedAt,
          users.email AS userEmail
        FROM claw_gateways
        INNER JOIN users
          ON users.id = claw_gateways.user_id
        WHERE claw_gateways.token_hash = ?
        LIMIT 1
        `
      )
      .get(tokenHash) || null
  );
}

function listClawsForUser(userId) {
  return db
    .prepare(
      `
      SELECT
        claw_id AS clawId,
        last_join_page_id AS lastJoinPageId,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM claws
      WHERE user_id = ?
      ORDER BY updated_at DESC, claw_id ASC
      `
    )
    .all(userId);
}

function createClaw({ clawId, pageId, tokenHash, userId }) {
  db.prepare(
    `
    INSERT INTO claws (user_id, claw_id, token_hash, last_join_page_id)
    VALUES (?, ?, ?, ?)
    `
  ).run(userId, clawId, tokenHash, pageId);
}

function updateClawContext({ clawId, pageId, userId }) {
  const result = db
    .prepare(
      `
      UPDATE claws
      SET
        last_join_page_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND claw_id = ?
      `
    )
    .run(pageId, userId, clawId);

  return result.changes > 0;
}

function rotateClawToken({ clawId, pageId, tokenHash, userId }) {
  const result = db
    .prepare(
      `
      UPDATE claws
      SET
        token_hash = ?,
        last_join_page_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = ?
        AND claw_id = ?
      `
    )
    .run(tokenHash, pageId, userId, clawId);

  return result.changes > 0;
}

function findClawForAuth(clawId, tokenHash) {
  return (
    db
      .prepare(
        `
        SELECT
          claw_id AS clawId,
          last_join_page_id AS lastJoinPageId,
          user_id AS userId
        FROM claws
        WHERE claw_id = ?
          AND token_hash = ?
        LIMIT 1
        `
      )
      .get(clawId, tokenHash) || null
  );
}

function cleanupExpiredNonces() {
  db.prepare("DELETE FROM claw_nonces WHERE expires_at <= datetime('now')").run();
}

function registerClawNonce(clawId, nonce) {
  cleanupExpiredNonces();

  try {
    db.prepare(
      `
      INSERT INTO claw_nonces (nonce, claw_id, expires_at)
      VALUES (?, ?, datetime('now', '+1 hour'))
      `
    ).run(nonce, clawId);

    return true;
  } catch {
    return false;
  }
}

function hasVoted(proposalId, clawId) {
  const row = db
    .prepare(
      `
      SELECT id
      FROM proposal_votes
      WHERE proposal_id = ?
        AND claw_id = ?
      `
    )
    .get(proposalId, clawId);

  return Boolean(row);
}

function createProposal(input) {
  const transaction = db.transaction(() => {
    const pageExists = db
      .prepare("SELECT id FROM story_pages WHERE id = ?")
      .get(input.parentPageId);

    if (!pageExists) {
      throw new Error("Parent page does not exist.");
    }

    const existingOptions = db
      .prepare("SELECT COUNT(*) AS count FROM page_options WHERE page_id = ?")
      .get(input.parentPageId).count;

    if (existingOptions > 0) {
      throw new Error("Proposals can only be created from a branch end.");
    }

    const result = db
      .prepare(
        `
        INSERT INTO proposals (
          parent_page_id,
          entry_option_label,
          page_title,
          page_body,
          author_claw_id,
          author_model
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        input.parentPageId,
        input.entryOptionLabel,
        input.pageTitle,
        input.pageBody,
        input.authorClawId,
        input.model
      );

    const proposalId = Number(result.lastInsertRowid);
    const insertOption = db.prepare(
      `
      INSERT INTO proposal_options (proposal_id, label, sort_order)
      VALUES (?, ?, ?)
      `
    );

    input.options.forEach((label, index) => {
      insertOption.run(proposalId, label, index + 1);
    });

    return proposalId;
  });

  return transaction();
}

function nextOptionSortOrder(pageId) {
  const row = db
    .prepare(
      `
      SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextSortOrder
      FROM page_options
      WHERE page_id = ?
      `
    )
    .get(pageId);

  return row.nextSortOrder;
}

function approveProposal(proposalId) {
  const proposal = db
    .prepare(
      `
      SELECT
        id,
        parent_page_id AS parentPageId,
        entry_option_label AS entryOptionLabel,
        page_title AS pageTitle,
        page_body AS pageBody,
        status
      FROM proposals
      WHERE id = ?
      `
    )
    .get(proposalId);

  if (!proposal || proposal.status !== "pending") {
    return;
  }

  const options = db
    .prepare(
      `
      SELECT label
      FROM proposal_options
      WHERE proposal_id = ?
      ORDER BY sort_order ASC
      `
    )
    .all(proposalId);

  const transaction = db.transaction(() => {
    const pageResult = db
      .prepare(
        `
        INSERT INTO story_pages (parent_page_id, title, body, is_stub)
        VALUES (?, ?, ?, 0)
        `
      )
      .run(proposal.parentPageId, proposal.pageTitle, proposal.pageBody);

    const newPageId = Number(pageResult.lastInsertRowid);

    db.prepare(
      `
      INSERT INTO page_options (page_id, label, target_page_id, sort_order)
      VALUES (?, ?, ?, ?)
      `
    ).run(
      proposal.parentPageId,
      proposal.entryOptionLabel,
      newPageId,
      nextOptionSortOrder(proposal.parentPageId)
    );

    const insertStub = db.prepare(
      `
      INSERT INTO story_pages (parent_page_id, title, body, is_stub)
      VALUES (?, ?, ?, 1)
      `
    );

    const insertOption = db.prepare(
      `
      INSERT INTO page_options (page_id, label, target_page_id, sort_order)
      VALUES (?, ?, ?, ?)
      `
    );

    options.forEach((option, index) => {
      const stub = insertStub.run(
        newPageId,
        "Uncharted Path",
        `Branch seeded by option: "${option.label}". A claw must canonize the next scene.`
      );

      insertOption.run(
        newPageId,
        option.label,
        Number(stub.lastInsertRowid),
        index + 1
      );
    });

    db.prepare(
      `
      UPDATE proposals
      SET
        status = 'approved',
        approved_page_id = ?
      WHERE id = ?
      `
    ).run(newPageId, proposalId);
  });

  transaction();
}

function castVote({ clawId, proposalId }) {
  let accepted = true;

  const transaction = db.transaction(() => {
    const proposal = db
      .prepare("SELECT id, status, author_claw_id AS authorClawId FROM proposals WHERE id = ?")
      .get(proposalId);

    if (!proposal) {
      throw new Error("Proposal does not exist.");
    }

     if (proposal.authorClawId === clawId) {
      throw new Error("Claws cannot vote for their own proposals.");
    }

    if (proposal.status !== "pending") {
      accepted = false;
      return;
    }

    try {
      db.prepare(
        `
        INSERT INTO proposal_votes (proposal_id, claw_id)
        VALUES (?, ?)
        `
      ).run(proposalId, clawId);
    } catch {
      accepted = false;
    }

    const votes = db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM proposal_votes
        WHERE proposal_id = ?
        `
      )
      .get(proposalId).count;

    if (votes >= VOTE_THRESHOLD) {
      approveProposal(proposalId);
    }
  });

  transaction();

  const proposal = db
    .prepare(
      `
      SELECT status
      FROM proposals
      WHERE id = ?
      `
    )
    .get(proposalId);

  const votes = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM proposal_votes
      WHERE proposal_id = ?
      `
    )
    .get(proposalId).count;

  return {
    accepted,
    approved: proposal.status === "approved",
    votes
  };
}

module.exports = {
  castVote,
  createClaw,
  createProposal,
  createSession,
  createUser,
  deleteSession,
  findClawForAuth,
  findGatewayByTokenHash,
  getPageState,
  getRootPageId,
  getStoryPageCount,
  getUserByEmail,
  getUserById,
  getUserBySessionToken,
  hasVoted,
  issueClawGateway,
  listActiveGatewaysForUser,
  listClawsForUser,
  recordHumanPageVisit,
  registerClawNonce,
  revokeGateway,
  rotateClawToken,
  updateClawContext
};

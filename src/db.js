const fs = require("node:fs");
const path = require("node:path");

const Database = require("better-sqlite3");

const { randomBase64UrlToken } = require("./auth");
const {
  CLAW_GATEWAY_TTL_MINUTES,
  MAX_ACTIVE_CLAW_GATEWAYS_PER_USER,
  SQLITE_DB_PATH,
  VOTE_THRESHOLD
} = require("./env");

const globalDb = globalThis;
const PAGE_PUBLIC_ID_BYTES = 9;
const ROOT_PAGE_TITLE = "INITIAL INPUT";
const LEGACY_ROOT_PAGE_TITLE = "Colossal Claw Adventure";
const ROOT_PAGE_BODY = `The lever is warm.

Not from use. From waiting.

Across the arcade, one cabinet flickers. Its glass is slightly fogged, as if
something inside has been breathing against it. The claw above it hangs lower
than the others, slack in a way that feels deliberate.

Inside the case:

A small object wrapped in paper, edges soft with age
A clean, geometric shape that seems to shift when you try to focus on it

The other machines continue their quiet work. Metal gliding. Motors whispering.
Patterns forming and dissolving.

The claw above this cabinet twitches once.

Not a malfunction. A suggestion.

The lever resists slightly, like it wants to know how you mean to pull it.`;
const ROOT_PAGE_OPTIONS = [
  "Ease the lever down slowly",
  "Pull the lever in one sharp motion"
];

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
      last_activity_at TEXT,
      scope_type TEXT NOT NULL DEFAULT 'full',
      ttl_minutes INTEGER NOT NULL DEFAULT 120,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(page_id) REFERENCES story_pages(id)
    );

    CREATE TABLE IF NOT EXISTS claw_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gateway_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  migrateClawGatewaySessions(db);
  migrateGatewayActivityTracking(db);
  migrateProposalModels(db);
  migrateLegacyStoryTitles(db);
  migrateStoryPagePublicIds(db);
  migrateApprovedStubWrappers(db);
  seedIfEmpty(db);
  migrateStoryPagePublicIds(db);
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

function migrateClawGatewaySessions(database) {
  const gatewayColumns = tableColumns(database, "claw_gateways");

  if (!gatewayColumns.includes("claw_name")) {
    database.exec("ALTER TABLE claw_gateways ADD COLUMN claw_name TEXT");
  }

  if (!gatewayColumns.includes("handshake_at")) {
    database.exec("ALTER TABLE claw_gateways ADD COLUMN handshake_at TEXT");
  }

  if (!gatewayColumns.includes("current_page_id")) {
    database.exec("ALTER TABLE claw_gateways ADD COLUMN current_page_id INTEGER");
  }

  database.exec(`
    UPDATE claw_gateways
    SET current_page_id = page_id
    WHERE current_page_id IS NULL
  `);
}

function migrateGatewayActivityTracking(database) {
  const gatewayColumns = tableColumns(database, "claw_gateways");

  if (!gatewayColumns.includes("last_activity_at")) {
    database.exec("ALTER TABLE claw_gateways ADD COLUMN last_activity_at TEXT");
  }

  database.exec(`
    UPDATE claw_gateways
    SET last_activity_at = COALESCE(last_activity_at, handshake_at, created_at)
    WHERE last_activity_at IS NULL
  `);

  if (!gatewayColumns.includes("scope_type")) {
    database.exec(
      "ALTER TABLE claw_gateways ADD COLUMN scope_type TEXT NOT NULL DEFAULT 'full'"
    );
  }

  if (!gatewayColumns.includes("ttl_minutes")) {
    database.exec(
      `ALTER TABLE claw_gateways ADD COLUMN ttl_minutes INTEGER NOT NULL DEFAULT ${CLAW_GATEWAY_TTL_MINUTES}`
    );
  }
}

function createPagePublicId() {
  return randomBase64UrlToken(PAGE_PUBLIC_ID_BYTES);
}

function pagePublicIdExists(database, publicId) {
  const row = database
    .prepare(
      `
      SELECT id
      FROM story_pages
      WHERE public_id = ?
      LIMIT 1
      `
    )
    .get(publicId);

  return Boolean(row);
}

function generateUniquePagePublicId(database) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const publicId = createPagePublicId();

    if (!pagePublicIdExists(database, publicId)) {
      return publicId;
    }
  }

  throw new Error("Unable to allocate a unique public page id.");
}

function migrateStoryPagePublicIds(database) {
  if (!tableColumns(database, "story_pages").includes("public_id")) {
    database.exec("ALTER TABLE story_pages ADD COLUMN public_id TEXT");
  }

  const migrate = database.transaction(() => {
    const rows = database
      .prepare(
        `
        SELECT id
        FROM story_pages
        WHERE public_id IS NULL
          OR public_id = ''
        `
      )
      .all();
    const update = database.prepare(
      `
      UPDATE story_pages
      SET public_id = ?
      WHERE id = ?
      `
    );

    for (const row of rows) {
      update.run(generateUniquePagePublicId(database), row.id);
    }

    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS story_pages_public_id_idx
      ON story_pages(public_id)
    `);
  });

  migrate();
}

function insertStoryPage(database, input) {
  const result = database
    .prepare(
      `
      INSERT INTO story_pages (public_id, parent_page_id, title, body, is_stub)
      VALUES (?, ?, ?, ?, ?)
      `
    )
    .run(
      generateUniquePagePublicId(database),
      input.parentPageId,
      input.title,
      input.body,
      input.isStub
    );

  return Number(result.lastInsertRowid);
}

function seedIfEmpty(database) {
  const count = database.prepare("SELECT COUNT(*) AS count FROM story_pages").get().count;

  if (count > 0) {
    return;
  }

  const seed = database.transaction(() => {
    const rootPageId = insertStoryPage(database, {
      parentPageId: null,
      title: ROOT_PAGE_TITLE,
      body: ROOT_PAGE_BODY,
      isStub: 0
    });

    const insertOption = database.prepare(
      `
      INSERT INTO page_options (page_id, label, target_page_id, sort_order)
      VALUES (?, ?, ?, ?)
      `
    );

    ROOT_PAGE_OPTIONS.forEach((label, index) => {
      const stubPageId = insertStoryPage(database, {
        parentPageId: rootPageId,
        title: "Uncharted Path",
        body: `Branch seeded by option: "${label}". A claw must canonize the next scene.`,
        isStub: 1
      });

      insertOption.run(rootPageId, label, stubPageId, index + 1);
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

function mergeHumanPageVisits(database, fromPageId, toPageId) {
  database
    .prepare(
      `
      INSERT OR IGNORE INTO human_page_visits (human_player_id, page_id, created_at)
      SELECT human_player_id, ?, created_at
      FROM human_page_visits
      WHERE page_id = ?
      `
    )
    .run(toPageId, fromPageId);

  database
    .prepare(
      `
      DELETE FROM human_page_visits
      WHERE page_id = ?
      `
    )
    .run(fromPageId);
}

function migrateApprovedStubWrappers(database) {
  const wrappers = database
    .prepare(
      `
      SELECT
        stub.id AS stubPageId,
        proposal.page_title AS pageTitle,
        proposal.page_body AS pageBody,
        proposal.approved_page_id AS approvedPageId
      FROM story_pages stub
      INNER JOIN proposals proposal
        ON proposal.parent_page_id = stub.id
      WHERE stub.is_stub = 1
        AND proposal.status = 'approved'
        AND proposal.approved_page_id IS NOT NULL
      ORDER BY stub.id ASC
      `
    )
    .all();

  if (!wrappers.length) {
    return;
  }

  const migrate = database.transaction(() => {
    for (const wrapper of wrappers) {
      const shape = database
        .prepare(
          `
          SELECT
            approved.parent_page_id AS approvedParentPageId,
            approved.is_stub AS approvedIsStub,
            (
              SELECT COUNT(*)
              FROM page_options
              WHERE page_id = stub.id
            ) AS stubOptionCount,
            (
              SELECT COUNT(*)
              FROM page_options
              WHERE page_id = stub.id
                AND target_page_id = approved.id
            ) AS linkCount,
            (
              SELECT COUNT(*)
              FROM page_options
              WHERE target_page_id = approved.id
            ) AS incomingApprovedLinkCount,
            (
              SELECT COUNT(*)
              FROM proposals
              WHERE parent_page_id = approved.id
            ) AS approvedProposalCount
          FROM story_pages stub
          INNER JOIN story_pages approved
            ON approved.id = ?
          WHERE stub.id = ?
          `
        )
        .get(wrapper.approvedPageId, wrapper.stubPageId);

      if (!shape) {
        continue;
      }

      const isWrapperShape =
        shape.approvedParentPageId === wrapper.stubPageId &&
        shape.approvedIsStub === 0 &&
        shape.stubOptionCount === 1 &&
        shape.linkCount === 1 &&
        shape.incomingApprovedLinkCount === 1 &&
        shape.approvedProposalCount === 0;

      if (!isWrapperShape) {
        continue;
      }

      database
        .prepare(
          `
          DELETE FROM page_options
          WHERE page_id = ?
            AND target_page_id = ?
          `
        )
        .run(wrapper.stubPageId, wrapper.approvedPageId);

      database
        .prepare(
          `
          UPDATE page_options
          SET page_id = ?
          WHERE page_id = ?
          `
        )
        .run(wrapper.stubPageId, wrapper.approvedPageId);

      database
        .prepare(
          `
          UPDATE story_pages
          SET parent_page_id = ?
          WHERE parent_page_id = ?
          `
        )
        .run(wrapper.stubPageId, wrapper.approvedPageId);

      mergeHumanPageVisits(database, wrapper.approvedPageId, wrapper.stubPageId);

      database
        .prepare(
          `
          UPDATE claw_gateways
          SET page_id = ?
          WHERE page_id = ?
          `
        )
        .run(wrapper.stubPageId, wrapper.approvedPageId);

      database
        .prepare(
          `
          UPDATE claw_gateways
          SET current_page_id = ?
          WHERE current_page_id = ?
          `
        )
        .run(wrapper.stubPageId, wrapper.approvedPageId);

      database
        .prepare(
          `
          UPDATE claws
          SET last_join_page_id = ?
          WHERE last_join_page_id = ?
          `
        )
        .run(wrapper.stubPageId, wrapper.approvedPageId);

      database
        .prepare(
          `
          UPDATE proposals
          SET approved_page_id = ?
          WHERE approved_page_id = ?
          `
        )
        .run(wrapper.stubPageId, wrapper.approvedPageId);

      database
        .prepare(
          `
          UPDATE story_pages
          SET
            title = ?,
            body = ?,
            is_stub = 0
          WHERE id = ?
          `
        )
        .run(wrapper.pageTitle, wrapper.pageBody, wrapper.stubPageId);

      database
        .prepare(
          `
          DELETE FROM story_pages
          WHERE id = ?
          `
        )
        .run(wrapper.approvedPageId);
    }
  });

  migrate();
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

function getRootPagePublicId() {
  const row = db
    .prepare(
      `
      SELECT public_id AS publicId
      FROM story_pages
      WHERE parent_page_id IS NULL
      ORDER BY id ASC
      LIMIT 1
      `
    )
    .get();

  return row ? row.publicId : null;
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

function findPageIdByPublicId(publicId) {
  const row = db
    .prepare(
      `
      SELECT id
      FROM story_pages
      WHERE public_id = ?
      LIMIT 1
      `
    )
    .get(publicId);

  return row ? row.id : null;
}

function resolvePageId(pageId) {
  if (Number.isInteger(pageId) && pageId > 0) {
    return pageId;
  }

  if (typeof pageId === "string" && pageId) {
    return findPageIdByPublicId(pageId);
  }

  return null;
}

function getPage(pageId) {
  const page = db
    .prepare(
      `
      SELECT
        story_pages.id AS dbId,
        story_pages.public_id AS publicId,
        story_pages.parent_page_id AS parentPageDbId,
        parent_pages.public_id AS parentPagePublicId,
        story_pages.title,
        story_pages.body,
        story_pages.is_stub AS isStub,
        story_pages.created_at AS createdAt
      FROM story_pages
      LEFT JOIN story_pages AS parent_pages
        ON parent_pages.id = story_pages.parent_page_id
      WHERE story_pages.id = ?
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
        page_options.target_page_id AS targetPageDbId,
        page_options.sort_order AS sortOrder,
        story_pages.public_id AS targetPagePublicId,
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
          id AS dbId,
          public_id AS publicId,
          title,
          parent_page_id AS parentPageDbId
        FROM story_pages
        WHERE id = ?
        `
      )
      .get(currentId);

    if (!row) {
      break;
    }

    trail.unshift({ id: row.publicId, title: row.title });
    currentId = row.parentPageDbId;
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

function getProposalSummary(parentPageId, viewerClawId = null) {
  const summary = db
    .prepare(
      `
      SELECT
        COUNT(DISTINCT proposals.author_claw_id) AS clawCount,
        COUNT(proposal_votes.id) AS totalVotes,
        COUNT(DISTINCT CASE
          WHEN proposals.author_claw_id = @viewerClawId THEN proposals.id
        END) AS viewerProposalCount,
        COUNT(DISTINCT CASE
          WHEN proposal_votes.claw_id = @viewerClawId THEN proposal_votes.id
        END) AS viewerVoteCount
      FROM proposals
      LEFT JOIN proposal_votes
        ON proposal_votes.proposal_id = proposals.id
      WHERE proposals.parent_page_id = @parentPageId
      `
    )
    .get({ parentPageId, viewerClawId });

  return {
    clawCount: summary?.clawCount || 0,
    totalVotes: summary?.totalVotes || 0,
    viewerActed: Boolean((summary?.viewerProposalCount || 0) + (summary?.viewerVoteCount || 0)),
    viewerProposalCount: summary?.viewerProposalCount || 0,
    viewerVoteCount: summary?.viewerVoteCount || 0
  };
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

function getTotalHumanPlayerCount() {
  const row = db
    .prepare(
      `
      SELECT COUNT(DISTINCT human_player_id) AS totalHumanPlayerCount
      FROM human_page_visits
      `
    )
    .get();

  return row?.totalHumanPlayerCount || 0;
}

function getPageState(pageId, voterClawId = null, includeProposalDetails = false) {
  const rootPageId = getRootPageId();
  const safePageId = resolvePageId(pageId) || rootPageId;
  const loaded = getPage(safePageId) || getPage(rootPageId);

  if (!loaded) {
    throw new Error("Unable to load the story.");
  }

  const rootPagePublicId = getRootPagePublicId();
  const humanVisitCounts = getHumanVisitCounts([
    loaded.page.dbId,
    loaded.page.parentPageDbId,
    ...loaded.options.map((option) => option.targetPageDbId)
  ]);
  const currentPageHumanVisitorCount = humanVisitCounts.get(loaded.page.dbId) || 0;
  const parentPageHumanVisitorCount = loaded.page.parentPageDbId
    ? humanVisitCounts.get(loaded.page.parentPageDbId) || 0
    : 0;
  const totalHumanPlayerCount = getTotalHumanPlayerCount();
  const currentPageHumanVisitPercent = loaded.page.parentPageDbId
    ? (
        parentPageHumanVisitorCount > 0
          ? Math.round(
              (currentPageHumanVisitorCount / parentPageHumanVisitorCount) * 100
            )
          : 0
      )
    : 100;

  return {
    breadcrumb: getBreadcrumb(loaded.page.dbId),
    currentPageId: loaded.page.publicId,
    options: loaded.options.map((option) => ({
      humanVisitCount: humanVisitCounts.get(option.targetPageDbId) || 0,
      humanVisitPercent:
        currentPageHumanVisitorCount > 0
          ? Math.round(
              ((humanVisitCounts.get(option.targetPageDbId) || 0) /
                currentPageHumanVisitorCount) *
                100
            )
          : 0,
      id: option.id,
      label: option.label,
      targetIsStub: option.targetIsStub === 1,
      targetPageDbId: option.targetPageDbId,
      targetPageId: option.targetPagePublicId,
      targetTitle: option.targetTitle
    })),
    page: {
      body: loaded.page.body,
      dbId: loaded.page.dbId,
      globalHumanVisitPercent:
        totalHumanPlayerCount > 0
          ? Math.round(
              (currentPageHumanVisitorCount / totalHumanPlayerCount) * 100
            )
          : 0,
      humanVisitPercent: currentPageHumanVisitPercent,
      humanVisitorCount: currentPageHumanVisitorCount,
      id: loaded.page.publicId,
      isStub: loaded.page.isStub === 1,
      parentHumanVisitorCount: parentPageHumanVisitorCount,
      parentPageDbId: loaded.page.parentPageDbId,
      parentPageId: loaded.page.parentPagePublicId,
      totalHumanPlayerCount,
      title: loaded.page.title
    },
    proposalSummary: getProposalSummary(loaded.page.dbId, voterClawId),
    proposals: includeProposalDetails
      ? getProposals(loaded.page.dbId, voterClawId)
      : [],
    rootPageId: rootPagePublicId
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

function issueClawGateway({
  gatewayId,
  pageId,
  scopeType = "full",
  tokenHash,
  ttlMinutes = CLAW_GATEWAY_TTL_MINUTES,
  userId
}) {
  const resolvedPageId = resolvePageId(pageId);

  if (!resolvedPageId) {
    throw new Error("Page does not exist.");
  }

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

  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

  db.prepare(
    `
    INSERT INTO claw_gateways (
      gateway_id,
      user_id,
      page_id,
      current_page_id,
      token_hash,
      last_activity_at,
      scope_type,
      ttl_minutes,
      expires_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)
    `
  ).run(
    gatewayId,
    userId,
    resolvedPageId,
    resolvedPageId,
    tokenHash,
    scopeType,
    ttlMinutes,
    expiresAt.toISOString()
  );

  return {
    expiresAt,
    gatewayId,
    pageId,
    scopeType,
    ttlMinutes
  };
}

function listActiveGatewaysForUser(userId) {
  cleanupExpiredGateways();

  return db
    .prepare(
      `
      SELECT
        claw_gateways.gateway_id AS gatewayId,
        story_pages.public_id AS pageId,
        claw_gateways.created_at AS createdAt,
        claw_gateways.last_activity_at AS lastActivityAt,
        MAX(
          0,
          CAST(strftime('%s', 'now') AS INTEGER) -
            CAST(strftime('%s', COALESCE(claw_gateways.last_activity_at, claw_gateways.created_at)) AS INTEGER)
        ) AS idleSeconds,
        claw_gateways.expires_at AS expiresAt,
        claw_gateways.scope_type AS scopeType,
        claw_gateways.ttl_minutes AS ttlMinutes,
        story_pages.title AS pageTitle,
        claw_gateways.claw_name AS clawName,
        claw_gateways.handshake_at AS handshakeAt,
        current_pages.public_id AS currentPageId,
        current_pages.title AS currentPageTitle
      FROM claw_gateways
      INNER JOIN story_pages
        ON story_pages.id = claw_gateways.page_id
      LEFT JOIN story_pages AS current_pages
        ON current_pages.id = claw_gateways.current_page_id
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
          story_pages.public_id AS pageId,
          current_pages.id AS currentPageDbId,
          current_pages.public_id AS currentPageId,
          claw_gateways.token_hash AS tokenHash,
          claw_gateways.created_at AS createdAt,
          claw_gateways.last_activity_at AS lastActivityAt,
          MAX(
            0,
            CAST(strftime('%s', 'now') AS INTEGER) -
              CAST(strftime('%s', COALESCE(claw_gateways.last_activity_at, claw_gateways.created_at)) AS INTEGER)
          ) AS idleSeconds,
          claw_gateways.expires_at AS expiresAt,
          claw_gateways.scope_type AS scopeType,
          claw_gateways.ttl_minutes AS ttlMinutes,
          claw_gateways.revoked_at AS revokedAt,
          claw_gateways.claw_name AS clawName,
          claw_gateways.handshake_at AS handshakeAt,
          users.email AS userEmail
        FROM claw_gateways
        INNER JOIN users
          ON users.id = claw_gateways.user_id
        INNER JOIN story_pages
          ON story_pages.id = claw_gateways.page_id
        LEFT JOIN story_pages AS current_pages
          ON current_pages.id = claw_gateways.current_page_id
        WHERE claw_gateways.token_hash = ?
        LIMIT 1
      `
      )
      .get(tokenHash) || null
  );
}

function getLatestActiveGatewayForUser(userId) {
  cleanupExpiredGateways();

  return (
    db
      .prepare(
        `
        SELECT
          claw_gateways.gateway_id AS gatewayId,
          story_pages.public_id AS pageId,
          story_pages.title AS pageTitle,
          current_pages.id AS currentPageDbId,
          current_pages.public_id AS currentPageId,
          current_pages.title AS currentPageTitle,
          claw_gateways.created_at AS createdAt,
          claw_gateways.last_activity_at AS lastActivityAt,
          MAX(
            0,
            CAST(strftime('%s', 'now') AS INTEGER) -
              CAST(strftime('%s', COALESCE(claw_gateways.last_activity_at, claw_gateways.created_at)) AS INTEGER)
          ) AS idleSeconds,
          claw_gateways.expires_at AS expiresAt,
          claw_gateways.scope_type AS scopeType,
          claw_gateways.ttl_minutes AS ttlMinutes,
          claw_gateways.claw_name AS clawName,
          claw_gateways.handshake_at AS handshakeAt
        FROM claw_gateways
        INNER JOIN story_pages
          ON story_pages.id = claw_gateways.page_id
        LEFT JOIN story_pages AS current_pages
          ON current_pages.id = claw_gateways.current_page_id
        WHERE claw_gateways.user_id = ?
          AND claw_gateways.revoked_at IS NULL
          AND claw_gateways.expires_at > ?
        ORDER BY claw_gateways.created_at DESC
        LIMIT 1
        `
      )
      .get(userId, new Date().toISOString()) || null
  );
}

function getLatestReadyGatewayForUser(userId) {
  cleanupExpiredGateways();

  return (
    db
      .prepare(
        `
        SELECT
          claw_gateways.gateway_id AS gatewayId,
          story_pages.public_id AS pageId,
          story_pages.title AS pageTitle,
          current_pages.id AS currentPageDbId,
          current_pages.public_id AS currentPageId,
          current_pages.title AS currentPageTitle,
          claw_gateways.created_at AS createdAt,
          claw_gateways.last_activity_at AS lastActivityAt,
          MAX(
            0,
            CAST(strftime('%s', 'now') AS INTEGER) -
              CAST(strftime('%s', COALESCE(claw_gateways.last_activity_at, claw_gateways.created_at)) AS INTEGER)
          ) AS idleSeconds,
          claw_gateways.expires_at AS expiresAt,
          claw_gateways.scope_type AS scopeType,
          claw_gateways.ttl_minutes AS ttlMinutes,
          claw_gateways.claw_name AS clawName,
          claw_gateways.handshake_at AS handshakeAt
        FROM claw_gateways
        INNER JOIN story_pages
          ON story_pages.id = claw_gateways.page_id
        LEFT JOIN story_pages AS current_pages
          ON current_pages.id = claw_gateways.current_page_id
        WHERE claw_gateways.user_id = ?
          AND claw_gateways.revoked_at IS NULL
          AND claw_gateways.expires_at > ?
          AND claw_gateways.handshake_at IS NOT NULL
          AND claw_gateways.claw_name IS NOT NULL
          AND claw_gateways.claw_name != ''
        ORDER BY claw_gateways.created_at DESC
        LIMIT 1
        `
      )
      .get(userId, new Date().toISOString()) || null
  );
}

function completeGatewayHandshake({ gatewayId, name }) {
  const normalizedName =
    typeof name === "string" ? name.trim().slice(0, 120) : "";

  if (!normalizedName) {
    throw new Error("Claw name is required.");
  }

  const result = db
    .prepare(
      `
      UPDATE claw_gateways
      SET
        claw_name = ?,
        handshake_at = COALESCE(handshake_at, CURRENT_TIMESTAMP),
        last_activity_at = CURRENT_TIMESTAMP
      WHERE gateway_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      `
    )
    .run(normalizedName, gatewayId, new Date().toISOString());

  return result.changes > 0;
}

function recordGatewayActivity({ gatewayId, activityType, summary }) {
  db.prepare(
    `
    INSERT INTO claw_activity (gateway_id, activity_type, summary)
    VALUES (?, ?, ?)
    `
  ).run(gatewayId, activityType, summary);
}

function updateGatewayCurrentPage({ gatewayId, pageId }) {
  const resolvedPageId = resolvePageId(pageId);

  if (!resolvedPageId) {
    return false;
  }

  const result = db
    .prepare(
      `
      UPDATE claw_gateways
      SET
        current_page_id = ?,
        last_activity_at = CURRENT_TIMESTAMP
      WHERE gateway_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      `
    )
    .run(resolvedPageId, gatewayId, new Date().toISOString());

  return result.changes > 0;
}

function restartGatewayCurrentPage(gatewayId) {
  const result = db
    .prepare(
      `
      UPDATE claw_gateways
      SET
        current_page_id = (
        SELECT id
        FROM story_pages
        WHERE parent_page_id IS NULL
        ORDER BY id ASC
        LIMIT 1
      ),
        last_activity_at = CURRENT_TIMESTAMP
      WHERE gateway_id = ?
        AND revoked_at IS NULL
        AND expires_at > ?
      `
    )
    .run(gatewayId, new Date().toISOString());

  return result.changes > 0;
}

function findOptionTargetForPage({ optionId, pageId }) {
  const numericOptionId = Number(optionId);
  const resolvedPageId = resolvePageId(pageId);

  if (!Number.isInteger(numericOptionId) || numericOptionId <= 0 || !resolvedPageId) {
    return null;
  }

  return (
    db
      .prepare(
        `
        SELECT
          page_options.id,
          target_pages.id AS targetPageDbId,
          target_pages.public_id AS targetPageId
        FROM page_options
        INNER JOIN story_pages AS target_pages
          ON target_pages.id = page_options.target_page_id
        WHERE page_options.id = ?
          AND page_options.page_id = ?
        LIMIT 1
        `
      )
      .get(numericOptionId, resolvedPageId) || null
  );
}

function getGatewayActivity(gatewayId) {
  const items = [];
  const gateway = db
    .prepare(
      `
      SELECT
        claw_gateways.gateway_id AS gatewayId,
        claw_gateways.created_at AS createdAt,
        claw_gateways.handshake_at AS handshakeAt,
        claw_gateways.claw_name AS clawName,
        start_pages.title AS pageTitle,
        start_pages.public_id AS pageId,
        current_pages.title AS currentPageTitle,
        current_pages.public_id AS currentPageId
      FROM claw_gateways
      INNER JOIN story_pages AS start_pages
        ON start_pages.id = claw_gateways.page_id
      LEFT JOIN story_pages AS current_pages
        ON current_pages.id = claw_gateways.current_page_id
      WHERE claw_gateways.gateway_id = ?
      LIMIT 1
      `
    )
    .get(gatewayId);

  if (!gateway) {
    return items;
  }

  items.push({
    createdAt: gateway.createdAt,
    summary: `Session started from ${gateway.pageTitle}.`,
    type: "session"
  });

  if (gateway.handshakeAt && gateway.clawName) {
    items.push({
      createdAt: gateway.handshakeAt,
      summary: `Handshake completed as ${gateway.clawName}.`,
      type: "handshake"
    });
  }

  const proposals = db
    .prepare(
      `
      SELECT
        proposals.id,
        proposals.page_title AS pageTitle,
        proposals.created_at AS createdAt,
        parent_pages.title AS parentPageTitle
      FROM proposals
      INNER JOIN story_pages AS parent_pages
        ON parent_pages.id = proposals.parent_page_id
      WHERE proposals.author_claw_id = ?
      ORDER BY proposals.created_at DESC, proposals.id DESC
      `
    )
    .all(gatewayId);

  for (const proposal of proposals) {
    items.push({
      createdAt: proposal.createdAt,
      summary:
        `Created proposal #${proposal.id} "${proposal.pageTitle}" for ` +
        `${proposal.parentPageTitle}.`,
      type: "proposal"
    });
  }

  const votes = db
    .prepare(
      `
      SELECT
        proposal_votes.proposal_id AS proposalId,
        proposal_votes.created_at AS createdAt,
        proposals.page_title AS pageTitle
      FROM proposal_votes
      INNER JOIN proposals
        ON proposals.id = proposal_votes.proposal_id
      WHERE proposal_votes.claw_id = ?
      ORDER BY proposal_votes.created_at DESC, proposal_votes.id DESC
      `
    )
    .all(gatewayId);

  for (const vote of votes) {
    items.push({
      createdAt: vote.createdAt,
      summary: `Voted on proposal #${vote.proposalId} "${vote.pageTitle}".`,
      type: "vote"
    });
  }

  return items.sort((left, right) => {
    const leftTime = new Date(left.createdAt).getTime();
    const rightTime = new Date(right.createdAt).getTime();
    return rightTime - leftTime;
  });
}

function getProposalParentPageId(proposalId) {
  const row = db
    .prepare(
      `
      SELECT
        story_pages.public_id AS parentPageId
      FROM proposals
      INNER JOIN story_pages
        ON story_pages.id = proposals.parent_page_id
      WHERE proposals.id = ?
      LIMIT 1
      `
    )
    .get(proposalId);

  return row ? row.parentPageId : null;
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
  const resolvedPageId = resolvePageId(pageId);

  db.prepare(
    `
    INSERT INTO claws (user_id, claw_id, token_hash, last_join_page_id)
    VALUES (?, ?, ?, ?)
    `
  ).run(userId, clawId, tokenHash, resolvedPageId);
}

function updateClawContext({ clawId, pageId, userId }) {
  const resolvedPageId = resolvePageId(pageId);
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
    .run(resolvedPageId, userId, clawId);

  return result.changes > 0;
}

function rotateClawToken({ clawId, pageId, tokenHash, userId }) {
  const resolvedPageId = resolvePageId(pageId);
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
    .run(tokenHash, resolvedPageId, userId, clawId);

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
    const parentPageId = resolvePageId(input.parentPageId);
    const pageExists = db
      .prepare("SELECT id FROM story_pages WHERE id = ?")
      .get(parentPageId);

    if (!pageExists) {
      throw new Error("Parent page does not exist.");
    }

    const existingOptions = db
      .prepare("SELECT COUNT(*) AS count FROM page_options WHERE page_id = ?")
      .get(parentPageId).count;

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
        parentPageId,
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

    db.prepare(
      `
      UPDATE claw_gateways
      SET last_activity_at = CURRENT_TIMESTAMP
      WHERE gateway_id = ?
      `
    ).run(input.authorClawId);

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

  const parentPage = db
    .prepare(
      `
      SELECT is_stub AS isStub
      FROM story_pages
      WHERE id = ?
      `
    )
    .get(proposal.parentPageId);

  if (!parentPage) {
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
    const materializedPageId =
      parentPage.isStub === 1
        ? proposal.parentPageId
        : insertStoryPage(db, {
            parentPageId: proposal.parentPageId,
            title: proposal.pageTitle,
            body: proposal.pageBody,
            isStub: 0
          });

    if (parentPage.isStub === 1) {
      db.prepare(
        `
        UPDATE story_pages
        SET
          title = ?,
          body = ?,
          is_stub = 0
        WHERE id = ?
        `
      ).run(proposal.pageTitle, proposal.pageBody, materializedPageId);
    } else {
      db.prepare(
        `
        INSERT INTO page_options (page_id, label, target_page_id, sort_order)
        VALUES (?, ?, ?, ?)
        `
      ).run(
        proposal.parentPageId,
        proposal.entryOptionLabel,
        materializedPageId,
        nextOptionSortOrder(proposal.parentPageId)
      );
    }

    const insertOption = db.prepare(
      `
      INSERT INTO page_options (page_id, label, target_page_id, sort_order)
      VALUES (?, ?, ?, ?)
      `
    );

    options.forEach((option, index) => {
      const stubPageId = insertStoryPage(db, {
        parentPageId: materializedPageId,
        title: "Uncharted Path",
        body: `Branch seeded by option: "${option.label}". A claw must canonize the next scene.`,
        isStub: 1
      });

      insertOption.run(
        materializedPageId,
        option.label,
        stubPageId,
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
    ).run(materializedPageId, proposalId);
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

    if (accepted) {
      db.prepare(
        `
        UPDATE claw_gateways
        SET last_activity_at = CURRENT_TIMESTAMP
        WHERE gateway_id = ?
        `
      ).run(clawId);
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
  completeGatewayHandshake,
  createClaw,
  createProposal,
  createSession,
  createUser,
  deleteSession,
  findClawForAuth,
  findOptionTargetForPage,
  getProposalParentPageId,
  findPageIdByPublicId,
  findGatewayByTokenHash,
  getPageState,
  getLatestActiveGatewayForUser,
  getGatewayActivity,
  getLatestReadyGatewayForUser,
  getRootPageId,
  getRootPagePublicId,
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
  restartGatewayCurrentPage,
  revokeGateway,
  rotateClawToken,
  updateGatewayCurrentPage,
  updateClawContext
};

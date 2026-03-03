import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

const VOTE_THRESHOLD = 3;

type DbInstance = Database.Database;

type ProposalStatus = "pending" | "approved";

export type StoryPage = {
  id: number;
  parentPageId: number | null;
  title: string;
  body: string;
  isStub: number;
  createdAt: string;
};

export type StoryOption = {
  id: number;
  label: string;
  sortOrder: number;
  targetPageId: number;
  targetTitle: string;
  targetIsStub: number;
};

export type ProposalView = {
  id: number;
  parentPageId: number;
  entryOptionLabel: string;
  pageTitle: string;
  pageBody: string;
  authorName: string;
  authorType: string;
  status: ProposalStatus;
  votes: number;
  createdAt: string;
  options: string[];
};

export type Breadcrumb = {
  id: number;
  title: string;
};

export type HumanRow = {
  id: number;
  email: string;
  name: string;
};

const DB_PATH =
  process.env.SQLITE_DB_PATH ??
  path.join(process.cwd(), "data", "colossal-claw-adventure.sqlite");

const globalForDb = globalThis as typeof globalThis & {
  __ccaDb?: DbInstance;
};

const db = globalForDb.__ccaDb ?? createDatabase();

if (!globalForDb.__ccaDb) {
  globalForDb.__ccaDb = db;
}

function createDatabase(): DbInstance {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");
  initializeSchema(instance);
  seedIfEmpty(instance);
  return instance;
}

function initializeSchema(instance: DbInstance): void {
  instance.exec(`
    CREATE TABLE IF NOT EXISTS humans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      author_name TEXT NOT NULL,
      author_type TEXT NOT NULL,
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
      voter_id TEXT NOT NULL,
      voter_type TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(proposal_id, voter_id, voter_type),
      FOREIGN KEY(proposal_id) REFERENCES proposals(id)
    );

    CREATE TABLE IF NOT EXISTS claw_nonces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nonce TEXT NOT NULL UNIQUE,
      claw_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );
  `);
}

function seedIfEmpty(instance: DbInstance): void {
  const countRow = instance
    .prepare("SELECT COUNT(*) as count FROM story_pages")
    .get() as { count: number };

  if (countRow.count > 0) {
    return;
  }

  const seed = instance.transaction(() => {
    const insertPage = instance.prepare(
      `
      INSERT INTO story_pages (parent_page_id, title, body, is_stub)
      VALUES (@parentPageId, @title, @body, @isStub)
      `
    );

    const insertOption = instance.prepare(
      `
      INSERT INTO page_options (page_id, label, target_page_id, sort_order)
      VALUES (@pageId, @label, @targetPageId, @sortOrder)
      `
    );

    const rootResult = insertPage.run({
      parentPageId: null,
      title: "The Colossal Claw Antechamber",
      body:
        "A ring of arcade cranes hums under stained glass skylights. " +
        "Every lever you touch writes another route in the shared tale.",
      isStub: 0
    });

    const rootId = Number(rootResult.lastInsertRowid);

    const neonHallResult = insertPage.run({
      parentPageId: rootId,
      title: "Uncharted Neon Hall",
      body:
        "This branch is live but unwritten. Propose the next scene and " +
        "options to let humans and claws expand the world.",
      isStub: 1
    });

    const echoPitResult = insertPage.run({
      parentPageId: rootId,
      title: "Uncharted Echo Pit",
      body:
        "No canonical scene exists here yet. Add one proposal or vote on " +
        "existing drafts to continue this route.",
      isStub: 1
    });

    insertOption.run({
      pageId: rootId,
      label: "Follow the neon pawprints",
      targetPageId: Number(neonHallResult.lastInsertRowid),
      sortOrder: 1
    });

    insertOption.run({
      pageId: rootId,
      label: "Descend into the echo pit",
      targetPageId: Number(echoPitResult.lastInsertRowid),
      sortOrder: 2
    });
  });

  seed();
}

function cleanupExpiredNonces(): void {
  db.prepare("DELETE FROM claw_nonces WHERE expires_at <= datetime('now')").run();
}

export function registerClawNonce(clawId: string, nonce: string): boolean {
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

export function upsertHuman(email: string, name: string): HumanRow {
  db.prepare(
    `
    INSERT INTO humans (email, name)
    VALUES (?, ?)
    ON CONFLICT(email)
    DO UPDATE SET
      name = excluded.name,
      updated_at = CURRENT_TIMESTAMP
    `
  ).run(email, name);

  return db
    .prepare("SELECT id, email, name FROM humans WHERE email = ?")
    .get(email) as HumanRow;
}

export function getRootPageId(): number {
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
    .get() as { id: number } | undefined;

  if (!row) {
    throw new Error("No root page found.");
  }

  return row.id;
}

export function getPage(pageId: number): {
  page: StoryPage;
  options: StoryOption[];
} | null {
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
    .get(pageId) as StoryPage | undefined;

  if (!page) {
    return null;
  }

  const options = db
    .prepare(
      `
      SELECT
        po.id,
        po.label,
        po.sort_order AS sortOrder,
        po.target_page_id AS targetPageId,
        sp.title AS targetTitle,
        sp.is_stub AS targetIsStub
      FROM page_options po
      INNER JOIN story_pages sp
        ON sp.id = po.target_page_id
      WHERE po.page_id = ?
      ORDER BY po.sort_order ASC, po.id ASC
      `
    )
    .all(pageId) as StoryOption[];

  return { page, options };
}

export function getBreadcrumb(pageId: number): Breadcrumb[] {
  const trail: Breadcrumb[] = [];
  let currentId: number | null = pageId;

  while (currentId !== null) {
    const row = db
      .prepare(
        `
        SELECT id, title, parent_page_id as parentPageId
        FROM story_pages
        WHERE id = ?
        `
      )
      .get(currentId) as { id: number; title: string; parentPageId: number | null };

    if (!row) {
      break;
    }

    trail.unshift({ id: row.id, title: row.title });
    currentId = row.parentPageId;
  }

  return trail;
}

export function getProposals(parentPageId: number): ProposalView[] {
  const proposalRows = db
    .prepare(
      `
      SELECT
        p.id,
        p.parent_page_id AS parentPageId,
        p.entry_option_label AS entryOptionLabel,
        p.page_title AS pageTitle,
        p.page_body AS pageBody,
        p.author_name AS authorName,
        p.author_type AS authorType,
        p.status,
        p.created_at AS createdAt,
        COUNT(v.id) AS votes
      FROM proposals p
      LEFT JOIN proposal_votes v
        ON v.proposal_id = p.id
      WHERE p.parent_page_id = ?
      GROUP BY p.id
      ORDER BY p.status ASC, votes DESC, p.created_at DESC
      `
    )
    .all(parentPageId) as Array<ProposalView & { votes: number }>;

  const optionRows = db
    .prepare(
      `
      SELECT proposal_id AS proposalId, label, sort_order AS sortOrder
      FROM proposal_options
      WHERE proposal_id IN (
        SELECT id FROM proposals WHERE parent_page_id = ?
      )
      ORDER BY proposal_id ASC, sort_order ASC
      `
    )
    .all(parentPageId) as Array<{ proposalId: number; label: string; sortOrder: number }>;

  const optionsByProposal = new Map<number, string[]>();

  for (const optionRow of optionRows) {
    const existing = optionsByProposal.get(optionRow.proposalId) ?? [];
    existing.push(optionRow.label);
    optionsByProposal.set(optionRow.proposalId, existing);
  }

  return proposalRows.map((proposalRow) => ({
    ...proposalRow,
    options: optionsByProposal.get(proposalRow.id) ?? []
  }));
}

export function hasVoted(
  proposalId: number,
  voterId: string,
  voterType: "human" | "claw"
): boolean {
  const row = db
    .prepare(
      `
      SELECT id
      FROM proposal_votes
      WHERE proposal_id = ?
        AND voter_id = ?
        AND voter_type = ?
      `
    )
    .get(proposalId, voterId, voterType) as { id: number } | undefined;

  return Boolean(row);
}

export function createProposal(input: {
  parentPageId: number;
  entryOptionLabel: string;
  pageTitle: string;
  pageBody: string;
  optionLabels: string[];
  authorName: string;
  authorType: "human" | "claw";
}): number {
  const create = db.transaction(() => {
    const parentPageExists = db
      .prepare("SELECT id FROM story_pages WHERE id = ?")
      .get(input.parentPageId) as { id: number } | undefined;

    if (!parentPageExists) {
      throw new Error("Parent page does not exist.");
    }

    const proposalResult = db
      .prepare(
        `
        INSERT INTO proposals (
          parent_page_id,
          entry_option_label,
          page_title,
          page_body,
          author_name,
          author_type,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
        `
      )
      .run(
        input.parentPageId,
        input.entryOptionLabel,
        input.pageTitle,
        input.pageBody,
        input.authorName,
        input.authorType
      );

    const proposalId = Number(proposalResult.lastInsertRowid);

    const insertOption = db.prepare(
      `
      INSERT INTO proposal_options (proposal_id, label, sort_order)
      VALUES (?, ?, ?)
      `
    );

    input.optionLabels.forEach((label, index) => {
      insertOption.run(proposalId, label, index + 1);
    });

    return proposalId;
  });

  return create();
}

function approveProposal(proposalId: number): void {
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
    .get(proposalId) as
    | {
        id: number;
        parentPageId: number;
        entryOptionLabel: string;
        pageTitle: string;
        pageBody: string;
        status: ProposalStatus;
      }
    | undefined;

  if (!proposal || proposal.status !== "pending") {
    return;
  }

  const optionRows = db
    .prepare(
      `
      SELECT label, sort_order as sortOrder
      FROM proposal_options
      WHERE proposal_id = ?
      ORDER BY sort_order ASC
      `
    )
    .all(proposalId) as Array<{ label: string; sortOrder: number }>;

  const insertPage = db.prepare(
    `
    INSERT INTO story_pages (parent_page_id, title, body, is_stub)
    VALUES (?, ?, ?, 0)
    `
  );

  const insertOption = db.prepare(
    `
    INSERT INTO page_options (page_id, label, target_page_id, sort_order)
    VALUES (?, ?, ?, ?)
    `
  );

  const newPageResult = insertPage.run(
    proposal.parentPageId,
    proposal.pageTitle,
    proposal.pageBody
  );

  const newPageId = Number(newPageResult.lastInsertRowid);

  insertOption.run(
    proposal.parentPageId,
    proposal.entryOptionLabel,
    newPageId,
    getNextOptionSortOrder(proposal.parentPageId)
  );

  optionRows.forEach((optionRow, index) => {
    const stubPageResult = db
      .prepare(
        `
        INSERT INTO story_pages (parent_page_id, title, body, is_stub)
        VALUES (?, ?, ?, 1)
        `
      )
      .run(
        newPageId,
        "Uncharted Path",
        `Branch seeded by option: "${optionRow.label}". ` +
          "At this end-point, propose the next canonical page."
      );

    insertOption.run(
      newPageId,
      optionRow.label,
      Number(stubPageResult.lastInsertRowid),
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
}

function getNextOptionSortOrder(pageId: number): number {
  const row = db
    .prepare(
      `
      SELECT COALESCE(MAX(sort_order), 0) + 1 as nextSortOrder
      FROM page_options
      WHERE page_id = ?
      `
    )
    .get(pageId) as { nextSortOrder: number };

  return row.nextSortOrder;
}

export function castVote(input: {
  proposalId: number;
  voterId: string;
  voterType: "human" | "claw";
}): {
  accepted: boolean;
  votes: number;
  approved: boolean;
} {
  let accepted = true;

  const voteTx = db.transaction(() => {
    const proposal = db
      .prepare("SELECT id, status FROM proposals WHERE id = ?")
      .get(input.proposalId) as { id: number; status: ProposalStatus } | undefined;

    if (!proposal) {
      throw new Error("Proposal does not exist.");
    }

    if (proposal.status !== "pending") {
      return;
    }

    try {
      db.prepare(
        `
        INSERT INTO proposal_votes (proposal_id, voter_id, voter_type)
        VALUES (?, ?, ?)
        `
      ).run(input.proposalId, input.voterId, input.voterType);
    } catch {
      accepted = false;
    }

    const countRow = db
      .prepare(
        `
        SELECT COUNT(*) as votes
        FROM proposal_votes
        WHERE proposal_id = ?
        `
      )
      .get(input.proposalId) as { votes: number };

    if (countRow.votes >= VOTE_THRESHOLD) {
      approveProposal(input.proposalId);
    }
  });

  voteTx();

  const statusRow = db
    .prepare(
      `
      SELECT status FROM proposals WHERE id = ?
      `
    )
    .get(input.proposalId) as { status: ProposalStatus };

  const votesRow = db
    .prepare(
      `
      SELECT COUNT(*) as votes
      FROM proposal_votes
      WHERE proposal_id = ?
      `
    )
    .get(input.proposalId) as { votes: number };

  return {
    accepted,
    votes: votesRow.votes,
    approved: statusRow.status === "approved"
  };
}

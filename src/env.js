const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(fileName) {
  const filePath = path.join(process.cwd(), fileName);

  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile(".env.local");

const PORT = Number(process.env.PORT || 3000);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "cca_session";
const SQLITE_DB_PATH =
  process.env.SQLITE_DB_PATH ||
  path.join(process.cwd(), "data", "colossal-claw-adventure.sqlite");
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const VOTE_THRESHOLD = 3;
const BYOCLAW_SPEC_VERSION = "0.1.0";
const CLAW_GATEWAY_TTL_MINUTES = 10;
const MAX_ACTIVE_CLAW_GATEWAYS_PER_USER = 5;

module.exports = {
  BASE_URL,
  BYOCLAW_SPEC_VERSION,
  CLAW_GATEWAY_TTL_MINUTES,
  MAX_ACTIVE_CLAW_GATEWAYS_PER_USER,
  PORT,
  SESSION_COOKIE_NAME,
  SQLITE_DB_PATH,
  VOTE_THRESHOLD
};

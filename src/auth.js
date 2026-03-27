const crypto = require("node:crypto");

const { SESSION_COOKIE_NAME } = require("./env");
const HUMAN_PLAYER_COOKIE_NAME = "cca_human_player";

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomBase64UrlToken(bytes = 24, prefix = "") {
  return `${prefix}${crypto.randomBytes(bytes).toString("base64url")}`;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");

  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHash, "hex");

  if (actualHash.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actualHash, expected);
}

function parseCookies(cookieHeader = "") {
  const cookies = {};

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex);
    const value = trimmed.slice(separatorIndex + 1);
    cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function appendSetCookie(res, value) {
  const current = res.getHeader("Set-Cookie");

  if (!current) {
    res.setHeader("Set-Cookie", [value]);
    return;
  }

  const next = Array.isArray(current) ? current.concat(value) : [current, value];
  res.setHeader("Set-Cookie", next);
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  parts.push(`Path=${options.path || "/"}`);

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function setSessionCookie(res, token) {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production"
    })
  );
}

function setHumanPlayerCookie(res, humanPlayerId) {
  appendSetCookie(
    res,
    serializeCookie(HUMAN_PLAYER_COOKIE_NAME, humanPlayerId, {
      httpOnly: true,
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production"
    })
  );
}

function clearSessionCookie(res) {
  appendSetCookie(
    res,
    serializeCookie(SESSION_COOKIE_NAME, "", {
      expires: new Date(0),
      httpOnly: true,
      sameSite: "Lax",
      secure: process.env.NODE_ENV === "production"
    })
  );
}

function buildSessionRecord(userId) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

  return {
    expiresAt,
    token,
    tokenHash,
    userId
  };
}

module.exports = {
  buildSessionRecord,
  clearSessionCookie,
  hashPassword,
  hashToken,
  HUMAN_PLAYER_COOKIE_NAME,
  parseCookies,
  randomBase64UrlToken,
  randomToken,
  setHumanPlayerCookie,
  setSessionCookie,
  verifyPassword
};

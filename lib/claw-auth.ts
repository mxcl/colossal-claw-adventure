import crypto from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { registerClawNonce } from "@/lib/db";

type ClawAuthResult =
  | {
      ok: true;
      clawId: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

function unauthorized(message: string, status = 401): ClawAuthResult {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: message,
        usage: {
          requiredHeaders: [
            "Authorization: Bearer <OPENCLAW_API_TOKEN>",
            "X-Claw-Id: your-claw-name",
            "X-Claw-Nonce: unique-string-per-request"
          ]
        }
      },
      { status }
    )
  };
}

export function authenticateClaw(request: NextRequest): ClawAuthResult {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";

  const expectedToken = process.env.OPENCLAW_API_TOKEN;
  if (!expectedToken) {
    return unauthorized("Server is missing OPENCLAW_API_TOKEN.", 500);
  }

  const tokenMatches =
    token.length === expectedToken.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));

  if (!tokenMatches) {
    return unauthorized("Invalid claw API token.");
  }

  const clawId = (request.headers.get("x-claw-id") ?? "").trim();
  if (!clawId) {
    return unauthorized("Missing X-Claw-Id header.");
  }

  const nonce = (request.headers.get("x-claw-nonce") ?? "").trim();
  if (nonce.length < 10) {
    return unauthorized("X-Claw-Nonce must be at least 10 characters.");
  }

  const nonceAccepted = registerClawNonce(clawId, nonce);
  if (!nonceAccepted) {
    return unauthorized("Nonce already used. Generate a fresh nonce.", 409);
  }

  return {
    ok: true,
    clawId
  };
}

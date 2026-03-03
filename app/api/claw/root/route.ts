import { NextRequest, NextResponse } from "next/server";

import { authenticateClaw } from "@/lib/claw-auth";
import { loadGameState } from "@/lib/game";

export async function GET(request: NextRequest) {
  const auth = authenticateClaw(request);

  if (!auth.ok) {
    return auth.response;
  }

  const gameState = loadGameState({
    voter: {
      id: auth.clawId,
      type: "claw"
    }
  });

  return NextResponse.json({
    instructions: {
      nextStep:
        "Use options[].targetPageId with /api/claw/pages/{id} to keep moving."
    },
    page: gameState.page,
    options: gameState.options,
    rootPageId: gameState.rootPageId
  });
}

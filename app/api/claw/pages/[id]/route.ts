import { NextRequest, NextResponse } from "next/server";

import { authenticateClaw } from "@/lib/claw-auth";
import { loadGameState } from "@/lib/game";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, { params }: Params) {
  const auth = authenticateClaw(request);

  if (!auth.ok) {
    return auth.response;
  }

  const resolvedParams = await params;
  const pageId = Number(resolvedParams.id);

  if (!Number.isInteger(pageId) || pageId <= 0) {
    return NextResponse.json({ error: "Invalid page id." }, { status: 400 });
  }

  const gameState = loadGameState({
    requestedPageId: pageId,
    voter: {
      id: auth.clawId,
      type: "claw"
    }
  });

  return NextResponse.json({
    instructions: {
      branchEnd:
        "If options[] is empty, list proposals for this page or submit a new one.",
      listProposals: `/api/claw/proposals?parentPageId=${gameState.page.id}`
    },
    page: gameState.page,
    options: gameState.options,
    breadcrumb: gameState.breadcrumb
  });
}

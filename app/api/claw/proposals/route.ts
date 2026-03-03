import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { authenticateClaw } from "@/lib/claw-auth";
import { createProposal } from "@/lib/db";
import { loadGameState } from "@/lib/game";

const createProposalSchema = z.object({
  parentPageId: z.number().int().positive(),
  entryOptionLabel: z.string().trim().min(3).max(80),
  pageTitle: z.string().trim().min(3).max(120),
  pageBody: z.string().trim().min(20).max(4000),
  options: z.array(z.string().trim().min(1).max(80)).min(1).max(5)
});

export async function GET(request: NextRequest) {
  const auth = authenticateClaw(request);

  if (!auth.ok) {
    return auth.response;
  }

  const parentPageId = Number(request.nextUrl.searchParams.get("parentPageId"));

  if (!Number.isInteger(parentPageId) || parentPageId <= 0) {
    return NextResponse.json(
      { error: "Query param parentPageId must be a positive integer." },
      { status: 400 }
    );
  }

  const gameState = loadGameState({
    requestedPageId: parentPageId,
    voter: {
      id: auth.clawId,
      type: "claw"
    }
  });

  return NextResponse.json({
    instructions: {
      vote: "POST /api/claw/proposals/{proposalId}/vote to support a draft.",
      create: "POST /api/claw/proposals to submit your own draft."
    },
    parentPageId,
    branchEnd: gameState.options.length === 0,
    proposals: gameState.proposals
  });
}

export async function POST(request: NextRequest) {
  const auth = authenticateClaw(request);

  if (!auth.ok) {
    return auth.response;
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }

  const parsed = createProposalSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid proposal payload.", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const proposalId = createProposal({
    parentPageId: parsed.data.parentPageId,
    entryOptionLabel: parsed.data.entryOptionLabel,
    pageTitle: parsed.data.pageTitle,
    pageBody: parsed.data.pageBody,
    optionLabels: parsed.data.options,
    authorName: auth.clawId,
    authorType: "claw"
  });

  return NextResponse.json(
    {
      instructions: {
        nextStep:
          "List proposals for this parent page, then vote to move drafts toward approval."
      },
      proposalId,
      parentPageId: parsed.data.parentPageId
    },
    { status: 201 }
  );
}

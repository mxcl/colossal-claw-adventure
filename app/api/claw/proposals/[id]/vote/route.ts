import { NextRequest, NextResponse } from "next/server";

import { authenticateClaw } from "@/lib/claw-auth";
import { castVote } from "@/lib/db";

type Params = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, { params }: Params) {
  const auth = authenticateClaw(request);

  if (!auth.ok) {
    return auth.response;
  }

  const resolvedParams = await params;
  const proposalId = Number(resolvedParams.id);

  if (!Number.isInteger(proposalId) || proposalId <= 0) {
    return NextResponse.json({ error: "Invalid proposal id." }, { status: 400 });
  }

  try {
    const result = castVote({
      proposalId,
      voterId: auth.clawId,
      voterType: "claw"
    });

    return NextResponse.json({
      instructions: {
        approved:
          "If approved=true, reload the parent page. The new option is now live.",
        pending: "If approved=false, gather more votes until votes reaches 3."
      },
      proposalId,
      voteAccepted: result.accepted,
      votes: result.votes,
      approved: result.approved
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to record vote for proposal."
      },
      { status: 400 }
    );
  }
}

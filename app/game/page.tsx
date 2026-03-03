import Link from "next/link";
import { redirect } from "next/navigation";

import { getAuthSession } from "@/lib/auth";
import { upsertHuman } from "@/lib/db";
import { loadGameState } from "@/lib/game";

import { submitProposal, voteProposal } from "./actions";

type GamePageProps = {
  searchParams: Promise<{
    page?: string;
  }>;
};

export default async function GamePage({ searchParams }: GamePageProps) {
  const session = await getAuthSession();

  if (!session?.user?.email || !session.user.name) {
    redirect("/");
  }

  const human = upsertHuman(session.user.email, session.user.name);
  const params = await searchParams;
  const requestedPageId = Number(params.page);

  const gameState = loadGameState({
    requestedPageId: Number.isInteger(requestedPageId) ? requestedPageId : undefined,
    voter: {
      id: String(human.id),
      type: "human"
    }
  });

  const atBranchEnd = gameState.options.length === 0;

  return (
    <main className="game-shell">
      <section className="game-header-panel">
        <p className="eyebrow">Signed In As {human.name}</p>
        <h1 className="page-heading">Colossal Claw Adventure</h1>
        <div className="header-actions">
          <Link className="secondary-btn" href={`/game?page=${gameState.rootPageId}`}>
            Return To Root
          </Link>
          <Link className="secondary-btn" href="/api/auth/signout?callbackUrl=/">
            Sign Out
          </Link>
        </div>
      </section>

      <nav className="breadcrumb-row" aria-label="Breadcrumb">
        {gameState.breadcrumb.map((crumb, index) => (
          <span key={crumb.id}>
            <Link href={`/game?page=${crumb.id}`}>{crumb.title}</Link>
            {index < gameState.breadcrumb.length - 1 ? " / " : ""}
          </span>
        ))}
      </nav>

      <section className="story-card">
        <p className="eyebrow">Current Page</p>
        <h2>{gameState.page.title}</h2>
        <p>{gameState.page.body}</p>
      </section>

      {!atBranchEnd ? (
        <section className="options-grid" aria-label="Story options">
          {gameState.options.map((option) => (
            <Link
              key={option.id}
              className="option-card"
              href={`/game?page=${option.targetPageId}`}
            >
              <p className="eyebrow">Option</p>
              <h3>{option.label}</h3>
              <p>
                {option.targetIsStub
                  ? "Leads to an unwritten branch end."
                  : `Leads to: ${option.targetTitle}`}
              </p>
            </Link>
          ))}
        </section>
      ) : (
        <section className="branch-end-layout">
          <div className="branch-end-panel">
            <p className="eyebrow">Branch End</p>
            <h3>This route needs the next canonical page.</h3>
            <p>
              Submit one proposal with page content plus 1-5 options. Once a
              proposal reaches 3 votes, it is auto-approved into the story.
            </p>
            <form action={submitProposal} className="proposal-form">
              <input type="hidden" name="parentPageId" value={gameState.page.id} />
              <label>
                Option label from current page
                <input
                  name="entryOptionLabel"
                  placeholder="Example: Enter the glass maze"
                  required
                />
              </label>
              <label>
                New page title
                <input name="pageTitle" placeholder="Page title" required />
              </label>
              <label>
                New page body
                <textarea
                  name="pageBody"
                  placeholder="Write the next canonical scene for this route."
                  rows={7}
                  required
                />
              </label>
              <fieldset>
                <legend>Options on the new page (1-5)</legend>
                <input name="option1" placeholder="Option 1 (required)" required />
                <input name="option2" placeholder="Option 2 (optional)" />
                <input name="option3" placeholder="Option 3 (optional)" />
                <input name="option4" placeholder="Option 4 (optional)" />
                <input name="option5" placeholder="Option 5 (optional)" />
              </fieldset>
              <button type="submit" className="primary-btn">
                Submit Proposal
              </button>
            </form>
          </div>

          <div className="proposal-list-panel">
            <p className="eyebrow">Existing Proposals</p>
            <h3>Vote To Approve</h3>
            {gameState.proposals.length === 0 ? (
              <p>No proposals yet for this branch end.</p>
            ) : (
              <div className="proposal-list">
                {gameState.proposals.map((proposal) => (
                  <article key={proposal.id} className="proposal-card">
                    <div className="proposal-header">
                      <strong>{proposal.entryOptionLabel}</strong>
                      <span>{proposal.status.toUpperCase()}</span>
                    </div>
                    <h4>{proposal.pageTitle}</h4>
                    <p>{proposal.pageBody}</p>
                    <p className="proposal-options">
                      New page options: {proposal.options.join(" | ")}
                    </p>
                    <p>
                      By {proposal.authorName} ({proposal.authorType}) • {proposal.votes}
                      /3 votes
                    </p>
                    {proposal.status === "pending" && !proposal.alreadyVoted ? (
                      <form action={voteProposal}>
                        <input type="hidden" name="proposalId" value={proposal.id} />
                        <input type="hidden" name="pageId" value={gameState.page.id} />
                        <button className="secondary-btn" type="submit">
                          Vote For This Proposal
                        </button>
                      </form>
                    ) : null}
                    {proposal.status === "approved" ? (
                      <p className="status-tag">Approved and inserted into story.</p>
                    ) : null}
                    {proposal.alreadyVoted && proposal.status === "pending" ? (
                      <p className="status-tag">You already voted for this proposal.</p>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

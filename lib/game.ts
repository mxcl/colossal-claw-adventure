import { getBreadcrumb, getPage, getProposals, getRootPageId, hasVoted } from "@/lib/db";

export type GameState = {
  rootPageId: number;
  currentPageId: number;
  page: {
    id: number;
    title: string;
    body: string;
    isStub: boolean;
  };
  options: Array<{
    id: number;
    label: string;
    targetPageId: number;
    targetTitle: string;
    targetIsStub: boolean;
  }>;
  breadcrumb: Array<{ id: number; title: string }>;
  proposals: Array<{
    id: number;
    entryOptionLabel: string;
    pageTitle: string;
    pageBody: string;
    authorName: string;
    authorType: string;
    status: "pending" | "approved";
    votes: number;
    options: string[];
    alreadyVoted: boolean;
  }>;
};

export function loadGameState(input: {
  requestedPageId?: number;
  voter?: {
    id: string;
    type: "human" | "claw";
  };
}): GameState {
  const rootPageId = getRootPageId();
  const currentPageId = input.requestedPageId ?? rootPageId;

  const loadedPage = getPage(currentPageId) ?? getPage(rootPageId);

  if (!loadedPage) {
    throw new Error("Unable to load story root page.");
  }

  const breadcrumb = getBreadcrumb(loadedPage.page.id);
  const proposals = getProposals(loadedPage.page.id).map((proposal) => ({
    id: proposal.id,
    entryOptionLabel: proposal.entryOptionLabel,
    pageTitle: proposal.pageTitle,
    pageBody: proposal.pageBody,
    authorName: proposal.authorName,
    authorType: proposal.authorType,
    status: proposal.status,
    votes: proposal.votes,
    options: proposal.options,
    alreadyVoted: input.voter
      ? hasVoted(proposal.id, input.voter.id, input.voter.type)
      : false
  }));

  return {
    rootPageId,
    currentPageId: loadedPage.page.id,
    page: {
      id: loadedPage.page.id,
      title: loadedPage.page.title,
      body: loadedPage.page.body,
      isStub: loadedPage.page.isStub === 1
    },
    options: loadedPage.options.map((option) => ({
      id: option.id,
      label: option.label,
      targetPageId: option.targetPageId,
      targetTitle: option.targetTitle,
      targetIsStub: option.targetIsStub === 1
    })),
    breadcrumb,
    proposals
  };
}

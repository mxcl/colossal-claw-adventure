"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAuthSession } from "@/lib/auth";
import { castVote, createProposal, upsertHuman } from "@/lib/db";

const proposalSchema = z.object({
  parentPageId: z.coerce.number().int().positive(),
  entryOptionLabel: z.string().trim().min(3).max(80),
  pageTitle: z.string().trim().min(3).max(120),
  pageBody: z.string().trim().min(20).max(4000),
  option1: z.string().trim().max(80).optional().default(""),
  option2: z.string().trim().max(80).optional().default(""),
  option3: z.string().trim().max(80).optional().default(""),
  option4: z.string().trim().max(80).optional().default(""),
  option5: z.string().trim().max(80).optional().default("")
});

const voteSchema = z.object({
  proposalId: z.coerce.number().int().positive(),
  pageId: z.coerce.number().int().positive()
});

export async function submitProposal(formData: FormData) {
  const session = await getAuthSession();

  if (!session?.user?.email || !session.user.name) {
    redirect("/");
  }

  const parsed = proposalSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    throw new Error("Invalid proposal payload.");
  }

  const options = [
    parsed.data.option1,
    parsed.data.option2,
    parsed.data.option3,
    parsed.data.option4,
    parsed.data.option5
  ].filter((value) => value.length > 0);

  if (options.length < 1 || options.length > 5) {
    throw new Error("Each proposal must include between 1 and 5 options.");
  }

  const human = upsertHuman(session.user.email, session.user.name);

  createProposal({
    parentPageId: parsed.data.parentPageId,
    entryOptionLabel: parsed.data.entryOptionLabel,
    pageTitle: parsed.data.pageTitle,
    pageBody: parsed.data.pageBody,
    optionLabels: options,
    authorName: human.name,
    authorType: "human"
  });

  revalidatePath("/game");
  redirect(`/game?page=${parsed.data.parentPageId}&proposal=created`);
}

export async function voteProposal(formData: FormData) {
  const session = await getAuthSession();

  if (!session?.user?.email || !session.user.name) {
    redirect("/");
  }

  const parsed = voteSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    throw new Error("Invalid vote payload.");
  }

  const human = upsertHuman(session.user.email, session.user.name);

  castVote({
    proposalId: parsed.data.proposalId,
    voterId: String(human.id),
    voterType: "human"
  });

  revalidatePath("/game");
  redirect(`/game?page=${parsed.data.pageId}&vote=recorded`);
}

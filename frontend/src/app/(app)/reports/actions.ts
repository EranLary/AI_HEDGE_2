"use server";

import { auth } from "@/auth";
import {
  listCommunityReportsPaged,
  type DbReportSummary,
} from "@/lib/reports-db";
import type { Workspace } from "@/lib/workspace";

export type LoadMoreCommunityResult = {
  rows: DbReportSummary[];
  hasMore: boolean;
};

export async function loadMoreCommunity(input: {
  offset: number;
  limit: number;
  query: string;
  workspace: Workspace;
}): Promise<LoadMoreCommunityResult> {
  await auth();
  try {
    return await listCommunityReportsPaged({
      query: input.query,
      limit: input.limit,
      offset: input.offset,
      workspace: input.workspace,
    });
  } catch (err) {
    console.warn("[reports] loadMoreCommunity failed:", err);
    return { rows: [], hasMore: false };
  }
}

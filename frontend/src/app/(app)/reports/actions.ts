"use server";

import { auth } from "@/auth";
import {
  listCommunityReportsPaged,
  type DbReportSummary,
} from "@/lib/reports-db";
import type { ReportGoldFilter, ReportScoreFilter } from "@/lib/report-list-filters";
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
  gold: ReportGoldFilter;
  score: ReportScoreFilter;
}): Promise<LoadMoreCommunityResult> {
  await auth();
  try {
    return await listCommunityReportsPaged({
      query: input.query,
      limit: input.limit,
      offset: input.offset,
      workspace: input.workspace,
      gold: input.gold,
      score: input.score,
    });
  } catch (err) {
    console.warn("[reports] loadMoreCommunity failed:", err);
    return { rows: [], hasMore: false };
  }
}

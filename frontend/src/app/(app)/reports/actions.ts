"use server";

import { auth } from "@/auth";
import {
  listCommunityReportsPaged,
  type DbReportSummary,
} from "@/lib/reports-db";

export type LoadMoreCommunityResult = {
  rows: DbReportSummary[];
  hasMore: boolean;
};

export async function loadMoreCommunity(input: {
  offset: number;
  limit: number;
  query: string;
}): Promise<LoadMoreCommunityResult> {
  const session = await auth();
  const excludeUserId = session?.user?.id || undefined;
  try {
    return await listCommunityReportsPaged({
      excludeUserId,
      query: input.query,
      limit: input.limit,
      offset: input.offset,
    });
  } catch (err) {
    console.warn("[reports] loadMoreCommunity failed:", err);
    return { rows: [], hasMore: false };
  }
}

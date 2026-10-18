import type { Metadata } from "next";
import { TeamBoard } from "@/components/team/board";
import { loadTeam, requireTeamPage } from "@/server/team-data";

export const metadata: Metadata = { title: "Team" };

// Owner and admin only: anyone else gets "not found". Salaries are shown to the owner only.
export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, db } = await requireTeamPage();
  const sp = await searchParams;
  const day = Array.isArray(sp.day) ? sp.day[0] : sp.day;
  const data = await loadTeam(user, db, day ?? null);
  return <TeamBoard d={data} />;
}

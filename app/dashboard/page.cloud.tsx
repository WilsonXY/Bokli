"use client";

import { CloudPage } from "@/components/CloudPage";
import { DashboardView } from "@/components/DashboardView";
import { cloudRead } from "@/lib/cloud-client";

async function load(query: string) {
  const { activeMonth, tiles, tile, trend, split, costByCategory } = await cloudRead("dashboard", query);
  return { activeMonth, tiles, activeTile: tile, trend, split, costByCategory };
}

export default function DashboardPage() {
  return <CloudPage param="month" load={load} render={(props) => <DashboardView {...props} />} />;
}

import { Navigate, useParams } from "react-router";

import { ManagerBonuses } from "@/components/manager/manager-bonuses";
import { ManagerDashboard } from "@/components/manager/manager-dashboard";
import { ManagerLayout as ManagerShell } from "@/components/manager/manager-layout";
import { ManagerRankings } from "@/components/manager/manager-rankings";
import { ManagerReportPage } from "@/components/manager/manager-report-pages";
import { ManagerReports } from "@/components/manager/manager-reports";
import { useShop } from "@/components/shop-provider";

/** The manager app is for the administrator only; everyone else goes back to the main dashboard. */
export function ManagerLayout() {
  const { isAdmin } = useShop();
  const { locale } = useParams();
  if (!isAdmin) return <Navigate replace to={`/${locale}`} />;
  return <ManagerShell />;
}

export const ManagerDashboardPage = ManagerDashboard;
export const ManagerRankingsPage = ManagerRankings;
export const ManagerBonusesPage = ManagerBonuses;
export const ManagerReportsPage = ManagerReports;
export const ManagerReportDetailPage = ManagerReportPage;

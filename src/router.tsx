import { Loader2 } from "lucide-react";
import { createBrowserRouter, Navigate, Outlet, ScrollRestoration, useLocation } from "react-router";

import { NotFoundPage } from "@/components/page-status";

function RootLayout() {
  return <><ScrollRestoration /><Outlet /></>;
}

function InitialLoading() {
  return <main className="flex min-h-svh items-center justify-center"><Loader2 role="status" aria-label="Loading" className="h-6 w-6 animate-spin" /></main>;
}

/** "/" picks a language the same way the old locale middleware did. */
function RootRedirect() {
  const { search } = useLocation();
  const saved = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=(en|sq)(?:;|$)/)?.[1];
  const locale = saved ?? (navigator.language.toLowerCase().startsWith("sq") ? "sq" : "en");
  return <Navigate replace to={`/${locale}${search}`} />;
}

// Each page loads its code on first visit, like Next.js route splitting.
const pages = () => import("@/pages/dashboard");
const shopPages = () => import("@/pages/shop");
const managerPages = () => import("@/pages/manager");

export const router = createBrowserRouter([
  {
    Component: RootLayout,
    HydrateFallback: InitialLoading,
    children: [
      { path: "/", Component: RootRedirect },
      { path: "/login", lazy: () => import("@/pages/login").then(module => ({ Component: module.LoginPage })) },
      {
        path: "/:locale",
        lazy: () => import("@/pages/locale-layout").then(module => ({ Component: module.LocaleLayout })),
        children: [
          { index: true, lazy: () => pages().then(module => ({ Component: module.DashboardPage })) },
          { path: "bonuses", lazy: () => pages().then(module => ({ Component: module.BonusesPage })) },
          { path: "insights", lazy: () => pages().then(module => ({ Component: module.InsightsPage })) },
          { path: "shop", lazy: () => shopPages().then(module => ({ Component: module.ShopIndexPage })) },
          { path: "shop/:shopId", lazy: () => shopPages().then(module => ({ Component: module.ShopDetailPage })) },
          { path: "shop/:shopId/bonus", lazy: () => shopPages().then(module => ({ Component: module.ShopBonusPage })) },
          { path: "shop/:shopId/bonus/quarterly", lazy: () => shopPages().then(module => ({ Component: module.QuarterlyBonusRedirect })) },
          { path: "shop/:shopId/closing", lazy: () => shopPages().then(module => ({ Component: module.ShopClosingPage })) },
          { path: "shop/:shopId/attendance", lazy: () => shopPages().then(module => ({ Component: module.ShopAttendancePage })) },
          { path: "shop/:shopId/daily-activity", lazy: () => shopPages().then(module => ({ Component: module.ShopDailyActivityPage })) },
          { path: "shop/:shopId/procedures", lazy: () => shopPages().then(module => ({ Component: module.ShopProceduresPage })) },
          {
            path: "m",
            lazy: () => managerPages().then(module => ({ Component: module.ManagerLayout })),
            children: [
              { index: true, lazy: () => managerPages().then(module => ({ Component: module.ManagerDashboardPage })) },
              { path: "rankings", lazy: () => managerPages().then(module => ({ Component: module.ManagerRankingsPage })) },
              { path: "bonuses", lazy: () => managerPages().then(module => ({ Component: module.ManagerBonusesPage })) },
              { path: "reports", lazy: () => managerPages().then(module => ({ Component: module.ManagerReportsPage })) },
              { path: "reports/:report", lazy: () => managerPages().then(module => ({ Component: module.ManagerReportDetailPage })) },
            ],
          },
          { path: "*", Component: NotFoundPage },
        ],
      },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navigate, useParams, useSearchParams } from "react-router";
import { useTranslations } from "use-intl";

import { AttendancePage } from "@/components/attendance-page";
import { BonusAccessGate } from "@/components/bonus-access-gate";
import { BonusDashboardRoute } from "@/components/bonus-dashboard-route";
import { DailyActivityPage } from "@/components/daily-activity-page";
import { DailyClosingClient } from "@/components/daily-closing-client";
import { DetailedDashboardRoute } from "@/components/detailed-dashboard-route";
import { NotFoundPage, PageLoading } from "@/components/page-status";
import { ProceduresPage } from "@/components/procedures-page";
import { useShop } from "@/components/shop-provider";
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { shopPerformanceIndexQueryOptions } from "@/lib/performance-queries";
import { attendanceMonthSchema, monthSchema, quarterSchema, shopIdSchema } from "@/lib/persistence-schemas";
import { getPerformanceMonthsByImportRecency, type Shop } from "@/lib/types";

/*
 * Route pages. Like the former server pages, they read the URL through the
 * router, so in-place URL edits (replaceUrl) don't re-run them; components
 * that need live values read them with useSearchParams from @/lib/navigation.
 */

function useShopRoute() {
  const { shopId = "" } = useParams();
  const { shops } = useShop();
  return { shopId, shop: shops.find(item => item.id === shopId) };
}

function tiraneDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Tirane", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Month from ?month=, defaulting to the current month in Albania. */
function useRequestedMonth() {
  const [searchParams] = useSearchParams();
  const parsed = attendanceMonthSchema.safeParse(searchParams.get("month") ?? undefined);
  return parsed.success ? parsed.data : tiraneDate().slice(0, 7);
}

/**
 * Validates ?month= against the shop's imported months. Waits for the
 * performance index only when a month was requested.
 */
function useValidatedMonth(shopId: string, shop: Shop | undefined, enabled = true) {
  const [searchParams] = useSearchParams();
  const requested = searchParams.get("month") ?? undefined;
  const indexQuery = useQuery({ ...shopPerformanceIndexQueryOptions(shopId), enabled: enabled && !!shop && !!requested });
  if (!requested || !shop) return { pending: false, month: undefined };
  if (!indexQuery.data) return { pending: !indexQuery.isError, month: undefined };
  const months = getPerformanceMonthsByImportRecency(indexQuery.data, Object.keys(shop.monthlyData ?? {}));
  return { pending: false, month: months.includes(requested) ? requested : undefined };
}

export function ShopIndexPage() {
  const { locale } = useParams();
  return <Navigate replace to={`/${locale}`} />;
}

export function ShopDetailPage() {
  const { shopId, shop } = useShopRoute();
  const requested = useValidatedMonth(shopId, shop);
  if (!shop) return <NotFoundPage />;
  if (requested.pending) return <PageLoading />;
  return <DetailedDashboardRoute shopId={shopId} requestedMonth={requested.month} />;
}

export function ShopBonusPage() {
  const { shopId, shop } = useShopRoute();
  const [searchParams] = useSearchParams();
  const access = useRestrictedAccess();
  const requested = useValidatedMonth(shopId, shop, access.data === true);
  if (!shop) return <NotFoundPage />;
  if (access.isPending) return <PageLoading />;
  if (!access.data) return <BonusAccessGate />;
  if (requested.pending) return <PageLoading />;

  const parsedQuarter = quarterSchema.safeParse(searchParams.get("quarter") ?? undefined);
  const requestedKind = searchParams.get("kind");
  const requestedPeriod = searchParams.get("period");
  const historyDetail = requestedKind === "monthly" && monthSchema.safeParse(requestedPeriod).success
    ? { kind: "monthly" as const, period: requestedPeriod! }
    : requestedKind === "quarterly" && quarterSchema.safeParse(requestedPeriod).success
      ? { kind: "quarterly" as const, period: requestedPeriod! }
      : undefined;

  return (
    <BonusDashboardRoute
      shopId={shopId}
      requestedMonth={requested.month}
      requestedQuarter={parsedQuarter.success ? parsedQuarter.data : undefined}
      historyDetail={historyDetail}
    />
  );
}

export function QuarterlyBonusRedirect() {
  const { locale, shopId } = useParams();
  return <Navigate replace to={`/${locale}/shop/${shopId}/bonus?view=quarterly`} />;
}

export function ShopClosingPage() {
  const { shopId } = useParams();
  const { shops, selectedShop, setSelectedShop } = useShop();
  const t = useTranslations("DetailedDashboard");
  const routeShop = shops.find(item => item.id === shopId);

  useEffect(() => {
    const shop = shops.find(item => item.id === shopId);
    if (shop && selectedShop?.id !== shop.id) setSelectedShop(shop);
  }, [shops, shopId, selectedShop?.id, setSelectedShop]);

  if (selectedShop?.id === shopId) return <DailyClosingClient />;
  return <div className="shop-page-content flex min-h-64 items-center justify-center">{routeShop
    ? <p role="status" className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{t("loading")}</p>
    : <p>{t("shopNotFound")}</p>}
  </div>;
}

export function ShopAttendancePage() {
  const { shopId = "" } = useParams();
  const month = useRequestedMonth();
  return <AttendancePage key={`${shopId}:${month}`} shopId={shopId} initialMonth={month} />;
}

export function ShopDailyActivityPage() {
  const { shopId: requestedShopId } = useParams();
  const month = useRequestedMonth();
  const shopId = shopIdSchema.safeParse(requestedShopId);
  if (!shopId.success) return <NotFoundPage />;
  return <DailyActivityPage key={`${shopId.data}:${month}`} shopId={shopId.data} initialMonth={month} />;
}

export function ShopProceduresPage() {
  const { shopId = "" } = useParams();
  const month = useRequestedMonth();
  const today = tiraneDate();
  return <ProceduresPage key={`${shopId}:${month}`} shopId={shopId} initialMonth={month} initialDate={month === today.slice(0, 7) ? today : `${month}-01`} />;
}

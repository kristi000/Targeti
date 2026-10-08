"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, BadgeDollarSign, CalendarRange, ClipboardCheck, ListChecks, KeyRound, Smartphone, Store, UserMinus, Wallet } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { closingViewHref, getClosingView, type ClosingView } from "@/lib/closing-navigation";
import { RestrictedAccessDialog } from "@/components/restricted-access";
import { useRestrictedAccess } from "@/hooks/use-restricted-access";
import { useShop } from "@/components/shop-provider";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

type Props = { shopId: string; shopName?: string };

export function ShopPageNav({ shopId, shopName }: Props) {
  const locale = useLocale();
  const t = useTranslations("DetailedDashboard");
  const monthly = useTranslations("MonthlyClosing");
  const debts = useTranslations("MonthlyDebts");
  const unsubscribes = useTranslations("MonthlyUnsubscribes");
  const cell = useTranslations("MonthlyCell");
  const attendance = useTranslations("Attendance");
  const procedures = useTranslations("Procedures");
  const restricted = useTranslations("RestrictedAccess");
  const accessQuery = useRestrictedAccess();
  const [isAccessDialogOpen, setIsAccessDialogOpen] = useState(false);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { selectedDatasetId } = useShop();
  const basePath = `/${locale}/shop/${shopId}`;
  const monthQuery = /^\d{4}-\d{2}$/.test(selectedDatasetId) ? `?month=${selectedDatasetId}` : "";
  const closingPath = `${basePath}/closing`;
  const closingView = getClosingView(searchParams.get("view"));
  const items = [
    { path: basePath, href: `${basePath}${monthQuery}`, icon: BarChart3, label: t("performancePage") },
    { path: `${basePath}/bonus`, href: `${basePath}/bonus${monthQuery}`, icon: BadgeDollarSign, label: t("bonusPage") },
    { path: closingPath, href: closingPath, icon: ClipboardCheck, label: t("closingPage") },
    { path: `${basePath}/attendance`, href: `${basePath}/attendance${monthQuery}`, icon: CalendarRange, label: attendance("title") },
    { path: `${basePath}/procedures`, href: `${basePath}/procedures${monthQuery}`, icon: ListChecks, label: procedures("title") },
  ];
  const protectedItems: { view: Exclude<ClosingView, "daily">; icon: typeof CalendarRange; label: string }[] = [
    { view: "monthly", icon: CalendarRange, label: monthly("title") },
    { view: "debts", icon: Wallet, label: debts("title") },
    { view: "unsubscribes", icon: UserMinus, label: unsubscribes("title") },
    { view: "cell", icon: Smartphone, label: cell("tab") },
  ];

  return (
    <SidebarGroup className="px-0 py-2">
      <SidebarGroupLabel className="h-auto px-2 pb-2">
        <span className="flex min-w-0 items-center gap-2 text-sidebar-foreground">
          <Store className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate font-medium" title={shopName ?? t("title")}>{shopName ?? t("title")}</span>
        </span>
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu aria-label={t("shopPageNavigation")}>
          <SidebarMenuItem>
            <SidebarMenuButton asChild tooltip={t("backToOverview")}>
              <Link href={`/${locale}/`}>
                <ArrowLeft />
                <span>{t("backToOverview")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {items.map(item => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton asChild isActive={pathname === item.path && (item.path !== closingPath || closingView === "daily")} tooltip={item.label}>
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          {accessQuery.data === true ? protectedItems.map(item => (
            <SidebarMenuItem key={item.view}>
              <SidebarMenuButton asChild isActive={pathname === closingPath && closingView === item.view} tooltip={item.label}>
                <Link href={closingViewHref(closingPath, item.view)}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )) : accessQuery.isPending ? null : (
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => setIsAccessDialogOpen(true)} tooltip={restricted("unlockReports")}>
                <KeyRound />
                <span>{restricted("unlockReports")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarGroupContent>
      <RestrictedAccessDialog open={isAccessDialogOpen} onOpenChange={setIsAccessDialogOpen} onGranted={() => setIsAccessDialogOpen(false)} />
    </SidebarGroup>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft, BarChart3, BadgeDollarSign, ClipboardCheck, Store } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const basePath = `/${locale}/shop/${shopId}`;
  const items = [
    { href: basePath, icon: BarChart3, label: t("performancePage") },
    { href: `${basePath}/bonus`, icon: BadgeDollarSign, label: t("bonusPage") },
    { href: `${basePath}/closing`, icon: ClipboardCheck, label: t("closingPage") },
  ];

  return (
    <SidebarGroup className="px-0 py-2">
      <SidebarGroupLabel className="h-auto px-2 pb-2">
        <span className="flex min-w-0 items-center gap-2 text-sidebar-foreground">
          <Store className="h-4 w-4 shrink-0 text-primary" />
          <span className="truncate font-medium">{shopName ?? t("title")}</span>
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
              <SidebarMenuButton asChild isActive={pathname === item.href} tooltip={item.label}>
                <Link href={item.href}>
                  <item.icon />
                  <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}


"use client";

import {
  LayoutDashboard,
  Lightbulb,
  TrendingUp,
  Github,
  Languages,
} from "lucide-react";
import Link from "next/link";
import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Button } from "./ui/button";
import { SidebarActions } from "./sidebar-actions";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { usePathname, useRouter } from "next/navigation";
import { ReportingDateSelector } from "@/components/reporting-date-selector";
import { ShopPageNav } from "@/components/shop-page-nav";
import { useShop } from "@/components/shop-provider";


export function SidebarNav() {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const locale = useLocale();
  const router = useRouter();
  const { selectedShop } = useShop();

  const isDetailedDashboard = pathname.includes('/shop/');
  const isDashboard = !isDetailedDashboard;
  const shopId = pathname.match(/\/shop\/([^/]+)/)?.[1];

  const menuItems = [
    {
      href: `/${locale}/`,
      icon: LayoutDashboard,
      label: t('dashboard'),
    },
    {
      href: `/${locale}/insights`,
      icon: Lightbulb,
      label: t('insights'),
    },
  ];

  const handleLocaleChange = (newLocale: string) => {
    const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`);
    router.push(newPathname);
    router.refresh();
  };

  return (
    <>
      <SidebarHeader>
        <Link href={`/${locale}/`} className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
            <TrendingUp className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-lg font-semibold text-foreground no-underline">Target</span>
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2">
        {isDetailedDashboard && shopId ? (
          <ShopPageNav
            shopId={shopId}
            shopName={selectedShop?.id === shopId ? selectedShop.name : undefined}
          />
        ) : (
          <>
          <ReportingDateSelector />
          <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                asChild
                isActive={pathname === item.href || (item.href.endsWith('/') && pathname === `/${locale}`)}
                tooltip={item.label}
              >
                <Link href={item.href}>
                    <item.icon />
                    <span>{item.label}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
          </SidebarMenu>
          </>
        )}
        {(isDetailedDashboard || isDashboard) && (
          <SidebarActions />
        )}
      </SidebarContent>
      <SidebarFooter>
         <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2">
              <Languages />
              <span>{locale === 'en' ? 'English' : 'Shqip'}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => handleLocaleChange('en')}>English</DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleLocaleChange('sq')}>Shqip</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
         <Link href="https://github.com/firebase/studio-examples/tree/main/perf-tracker" target="_blank">
            <Button variant="ghost" className="w-full justify-start gap-2">
                <Github />
                <span>{t('viewOnGithub')}</span>
            </Button>
         </Link>
      </SidebarFooter>
    </>
  );
}

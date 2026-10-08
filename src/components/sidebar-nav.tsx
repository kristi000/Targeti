
"use client";

import {
  LayoutDashboard,
  Banknote,
  Lightbulb,
  Github,
  Languages,
  LogOut,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ReportingDateSelector } from "@/components/reporting-date-selector";
import { ShopPageNav } from "@/components/shop-page-nav";
import { useShop } from "@/components/shop-provider";
import { BrandLogo } from "@/components/brand-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const sidebarSectionsKey = "d-one-sidebar-sections";
const sidebarSectionsSchema = z.array(z.enum(["actions", "settings"])).max(2);

export function SidebarNav() {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const router = useRouter();
  const { selectedShop } = useShop();
  const [expandedSections, setExpandedSections] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(sidebarSectionsKey);
      if (!saved) return;
      const result = sidebarSectionsSchema.safeParse(JSON.parse(saved));
      if (result.success) setExpandedSections([...new Set(result.data)]);
    } catch {
      // Keep sections collapsed when browser storage is unavailable or invalid.
    }
  }, []);

  const handleSectionsChange = (sections: string[]) => {
    setExpandedSections(sections);
    try {
      localStorage.setItem(sidebarSectionsKey, JSON.stringify(sections));
    } catch {
      // Expansion still works when the browser cannot persist preferences.
    }
  };

  const isDetailedDashboard = pathname.includes('/shop/');
  const shopId = pathname.match(/\/shop\/([^/]+)/)?.[1];
  const month = searchParams.get("month");
  const bonusMonthQuery = month && /^\d{4}-\d{2}$/.test(month) ? `?month=${month}` : "";

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
    {
      href: `/${locale}/bonuses${bonusMonthQuery}`,
      icon: Banknote,
      label: t('bonuses'),
    },
  ];

  const handleLocaleChange = (newLocale: string) => {
    const newPathname = pathname.replace(`/${locale}`, `/${newLocale}`);
    router.push(newPathname);
    router.refresh();
  };

  const handleLogout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <>
      <SidebarHeader>
        <Link href={`/${locale}/`} className="flex items-center gap-2.5">
          <BrandLogo />
        </Link>
      </SidebarHeader>
      <SidebarContent className="px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                isActive={pathname === item.href.split("?")[0] || (item.href.endsWith('/') && pathname === `/${locale}`)}
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
        <Accordion type="multiple" value={expandedSections} onValueChange={handleSectionsChange} aria-label={t("sidebarControls")} className="mt-2 min-w-0 space-y-2 border-t border-sidebar-border pt-3">
          <AccordionItem value="actions" className="border-0">
            <AccordionTrigger title={t("shopActions")} className="gap-1 rounded-md bg-sidebar-accent px-2 py-2.5 text-left text-xs text-sidebar-accent-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">{t("shopActions")}</AccordionTrigger>
            <AccordionContent className="pb-1 pt-1">
            <SidebarActions />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="settings" className="border-0">
            <AccordionTrigger title={t("settings")} className="gap-1 rounded-md bg-sidebar-accent px-2 py-2.5 text-left text-xs text-sidebar-accent-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">{t("settings")}</AccordionTrigger>
            <AccordionContent className="space-y-1 pb-1 pt-1 [&_button]:min-w-0 [&_button]:overflow-hidden [&_button>svg]:shrink-0 [&_button>span]:truncate">
         <ThemeToggle lightLabel={t("lightTheme")} darkLabel={t("darkTheme")} showLabel />
         <Button
           type="button"
           title={t('logOut')}
           variant="ghost"
           className="w-full justify-start gap-2 text-destructive hover:text-destructive"
           onClick={() => void handleLogout()}
         >
           <LogOut />
           <span>{t('logOut')}</span>
         </Button>
         <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full justify-start gap-2" title={locale === 'en' ? 'English' : 'Shqip'}>
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
            <Button variant="ghost" className="w-full justify-start gap-2" title={t('viewOnGithub')}>
                <Github />
                <span>{t('viewOnGithub')}</span>
            </Button>
         </Link>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </SidebarContent>
    </>
  );
}

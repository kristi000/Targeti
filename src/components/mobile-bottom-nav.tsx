import { Menu } from "lucide-react";
import { useTranslations } from "use-intl";

import Link from "@/lib/navigation";
import { ManagerBottomNav, navCircleClass, navPillActiveClass } from "@/components/manager/manager-bottom-nav";
import { useShop } from "@/components/shop-provider";
import { useMainNavItems } from "@/components/sidebar-nav";
import { useManagerModeEnabled } from "@/lib/manager-mode";
import { useSidebar } from "@/components/ui/sidebar";

/**
 * Phone-only navigation docked to the bottom of the screen. The main pages are one tap away;
 * "Menu" opens the sidebar drawer for the month picker, shop pages, actions and settings.
 * In manager mode the administrator sees the manager app's tabs instead, on every page.
 */
export function MobileBottomNav() {
  const { isAdmin } = useShop();
  const managerMode = useManagerModeEnabled(isAdmin);
  return managerMode ? <ManagerBottomNav className="md:hidden" /> : <MainBottomNav />;
}

function MainBottomNav() {
  const t = useTranslations("Sidebar");
  const items = useMainNavItems();
  const { openMobile, setOpenMobile } = useSidebar();

  return (
    <nav
      aria-label={t("navigationTitle")}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-3 md:hidden"
    >
      <div className="pointer-events-auto flex max-w-full items-center gap-1.5">
        {items.map(item => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={item.isActive ? "page" : undefined}
            aria-label={item.isActive ? undefined : item.label}
            className={item.isActive ? navPillActiveClass : navCircleClass}
          >
            <item.icon aria-hidden="true" />
            {item.isActive && <><span className="truncate">{item.label}</span><span aria-hidden="true" className="h-1 w-1 shrink-0 rounded-full bg-background" /></>}
          </Link>
        ))}
        <button type="button" aria-label={t("menu")} aria-expanded={openMobile} aria-haspopup="dialog" onClick={() => setOpenMobile(true)} className={navCircleClass}>
          <Menu aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

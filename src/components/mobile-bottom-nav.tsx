import { Menu } from "lucide-react";
import { useTranslations } from "use-intl";

import Link from "@/lib/navigation";
import { useMainNavItems } from "@/components/sidebar-nav";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/**
 * Phone-only navigation docked to the bottom of the screen. The main pages are one tap away;
 * "Menu" opens the sidebar drawer for the month picker, shop pages, actions and settings.
 */
export function MobileBottomNav() {
  const t = useTranslations("Sidebar");
  const items = useMainNavItems();
  const { openMobile, setOpenMobile } = useSidebar();

  const itemClass = "group flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary active:scale-[0.97] glass-press";
  const iconClass = "flex h-7 w-12 items-center justify-center rounded-full transition-colors [&_svg]:h-5 [&_svg]:w-5";

  return (
    <nav
      aria-label={t("navigationTitle")}
      className="glass-strong fixed inset-x-0 bottom-0 z-40 rounded-none border-x-0 border-b-0 pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <div className="flex h-16 items-stretch gap-1 px-2 py-1.5">
        {items.map(item => (
          <Link key={item.href} href={item.href} aria-current={item.isActive ? "page" : undefined} className={cn(itemClass, item.isActive && "text-primary")}>
            <span className={cn(iconClass, item.isActive && "bg-primary/10 text-primary")}><item.icon aria-hidden="true" /></span>
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        ))}
        <button type="button" aria-expanded={openMobile} aria-haspopup="dialog" onClick={() => setOpenMobile(true)} className={cn(itemClass, openMobile && "text-primary")}>
          <span className={cn(iconClass, openMobile && "bg-primary/10 text-primary")}><Menu aria-hidden="true" /></span>
          <span>{t("menu")}</span>
        </button>
      </div>
    </nav>
  );
}

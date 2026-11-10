import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation, useParams } from "react-router";
import { IntlProvider, type AbstractIntlMessages } from "use-intl";

import { AppLayout, AppShellFallback } from "@/components/app-layout";
import { DashboardNavigationProvider } from "@/components/dashboard-navigation-provider";
import { NotFoundPage, PageError } from "@/components/page-status";
import { PerformanceVitals } from "@/components/performance-vitals";
import { QueryProvider } from "@/components/query-provider";
import { ShopProvider } from "@/components/shop-provider";
import type { AppBootstrap } from "@/lib/app-bootstrap";
import { bootstrapQueryKey } from "@/lib/query-keys";

const locales = ["en", "sq"] as const;
type Locale = (typeof locales)[number];

const messageLoaders: Record<Locale, () => Promise<{ default: AbstractIntlMessages }>> = {
  en: () => import("../../messages/en.json"),
  sq: () => import("../../messages/sq.json"),
};

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

class UnauthenticatedError extends Error {
  constructor() { super("UNAUTHENTICATED"); }
}

async function fetchBootstrap(): Promise<AppBootstrap> {
  const response = await fetch("/api/bootstrap", { credentials: "same-origin" });
  if (response.status === 401) throw new UnauthenticatedError();
  if (!response.ok) throw new Error(`Could not load the application (${response.status}).`);
  return response.json() as Promise<AppBootstrap>;
}

function isLocale(value: string | undefined): value is Locale {
  return locales.includes(value as Locale);
}

export function LocaleLayout() {
  const { locale } = useParams();
  if (!isLocale(locale)) return <NotFoundPage />;
  return <LocaleApplication locale={locale} />;
}

function LocaleApplication({ locale }: { locale: Locale }) {
  const location = useLocation();
  const messagesQuery = useQuery({
    queryKey: ["messages", locale],
    queryFn: () => messageLoaders[locale]().then(module => module.default),
    staleTime: Infinity,
    gcTime: Infinity,
  });
  // Loaded once per visit like the server layout; router.refresh() refetches it.
  // gcTime 0 drops it after sign-out so the next user never sees it.
  const bootstrapQuery = useQuery({
    queryKey: bootstrapQueryKey,
    queryFn: fetchBootstrap,
    staleTime: Infinity,
    gcTime: 0,
    retry: (failureCount, error) => !(error instanceof UnauthenticatedError) && failureCount < 2,
  });

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  if (bootstrapQuery.error instanceof UnauthenticatedError) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate replace to={`/login?next=${encodeURIComponent(next)}`} />;
  }

  const messages = messagesQuery.data;
  if (!messages) {
    return messagesQuery.isError
      ? <main className="flex min-h-svh items-center justify-center p-4 text-sm text-destructive">Could not load the application. Reload the page to try again.</main>
      : <main className="flex min-h-svh items-center justify-center"><Loader2 role="status" aria-label="Loading" className="h-6 w-6 animate-spin" /></main>;
  }

  const bootstrap = bootstrapQuery.data;
  return (
    <IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
      {bootstrap
        ? <AuthenticatedApplication bootstrap={bootstrap} locale={locale} />
        : bootstrapQuery.isError
          ? <main className="flex min-h-svh"><PageError onRetry={() => void bootstrapQuery.refetch()} /></main>
          : <AppShellFallback />}
    </IntlProvider>
  );
}

function AuthenticatedApplication({ bootstrap, locale }: { bootstrap: AppBootstrap; locale: Locale }) {
  const { actor, directory } = bootstrap;
  // A different user, role, shop list, or language gets a fresh client cache.
  const clientScope = JSON.stringify([actor.id, actor.role, [...actor.shopIds].sort(), locale]);

  return (
    <QueryProvider key={clientScope}>
      {bootstrap.performanceMetricsEnabled && <PerformanceVitals />}
      <ShopProvider initialData={directory} actor={actor}>
        <DashboardNavigationProvider locale={locale}>
          <AppLayout><Outlet /></AppLayout>
        </DashboardNavigationProvider>
      </ShopProvider>
    </QueryProvider>
  );
}

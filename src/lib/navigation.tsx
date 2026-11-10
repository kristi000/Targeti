import { forwardRef, useMemo, useSyncExternalStore, type AnchorHTMLAttributes } from "react";
import { Link as RouterLink, useLocation, useNavigate, useParams as useRouterParams } from "react-router";

import { refreshAppData } from "@/lib/app-refresh";

/*
 * Small Next.js-style navigation API on top of React Router, so components keep
 * using `useRouter`, `usePathname`, `useSearchParams`, and `<Link href>`.
 */

// URL changes made with `replaceUrl` skip the router (no route re-render), but
// `usePathname`/`useSearchParams` still see them, matching Next.js behavior for
// `window.history.replaceState`.
const urlListeners = new Set<() => void>();
let urlVersion = 0;

function subscribeToUrl(listener: () => void) {
  urlListeners.add(listener);
  return () => { urlListeners.delete(listener); };
}

/** Rewrites the current URL in place without a route navigation. */
export function replaceUrl(href: string | URL) {
  window.history.replaceState(window.history.state, "", href);
  urlVersion += 1;
  urlListeners.forEach(listener => listener());
}

function useCurrentUrl() {
  const location = useLocation();
  const version = useSyncExternalStore(subscribeToUrl, () => urlVersion);
  // Read the live URL so replaceUrl changes are included.
  const { pathname, search } = window.location;
  return useMemo(() => ({ pathname, search }), [pathname, search, location.key, version]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function usePathname() {
  return useCurrentUrl().pathname;
}

export function useSearchParams(): URLSearchParams {
  const { search } = useCurrentUrl();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useParams<T extends Record<string, string>>(): T {
  return useRouterParams() as T;
}

type NavigateOptions = { scroll?: boolean };

export function useRouter() {
  const navigate = useNavigate();
  return useMemo(() => ({
    push: (href: string, options?: NavigateOptions) => { void navigate(href, { preventScrollReset: options?.scroll === false }); },
    replace: (href: string, options?: NavigateOptions) => { void navigate(href, { replace: true, preventScrollReset: options?.scroll === false }); },
    back: () => { void navigate(-1); },
    forward: () => { void navigate(1); },
    /** Refetches server data for the current page. */
    refresh: () => refreshAppData(),
    prefetch: (href: string) => { void href; },
  }), [navigate]);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
};

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ href, replace, scroll, prefetch, ...props }, ref) {
  void prefetch;
  return <RouterLink ref={ref} to={href} replace={replace} preventScrollReset={scroll === false} {...props} />;
});

export default Link;

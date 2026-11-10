import { Loader2 } from "lucide-react";
import { useTranslations } from "use-intl";

import { Button } from "@/components/ui/button";

/** Spinner shown while a page loads the data it needs to pick its view. */
export function PageLoading() {
  return (
    <div className="flex min-h-64 flex-1 items-center justify-center">
      <Loader2 role="status" aria-label="Loading" className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function PageError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations();
  return (
    <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3">
      <p role="alert" className="text-sm text-destructive">{t("Toasts.error")}</p>
      <Button variant="outline" onClick={onRetry}>{t("Dashboard.retry")}</Button>
    </div>
  );
}

/** Same message as the default Next.js 404 page. */
export function NotFoundPage() {
  return (
    <main className="flex min-h-64 flex-1 items-center justify-center p-6 text-center">
      <p className="text-sm text-muted-foreground">
        <span className="mr-3 border-r pr-3 text-2xl font-medium text-foreground">404</span>
        This page could not be found.
      </p>
    </main>
  );
}

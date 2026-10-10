"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { fetchImportHistoryPage, handleRemoveImport, handleSupersedeImport } from "@/app/actions/imports";
import type { ImportHistoryItem } from "@/lib/import-history";
import { dashboardPeriodsQueryKey } from "@/lib/query-keys";
import { useShop } from "@/components/shop-provider";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type ImportCursor = { createdAt: string; id: string };
type ImportAction = { kind: "remove" | "supersede"; item: ImportHistoryItem };

const statusPresentation: Record<ImportHistoryItem["status"], string> = {
  active: "bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200",
  superseded: "bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200",
  undone: "bg-muted text-muted-foreground",
  removed: "bg-muted text-muted-foreground",
};

const legacyRemovalErrors: Record<string, string> = {
  "This import has already been removed or no longer exists.": "NOT_ACTIVE",
  "This file is current for only some affected shops. Remove newer overlapping imports first.": "partiallyCurrent",
  "This import cannot be removed because one or more affected shops were edited afterward.": "changedAfterImport",
  "Your session has expired. Please sign in again.": "UNAUTHENTICATED",
  "Administrator permission is required for this action.": "ADMIN_REQUIRED",
  "Editor permission is required for this action.": "EDITOR_REQUIRED",
  "You do not have access to this shop.": "SHOP_ACCESS_REQUIRED",
};

export function ManageImportsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("ImportHistory");
  const locale = useLocale();
  const { reloadData } = useShop();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pageIndex, setPageIndex] = useState(0);
  const [cursor, setCursor] = useState<ImportCursor | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<ImportCursor | undefined>>([undefined]);
  const [selectedAction, setSelectedAction] = useState<ImportAction | null>(null);
  const [pending, setPending] = useState(false);
  const mutationPending = useRef(false);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  const closeButton = useRef<HTMLButtonElement | null>(null);

  const historyQuery = useQuery({
    queryKey: ["import-history", cursor],
    queryFn: () => fetchImportHistoryPage(cursor),
    enabled: open,
  });

  const handleDialogChange = (nextOpen: boolean) => {
    if (mutationPending.current) return;
    if (!nextOpen) {
      setPageIndex(0);
      setCursor(undefined);
      setCursorHistory([undefined]);
      setSelectedAction(null);
    }
    onOpenChange(nextOpen);
  };

  const goToNextPage = () => {
    if (mutationPending.current) return;
    const nextCursor = historyQuery.data?.nextCursor ?? undefined;
    if (!nextCursor) return;
    const nextPage = pageIndex + 1;
    setCursorHistory(current => {
      const next = [...current];
      next[nextPage] = nextCursor;
      return next;
    });
    setCursor(nextCursor);
    setPageIndex(nextPage);
  };

  const goToPreviousPage = () => {
    if (mutationPending.current) return;
    if (!pageIndex) return;
    const previousPage = pageIndex - 1;
    setCursor(cursorHistory[previousPage]);
    setPageIndex(previousPage);
  };

  const selectImportAction = (action: ImportAction, trigger: HTMLButtonElement) => {
    if (mutationPending.current) return;
    confirmationTrigger.current = trigger;
    setSelectedAction(action);
  };

  const confirmSelectedAction = async () => {
    if (!selectedAction || mutationPending.current) return;
    const { kind, item } = selectedAction;
    mutationPending.current = true;
    setPending(true);
    try {
      const result = kind === "supersede"
        ? await handleSupersedeImport(item.id)
        : await handleRemoveImport(item.id);
      if (!result.success) {
        const code = kind === "remove" ? legacyRemovalErrors[result.error] ?? result.error : result.error;
        const errorKey = `errors.${code}`;
        toast({
          variant: "destructive",
          title: t(kind === "supersede" ? "supersedeFailedTitle" : "removeFailedTitle"),
          description: t(t.has(errorKey) ? errorKey : `errors.${kind}Failed`),
        });
        return;
      }
      await Promise.all([
        ...(kind === "remove" ? [reloadData()] : []),
        queryClient.invalidateQueries({ queryKey: ["import-history"] }),
        queryClient.invalidateQueries({ queryKey: ["activity-history"] }),
        queryClient.invalidateQueries({ queryKey: dashboardPeriodsQueryKey }),
      ]);
      toast({ title: t(`${kind}SuccessTitle`), description: t(`${kind}SuccessDescription`, { fileName: result.fileName }) });
      setSelectedAction(null);
      if (kind === "remove") {
        setPageIndex(0);
        setCursor(undefined);
        setCursorHistory([undefined]);
      }
    } catch {
      toast({ variant: "destructive", title: t(`${kind}FailedTitle`), description: t(`errors.${kind}Failed`) });
    } finally {
      mutationPending.current = false;
      setPending(false);
    }
  };

  const imports = historyQuery.data?.imports ?? [];

  return <>
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl [&>button]:hidden">
        <div className="absolute right-3 top-3">
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={pending} onClick={() => handleDialogChange(false)} aria-label={t("close")} title={t("close")}><X className="h-4 w-4" /></Button>
        </div>
        <DialogHeader className="shrink-0 border-b bg-muted/40 px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-emerald-700 p-2 text-white"><FileSpreadsheet className="h-5 w-5" /></span>
            <div><DialogTitle>{t("title")}</DialogTitle><DialogDescription>{t("description")}</DialogDescription></div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          {historyQuery.isLoading ? <div className="flex h-80 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />{t("loading")}</div>
            : historyQuery.isError ? <div className="flex h-80 items-center justify-center text-sm text-destructive">{t("loadFailed")}</div>
            : imports.length ? <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted text-xs font-semibold uppercase tracking-wide text-foreground"><tr>
                <th className="border-b border-r border-border px-3 py-2 text-left">{t("columns.file")}</th>
                <th className="w-28 border-b border-r border-border px-3 py-2 text-left">{t("columns.month")}</th>
                <th className="w-44 border-b border-r border-border px-3 py-2 text-left">{t("columns.imported")}</th>
                <th className="w-40 border-b border-r border-border px-3 py-2 text-left">{t("columns.importedBy")}</th>
                <th className="w-24 border-b border-r border-border px-3 py-2 text-right">{t("columns.shops")}</th>
                <th className="w-36 border-b border-r border-border px-3 py-2 text-center">{t("columns.status")}</th>
                <th className="w-28 border-b border-border px-3 py-2 text-right">{t("columns.actions")}</th>
              </tr></thead>
              <tbody>{imports.map(item => <tr key={item.id} className="bg-background even:bg-muted/40 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/40">
                <th scope="row" className="max-w-xs truncate border-b border-r border-border px-3 py-3 text-left font-medium" title={item.fileName}>{item.fileName}</th>
                <td className="border-b border-r border-border px-3 py-3 tabular-nums">{item.month}</td>
                <td className="border-b border-r border-border px-3 py-3 text-muted-foreground">{formatDate(item.createdAt, locale)}</td>
                <td className="border-b border-r border-border px-3 py-3 text-muted-foreground">{item.actorName}</td>
                <td className="border-b border-r border-border px-3 py-3 text-right tabular-nums">{item.recordCount}</td>
                <td className="border-b border-r border-border px-3 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", statusPresentation[item.status])}>{t(`statuses.${item.status}`)}</span>
                    {item.status === "active" && <Button type="button" variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-amber-700 dark:hover:text-amber-300" disabled={pending} onClick={event => selectImportAction({ kind: "supersede", item }, event.currentTarget)} aria-label={t("supersedeFile", { fileName: item.fileName })} title={t("supersedeFile", { fileName: item.fileName })}><Archive className="h-3.5 w-3.5" /></Button>}
                  </div>
                </td>
                <td className="border-b border-border px-3 py-2 text-right"><Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={item.status !== "active" || pending} onClick={event => selectImportAction({ kind: "remove", item }, event.currentTarget)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />{t("remove")}</Button></td>
              </tr>)}</tbody>
            </table>
              : <div className="flex h-80 flex-col items-center justify-center gap-2 text-center text-muted-foreground"><FileSpreadsheet className="h-9 w-9 text-muted-foreground" /><p className="font-medium">{t("empty")}</p><p className="text-sm">{t("emptyDescription")}</p></div>}
        </div>

        <DialogFooter className="shrink-0 flex-row items-center justify-between border-t bg-muted/40 px-5 py-4 sm:justify-between sm:px-6">
          <div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" disabled={!pageIndex || historyQuery.isFetching || pending} onClick={goToPreviousPage} aria-label={t("previousPage")}><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm text-muted-foreground">{t("page", { number: pageIndex + 1 })}</span><Button type="button" variant="outline" size="icon" disabled={!historyQuery.data?.nextCursor || historyQuery.isFetching || pending} onClick={goToNextPage} aria-label={t("nextPage")}><ChevronRight className="h-4 w-4" /></Button></div>
          <Button ref={closeButton} type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={pending}>{t("close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(selectedAction)} onOpenChange={nextOpen => { if (!nextOpen && !mutationPending.current) setSelectedAction(null); }}>
      <AlertDialogContent onCloseAutoFocus={event => {
        event.preventDefault();
        if (!open) return;
        const trigger = confirmationTrigger.current;
        if (trigger?.isConnected && !trigger.disabled) trigger.focus();
        else closeButton.current?.focus();
      }}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(selectedAction?.kind === "supersede" ? "supersedeTitle" : "removeTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t(selectedAction?.kind === "supersede" ? "supersedeDescription" : "removeDescription", { fileName: selectedAction?.item.fileName ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("cancel")}</AlertDialogCancel>
          <AlertDialogAction className={selectedAction?.kind === "remove" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} disabled={pending} onClick={event => { event.preventDefault(); void confirmSelectedAction(); }}>
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : selectedAction?.kind === "supersede" ? <Archive className="mr-2 h-4 w-4" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {t(selectedAction?.kind === "supersede" ? "supersede" : "removeImport")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

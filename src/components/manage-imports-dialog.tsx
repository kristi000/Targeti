"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileSpreadsheet, Loader2, Trash2 } from "lucide-react";

import { fetchImportHistoryPage, handleRemoveImport, type ImportHistoryItem } from "@/app/actions";
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

export function ManageImportsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { reloadData } = useShop();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pageIndex, setPageIndex] = useState(0);
  const [cursor, setCursor] = useState<ImportCursor | undefined>();
  const [cursorHistory, setCursorHistory] = useState<Array<ImportCursor | undefined>>([undefined]);
  const [selectedImport, setSelectedImport] = useState<ImportHistoryItem | null>(null);
  const [removing, setRemoving] = useState(false);

  const historyQuery = useQuery({
    queryKey: ["import-history", cursor],
    queryFn: () => fetchImportHistoryPage(cursor),
    enabled: open,
  });

  const handleDialogChange = (nextOpen: boolean) => {
    if (!nextOpen && !removing) {
      setPageIndex(0);
      setCursor(undefined);
      setCursorHistory([undefined]);
      setSelectedImport(null);
    }
    onOpenChange(nextOpen);
  };

  const goToNextPage = () => {
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
    if (!pageIndex) return;
    const previousPage = pageIndex - 1;
    setCursor(cursorHistory[previousPage]);
    setPageIndex(previousPage);
  };

  const removeSelectedImport = async () => {
    if (!selectedImport) return;
    setRemoving(true);
    try {
      const result = await handleRemoveImport(selectedImport.id);
      if (!result.success) throw new Error(result.error);
      await Promise.all([
        reloadData(),
        queryClient.invalidateQueries({ queryKey: ["import-history"] }),
      ]);
      toast({ title: "Excel import removed", description: `${result.fileName} was removed safely.` });
      setSelectedImport(null);
      setPageIndex(0);
      setCursor(undefined);
      setCursorHistory([undefined]);
    } catch (error) {
      toast({ variant: "destructive", title: "Could not remove import", description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setRemoving(false);
    }
  };

  const imports = historyQuery.data?.imports ?? [];

  return <>
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-emerald-700 p-2 text-white"><FileSpreadsheet className="h-5 w-5" /></span>
            <div><DialogTitle>Manage imported Excel files</DialogTitle><DialogDescription>“Imported” means the file is still stored. It may be the current dashboard version or an older saved version.</DialogDescription></div>
          </div>
        </DialogHeader>

        <div className="min-h-[360px] overflow-auto">
          {historyQuery.isLoading ? <div className="flex h-80 items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading imports…</div>
            : historyQuery.isError ? <div className="flex h-80 items-center justify-center text-sm text-destructive">Import history could not be loaded.</div>
            : imports.length ? <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-700"><tr>
                <th className="border-b border-r border-slate-300 px-3 py-2 text-left">File</th>
                <th className="w-28 border-b border-r border-slate-300 px-3 py-2 text-left">Month</th>
                <th className="w-44 border-b border-r border-slate-300 px-3 py-2 text-left">Imported</th>
                <th className="w-40 border-b border-r border-slate-300 px-3 py-2 text-left">Imported by</th>
                <th className="w-24 border-b border-r border-slate-300 px-3 py-2 text-right">Shops</th>
                <th className="w-28 border-b border-r border-slate-300 px-3 py-2 text-center">Status</th>
                <th className="w-28 border-b border-slate-300 px-3 py-2 text-right">Actions</th>
              </tr></thead>
              <tbody>{imports.map(item => <tr key={item.id} className="bg-white even:bg-slate-50/70 hover:bg-emerald-50/70">
                <th scope="row" className="max-w-xs truncate border-b border-r border-slate-200 px-3 py-3 text-left font-medium" title={item.fileName}>{item.fileName}</th>
                <td className="border-b border-r border-slate-200 px-3 py-3 tabular-nums">{item.month}</td>
                <td className="border-b border-r border-slate-200 px-3 py-3 text-muted-foreground">{formatDate(item.createdAt)}</td>
                <td className="border-b border-r border-slate-200 px-3 py-3 text-muted-foreground">{item.actorName}</td>
                <td className="border-b border-r border-slate-200 px-3 py-3 text-right tabular-nums">{item.recordCount}</td>
                <td className="border-b border-r border-slate-200 px-3 py-3 text-center"><span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", item.status === "active" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-600")}>{item.status === "active" ? "Imported" : "Removed"}</span></td>
                <td className="border-b border-slate-200 px-3 py-2 text-right"><Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={item.status !== "active" || removing} onClick={() => setSelectedImport(item)}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove</Button></td>
              </tr>)}</tbody>
            </table>
              : <div className="flex h-80 flex-col items-center justify-center gap-2 text-center text-muted-foreground"><FileSpreadsheet className="h-9 w-9 text-slate-300" /><p className="font-medium">No imported Excel files</p><p className="text-sm">Completed imports will appear here.</p></div>}
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t bg-slate-50 px-5 py-4 sm:justify-between sm:px-6">
          <div className="flex items-center gap-2"><Button type="button" variant="outline" size="icon" disabled={!pageIndex || historyQuery.isFetching} onClick={goToPreviousPage} aria-label="Previous imports page"><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm text-muted-foreground">Page {pageIndex + 1}</span><Button type="button" variant="outline" size="icon" disabled={!historyQuery.data?.nextCursor || historyQuery.isFetching} onClick={goToNextPage} aria-label="Next imports page"><ChevronRight className="h-4 w-4" /></Button></div>
          <Button type="button" variant="outline" onClick={() => handleDialogChange(false)} disabled={removing}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={Boolean(selectedImport)} onOpenChange={nextOpen => { if (!nextOpen && !removing) setSelectedImport(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>Remove this Excel import?</AlertDialogTitle><AlertDialogDescription>{selectedImport?.fileName} and its imported performance records will be removed. If it is the current version for the affected shops, their previous shop data will be restored. If it is an older version, current dashboard data will not change. Removal is blocked when it could overwrite later shop edits.</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={removing} onClick={event => { event.preventDefault(); void removeSelectedImport(); }}>{removing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}Remove import</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

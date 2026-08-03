"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertCircle, History, Loader2, MapPin } from "lucide-react";

import { fetchActivityPage } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Cursor = { occurredAt: string; id: string };

type ActivityHistoryDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

export function ActivityHistoryDialog({ open, onOpenChange, showTrigger = true }: ActivityHistoryDialogProps = {}) {
  const historyQuery = useInfiniteQuery({
    queryKey: ["activity-history"],
    queryFn: ({ pageParam }) => fetchActivityPage(pageParam),
    initialPageParam: undefined as Cursor | undefined,
    getNextPageParam: lastPage => lastPage.nextCursor ?? undefined,
    enabled: open !== false,
  });
  const events = historyQuery.data?.pages.flatMap(page => page.events) ?? [];

  return <Dialog open={open} onOpenChange={onOpenChange}>
    {showTrigger && <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><History className="mr-2 h-4 w-4" />Activity</Button></DialogTrigger>}
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Activity history</DialogTitle><DialogDescription>Daily closings, imports, target changes, shop edits, and administrative deletions.</DialogDescription></DialogHeader>
      <div className="divide-y rounded-md border">
        {events.map(event => <article key={event.id} className="space-y-1 p-3">
          <div className="flex items-start justify-between gap-4"><p className="font-medium">{event.summary}</p><time className="shrink-0 text-xs text-muted-foreground" dateTime={event.occurredAt}>{formatDate(event.occurredAt)}</time></div>
          <p className="text-sm text-muted-foreground">{event.actor.name} · {event.actor.username ? `@${event.actor.username}` : event.actor.email}</p>
          {event.shopNames.length > 0 && <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{event.shopNames.join(", ")}</p>}
        </article>)}
        {historyQuery.isPending && <div className="flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Loading activity…</div>}
        {historyQuery.isError && <div className="flex flex-col items-center justify-center gap-3 p-8 text-center text-sm text-destructive"><AlertCircle className="h-5 w-5" /><p>Activity history could not be loaded.</p><Button type="button" variant="outline" size="sm" onClick={() => void historyQuery.refetch()}>Try again</Button></div>}
        {historyQuery.isSuccess && !events.length && <p className="p-8 text-center text-sm text-muted-foreground">No activity has been recorded yet.</p>}
      </div>
      {historyQuery.isFetchingNextPage && <div className="flex justify-center p-3"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {historyQuery.hasNextPage && !historyQuery.isFetchingNextPage && <Button type="button" variant="outline" onClick={() => void historyQuery.fetchNextPage()}>Load older activity</Button>}
    </DialogContent>
  </Dialog>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

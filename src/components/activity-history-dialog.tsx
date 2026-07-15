"use client";

import { useState } from "react";
import { History, Loader2, MapPin } from "lucide-react";
import { fetchActivityPage } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { ActivityEvent } from "@/lib/types";

type Cursor = { occurredAt: string; id: string };

export function ActivityHistoryDialog() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async (next?: Cursor) => {
    setLoading(true);
    try {
      const page = await fetchActivityPage(next);
      setEvents(current => next ? [...current, ...page.events] : page.events);
      setCursor(page.nextCursor);
    } finally {
      setLoading(false);
    }
  };

  return <Dialog onOpenChange={open => { if (open && !events.length) void load(); }}>
    <DialogTrigger asChild><Button type="button" variant="outline" size="sm"><History className="mr-2 h-4 w-4" />Activity</Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Activity history</DialogTitle><DialogDescription>Imports, target changes, shop edits, and administrative deletions.</DialogDescription></DialogHeader>
      <div className="divide-y rounded-md border">
        {events.map(event => <article key={event.id} className="space-y-1 p-3">
          <div className="flex items-start justify-between gap-4"><p className="font-medium">{event.summary}</p><time className="shrink-0 text-xs text-muted-foreground" dateTime={event.occurredAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.occurredAt))}</time></div>
          <p className="text-sm text-muted-foreground">{event.actor.name} · {event.actor.email}</p>
          {event.shopNames.length > 0 && <p className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="h-3.5 w-3.5" />{event.shopNames.join(", ")}</p>}
        </article>)}
        {!loading && !events.length && <p className="p-8 text-center text-sm text-muted-foreground">No activity has been recorded yet.</p>}
      </div>
      {loading && <div className="flex justify-center p-3"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {cursor && !loading && <Button type="button" variant="outline" onClick={() => void load(cursor)}>Load older activity</Button>}
    </DialogContent>
  </Dialog>;
}

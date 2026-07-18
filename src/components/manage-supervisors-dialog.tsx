"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Pencil, Plus, Save, Search, Store, Trash2, UserRoundCog } from "lucide-react";

import { handleAddSupervisor, handleAssignSupervisor, handleDeleteSupervisor, handleUpdateSupervisor } from "@/app/actions";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import type { Supervisor } from "@/lib/types";
import { useShop } from "./shop-provider";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const normalize = (value: string) => value.trim().toLocaleLowerCase();

export function ManageSupervisorsDialog({ open, onOpenChange }: Props) {
  const { supervisors, shops, refreshShopDirectory } = useShop();
  const { toast } = useToast();
  const [newName, setNewName] = useState("");
  const [selectedSupervisor, setSelectedSupervisor] = useState<Supervisor | null>(null);
  const [draftName, setDraftName] = useState("");
  const [selectedShopIds, setSelectedShopIds] = useState<string[]>([]);
  const [shopQuery, setShopQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const duplicateNewName = supervisors.some(supervisor => normalize(supervisor.name) === normalize(newName));
  const duplicateDraftName = selectedSupervisor
    ? supervisors.some(supervisor => supervisor.id !== selectedSupervisor.id && normalize(supervisor.name) === normalize(draftName))
    : false;
  const filteredShops = useMemo(() => [...shops]
    .filter(shop => !normalize(shopQuery) || normalize(shop.name).includes(normalize(shopQuery)))
    .sort((left, right) => left.name.localeCompare(right.name)), [shopQuery, shops]);

  const close = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedSupervisor(null);
      setNewName("");
      setShopQuery("");
    }
    onOpenChange(nextOpen);
  };

  const openSupervisor = (supervisor: Supervisor) => {
    setSelectedSupervisor(supervisor);
    setDraftName(supervisor.name);
    setSelectedShopIds(shops.filter(shop => shop.supervisorId === supervisor.id).map(shop => shop.id));
    setShopQuery("");
  };

  const createSupervisor = async () => {
    if (!newName.trim() || duplicateNewName) return;
    setSaving(true);
    try {
      const result = await handleAddSupervisor(newName.trim());
      if (!result.success) throw new Error(result.error);
      await refreshShopDirectory();
      setNewName("");
      toast({ title: "Supervisor created", description: `${result.data.name} is ready for shop assignments.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not create supervisor", description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const saveSupervisor = async () => {
    if (!selectedSupervisor || !draftName.trim() || duplicateDraftName) return;
    setSaving(true);
    try {
      const updated = await handleUpdateSupervisor({ ...selectedSupervisor, name: draftName.trim() });
      if (!updated.success) throw new Error(updated.error);
      const assigned = await handleAssignSupervisor(selectedSupervisor.id, selectedShopIds);
      if (!assigned.success) throw new Error(assigned.error);
      await refreshShopDirectory();
      setSelectedSupervisor(null);
      toast({ title: "Supervisor updated", description: `${updated.data.name} now manages ${assigned.count} shop${assigned.count === 1 ? "" : "s"}.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not update supervisor", description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  const deleteSupervisor = async (supervisor: Supervisor) => {
    setSaving(true);
    try {
      const result = await handleDeleteSupervisor(supervisor.id);
      if (!result.success) throw new Error(result.error);
      await refreshShopDirectory();
      if (selectedSupervisor?.id === supervisor.id) setSelectedSupervisor(null);
      toast({ title: "Supervisor deleted", description: `${supervisor.name}'s shops are now unassigned.` });
    } catch (error) {
      toast({ variant: "destructive", title: "Could not delete supervisor", description: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setSaving(false);
    }
  };

  return <Dialog open={open} onOpenChange={close}>
    <DialogContent className="max-h-[92vh] max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0 sm:max-w-2xl">
      {selectedSupervisor ? <>
        <DialogHeader className="border-b bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" size="icon" aria-label="Back to supervisors" onClick={() => setSelectedSupervisor(null)}><ArrowLeft className="h-4 w-4" /></Button>
            <div><DialogTitle>Edit {selectedSupervisor.name}</DialogTitle><DialogDescription className="mt-1">Rename the supervisor and select all shops they manage.</DialogDescription></div>
          </div>
        </DialogHeader>
        <ScrollArea className="h-[min(68vh,560px)]">
          <div className="space-y-5 p-5 sm:p-6">
            <Label className="grid gap-1.5">Supervisor name<Input value={draftName} onChange={event => setDraftName(event.target.value)} autoFocus /></Label>
            {duplicateDraftName && <p className="text-xs font-medium text-destructive">A supervisor with this name already exists.</p>}
            <section className="space-y-3">
              <div><h3 className="font-semibold">Assigned shops</h3><p className="text-sm text-muted-foreground">Selecting a shop moves it from its current supervisor, if any.</p></div>
              <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={shopQuery} onChange={event => setShopQuery(event.target.value)} placeholder="Search shops…" className="pl-9" /></div>
              <div className="divide-y overflow-hidden rounded-md border">
                {filteredShops.map(shop => {
                  const checked = selectedShopIds.includes(shop.id);
                  const currentSupervisor = supervisors.find(supervisor => supervisor.id === shop.supervisorId);
                  return <label key={shop.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-emerald-50">
                    <Checkbox checked={checked} onCheckedChange={value => setSelectedShopIds(current => value ? [...current, shop.id] : current.filter(id => id !== shop.id))} />
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{shop.name}</span>{currentSupervisor && currentSupervisor.id !== selectedSupervisor.id && <span className="block truncate text-xs text-amber-700">Currently assigned to {currentSupervisor.name}</span>}</span>
                  </label>;
                })}
                {!filteredShops.length && <p className="p-6 text-center text-sm text-muted-foreground">No shops match your search.</p>}
              </div>
            </section>
          </div>
        </ScrollArea>
        <DialogFooter className="border-t bg-slate-50 px-5 py-4 sm:px-6"><Button type="button" variant="outline" onClick={() => setSelectedSupervisor(null)}>Cancel</Button><Button type="button" onClick={saveSupervisor} disabled={saving || !draftName.trim() || duplicateDraftName}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save changes</Button></DialogFooter>
      </> : <>
        <DialogHeader className="border-b bg-slate-50 px-5 py-4 pr-12 text-left sm:px-6">
          <div className="flex items-center gap-3"><span className="rounded-md bg-emerald-700 p-2 text-white"><UserRoundCog className="h-5 w-5" /></span><div><DialogTitle>Manage supervisors</DialogTitle><DialogDescription className="mt-1">Create supervisors, then assign shops to them.</DialogDescription></div></div>
        </DialogHeader>
        <div className="border-b bg-emerald-50/60 p-4 sm:px-6">
          <div className="flex gap-2"><Input value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void createSupervisor(); }} placeholder="Supervisor name" aria-label="Supervisor name" /><Button type="button" onClick={createSupervisor} disabled={saving || !newName.trim() || duplicateNewName}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Add</Button></div>
          {duplicateNewName && <p className="mt-2 text-xs font-medium text-destructive">A supervisor with this name already exists.</p>}
        </div>
        <ScrollArea className="h-[min(55vh,440px)]">
          {supervisors.length ? <div className="divide-y">{supervisors.map(supervisor => {
            const assignedCount = shops.filter(shop => shop.supervisorId === supervisor.id).length;
            return <div key={supervisor.id} className="flex items-center gap-3 px-5 py-3 sm:px-6"><div className="min-w-0 flex-1"><p className="truncate font-medium">{supervisor.name}</p><p className="text-xs text-muted-foreground">{assignedCount} assigned shop{assignedCount === 1 ? "" : "s"}</p></div><Button type="button" variant="ghost" size="sm" onClick={() => openSupervisor(supervisor)}><Pencil className="mr-2 h-4 w-4" />Edit</Button><AlertDialog><AlertDialogTrigger asChild><Button type="button" variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${supervisor.name}`}><Trash2 className="h-4 w-4" /></Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {supervisor.name}?</AlertDialogTitle><AlertDialogDescription>This deletes the supervisor and leaves their assigned shops unassigned.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteSupervisor(supervisor)}>Delete supervisor</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>;
          })}</div> : <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-muted-foreground"><UserRoundCog className="h-8 w-8 text-slate-300" /><p className="font-medium">No supervisors yet</p><p className="text-sm">Add the first supervisor above.</p></div>}
        </ScrollArea>
      </>}
    </DialogContent>
  </Dialog>;
}

"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Plus, ShieldCheck, Store, Users } from "lucide-react";
import { fetchAuthUsers, handleCreateAuthUser, handleSetUserAccess, type AuthUser } from "@/app/auth-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShop } from "@/components/shop-provider";
import { useToast } from "@/hooks/use-toast";

type ManagedRole = "editor" | "viewer";

type UserManagementDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

export function UserManagementDialog({ open, onOpenChange, showTrigger = true }: UserManagementDialogProps = {}) {
  const { toast } = useToast();
  const { shops } = useShop();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<ManagedRole>("viewer");
  const [shopIds, setShopIds] = useState<string[]>([]);

  const loadUsers = async () => {
    setLoading(true);
    try { setUsers(await fetchAuthUsers()); }
    catch { toast({ variant: "destructive", title: "Could not load users" }); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    if (open) void loadUsers();
    // Loading is intentionally tied to the controlled dialog state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    const result = await handleCreateAuthUser({ username, name, password, role, shopIds });
    if (result.success) {
      setUsers(current => [...current, result.user].sort((left, right) => left.name.localeCompare(right.name)));
      setUsername("");
      setName("");
      setPassword("");
      setRole("viewer");
      setShopIds([]);
      toast({ title: "Profile created", description: `${result.user.name} can now sign in as ${result.user.username}.` });
    } else toast({ variant: "destructive", title: "Could not create profile", description: result.error });
    setCreating(false);
  };

  const changeAccess = async (user: AuthUser, nextRole: ManagedRole, nextShopIds: string[]) => {
    setSavingId(user.id);
    const result = await handleSetUserAccess(user.id, nextRole, nextShopIds);
    if (result.success) {
      setUsers(current => current.map(item => item.id === user.id ? { ...item, role: result.role, shopIds: result.shopIds } : item));
      toast({ title: "Access updated", description: `${user.username} must sign in again to use the new access.` });
    } else toast({ variant: "destructive", title: "Could not update access", description: result.error });
    setSavingId("");
  };

  const shopPicker = (selectedIds: string[], onChange: (ids: string[]) => void, disabled = false) => (
    <Popover modal>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="w-full justify-start font-normal">
          <Store className="mr-2 h-4 w-4" />
          {selectedIds.length === shops.length && shops.length > 0 ? "All shops" : `${selectedIds.length} shop${selectedIds.length === 1 ? "" : "s"}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center justify-between border-b p-3">
          <span className="text-sm font-medium">Shop access</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(selectedIds.length === shops.length ? [] : shops.map(shop => shop.id))}>
            {selectedIds.length === shops.length ? "Clear" : "Select all"}
          </Button>
        </div>
        <div className="h-56 overflow-y-auto overscroll-contain">
          <div className="space-y-1 p-2 pr-4">
            {shops.map(shop => <label key={shop.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <Checkbox checked={selectedIds.includes(shop.id)} onCheckedChange={checked => onChange(checked ? [...selectedIds, shop.id] : selectedIds.filter(id => id !== shop.id))} />
              <span className="truncate">{shop.name}</span>
            </label>)}
            {!shops.length && <p className="p-2 text-sm text-muted-foreground">No shops have been created.</p>}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  return <Dialog open={open} onOpenChange={onOpenChange}>
    {showTrigger && <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" className="px-2"><Users className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Users</span></Button></DialogTrigger>}
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>User access</DialogTitle><DialogDescription>Create credentials, choose a role, and assign the shops each user can access. The built-in administrator has access to every shop.</DialogDescription></DialogHeader>
      <form onSubmit={createUser} className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="new-user-name">Display name</Label><Input id="new-user-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required /></div>
        <div className="space-y-2"><Label htmlFor="new-user-username">Username</Label><Input id="new-user-username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]+" autoComplete="off" required /></div>
        <div className="space-y-2"><Label htmlFor="new-user-password">Password</Label><Input id="new-user-password" type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={2} maxLength={128} autoComplete="new-password" required /></div>
        <div className="space-y-2"><Label htmlFor="new-user-role">Role</Label><Select value={role} onValueChange={value => setRole(value as ManagedRole)}><SelectTrigger id="new-user-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></div>
        <div className="space-y-2 sm:col-span-2"><Label>Assigned shops</Label>{shopPicker(shopIds, setShopIds)}</div>
        <Button type="submit" className="sm:col-span-2" disabled={creating}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create profile</Button>
      </form>
      {loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : <div className="overflow-hidden rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/60"><tr><th className="px-3 py-2 text-left">User</th><th className="hidden px-3 py-2 text-left md:table-cell">Last sign-in</th><th className="px-3 py-2 text-left">Role</th><th className="px-3 py-2 text-left">Shops</th></tr></thead><tbody className="divide-y">{users.map(user => <tr key={user.id}><td className="px-3 py-3"><p className="font-medium">{user.name}</p><p className="text-xs text-muted-foreground">@{user.username}</p></td><td className="hidden px-3 py-3 text-muted-foreground md:table-cell">{user.lastSignInAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(user.lastSignInAt)) : "—"}</td><td className="px-3 py-3">{user.role === "admin" ? <span className="inline-flex items-center gap-2 capitalize"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{user.role}</span> : <select aria-label={`Role for ${user.username}`} value={user.role} disabled={savingId === user.id} onChange={event => void changeAccess(user, event.target.value as ManagedRole, user.shopIds)} className="h-9 rounded-md border bg-background px-2"><option value="viewer">Viewer</option><option value="editor">Editor</option></select>}</td><td className="min-w-40 px-3 py-3">{user.role === "admin" ? <span className="text-muted-foreground">All shops</span> : <div className="flex items-center gap-2">{shopPicker(user.shopIds, ids => void changeAccess(user, user.role as ManagedRole, ids), savingId === user.id)}{savingId === user.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}</div>}</td></tr>)}</tbody></table>{!users.length && <p className="p-6 text-center text-sm text-muted-foreground">No users found.</p>}</div>}
    </DialogContent>
  </Dialog>;
}

"use client";

import { FormEvent, useState } from "react";
import { Loader2, Plus, ShieldCheck, Users } from "lucide-react";
import { fetchAuthUsers, handleCreateAuthUser, handleSetUserRole, type AuthUser } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type ManagedRole = "editor" | "viewer";

type UserManagementDialogProps = {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
};

export function UserManagementDialog({ open, onOpenChange, showTrigger = true }: UserManagementDialogProps = {}) {
  const { toast } = useToast();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState("");
  const [creating, setCreating] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<ManagedRole>("viewer");

  const loadUsers = async () => {
    setLoading(true);
    try { setUsers(await fetchAuthUsers()); }
    catch { toast({ variant: "destructive", title: "Could not load users" }); }
    finally { setLoading(false); }
  };

  const createUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCreating(true);
    const result = await handleCreateAuthUser({ username, name, password, role });
    if (result.success) {
      setUsers(current => [...current, result.user].sort((left, right) => left.name.localeCompare(right.name)));
      setUsername("");
      setName("");
      setPassword("");
      setRole("viewer");
      toast({ title: "Profile created", description: `${result.user.name} can now sign in as ${result.user.username}.` });
    } else toast({ variant: "destructive", title: "Could not create profile", description: result.error });
    setCreating(false);
  };

  const changeRole = async (user: AuthUser, nextRole: ManagedRole) => {
    setSavingId(user.id);
    const result = await handleSetUserRole(user.id, nextRole);
    if (result.success) {
      setUsers(current => current.map(item => item.id === user.id ? { ...item, role: result.role } : item));
      toast({ title: "Role updated", description: `${user.username} is now ${result.role} and must sign in again.` });
    } else toast({ variant: "destructive", title: "Could not update role", description: result.error });
    setSavingId("");
  };

  return <Dialog open={open} onOpenChange={nextOpen => { onOpenChange?.(nextOpen); if (nextOpen) void loadUsers(); }}>
    {showTrigger && <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" className="px-2"><Users className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Users</span></Button></DialogTrigger>}
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>User access</DialogTitle><DialogDescription>Create local credentials for editors and viewers. The built-in administrator account cannot be changed.</DialogDescription></DialogHeader>
      <form onSubmit={createUser} className="grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="new-user-name">Display name</Label><Input id="new-user-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} required /></div>
        <div className="space-y-2"><Label htmlFor="new-user-username">Username</Label><Input id="new-user-username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={40} pattern="[A-Za-z0-9._-]+" autoComplete="off" required /></div>
        <div className="space-y-2"><Label htmlFor="new-user-password">Password</Label><Input id="new-user-password" type="password" value={password} onChange={event => setPassword(event.target.value)} minLength={2} maxLength={128} autoComplete="new-password" required /></div>
        <div className="space-y-2"><Label htmlFor="new-user-role">Role</Label><Select value={role} onValueChange={value => setRole(value as ManagedRole)}><SelectTrigger id="new-user-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="editor">Editor</SelectItem><SelectItem value="viewer">Viewer</SelectItem></SelectContent></Select></div>
        <Button type="submit" className="sm:col-span-2" disabled={creating}>{creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Create profile</Button>
      </form>
      {loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : <div className="overflow-hidden rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/60"><tr><th className="px-3 py-2 text-left">User</th><th className="hidden px-3 py-2 text-left sm:table-cell">Last sign-in</th><th className="px-3 py-2 text-right">Role</th></tr></thead><tbody className="divide-y">{users.map(user => <tr key={user.id}><td className="px-3 py-3"><p className="font-medium">{user.name}</p><p className="text-xs text-muted-foreground">@{user.username}</p></td><td className="hidden px-3 py-3 text-muted-foreground sm:table-cell">{user.lastSignInAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(user.lastSignInAt)) : "—"}</td><td className="px-3 py-3 text-right">{user.role === "admin" ? <span className="inline-flex items-center gap-2 capitalize"><ShieldCheck className="h-4 w-4 text-muted-foreground" />{user.role}</span> : <div className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" /><select aria-label={`Role for ${user.username}`} value={user.role} disabled={savingId === user.id} onChange={event => void changeRole(user, event.target.value as ManagedRole)} className="h-9 rounded-md border bg-background px-2"><option value="viewer">Viewer</option><option value="editor">Editor</option></select>{savingId === user.id && <Loader2 className="h-4 w-4 animate-spin" />}</div>}</td></tr>)}</tbody></table></div>}
    </DialogContent>
  </Dialog>;
}

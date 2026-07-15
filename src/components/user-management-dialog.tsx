"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, Users } from "lucide-react";
import { fetchAuthUsers, handleSetUserRole, type AuthUser } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function UserManagementDialog() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingUid, setSavingUid] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    try { setUsers(await fetchAuthUsers()); }
    catch { toast({ variant: "destructive", title: "Could not load users" }); }
    finally { setLoading(false); }
  };

  const changeRole = async (user: AuthUser, role: AuthUser["role"]) => {
    setSavingUid(user.uid);
    const result = await handleSetUserRole(user.uid, role);
    if (result.success) {
      setUsers(current => current.map(item => item.uid === user.uid ? { ...item, role: result.role } : item));
      toast({ title: "Role updated", description: `${user.email} is now ${result.role}. They must sign in again to refresh access.` });
    } else toast({ variant: "destructive", title: "Could not update role", description: result.error });
    setSavingUid("");
  };

  return <Dialog onOpenChange={open => { if (open) void loadUsers(); }}>
    <DialogTrigger asChild><Button type="button" variant="ghost" size="sm" className="px-2"><Users className="h-4 w-4 md:mr-2" /><span className="hidden md:inline">Users</span></Button></DialogTrigger>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>User access</DialogTitle><DialogDescription>Roles are stored as trusted Firebase custom claims. Changes apply after the user signs in again.</DialogDescription></DialogHeader>
      {loading ? <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin" /></div> : <div className="overflow-hidden rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/60"><tr><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">Last sign-in</th><th className="px-3 py-2 text-right">Role</th></tr></thead><tbody className="divide-y">{users.map(user => <tr key={user.uid}><td className="px-3 py-3"><p className="font-medium">{user.name}</p><p className="text-xs text-muted-foreground">{user.email}</p></td><td className="px-3 py-3 text-muted-foreground">{user.lastSignInAt ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(user.lastSignInAt)) : "—"}</td><td className="px-3 py-3 text-right"><div className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-muted-foreground" /><select aria-label={`Role for ${user.email}`} value={user.role} disabled={savingUid === user.uid} onChange={event => void changeRole(user, event.target.value as AuthUser["role"])} className="h-9 rounded-md border bg-background px-2"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Administrator</option></select>{savingUid === user.uid && <Loader2 className="h-4 w-4 animate-spin" />}</div></td></tr>)}</tbody></table>{!users.length && <p className="p-8 text-center text-muted-foreground">No Firebase users found.</p>}</div>}
    </DialogContent>
  </Dialog>;
}

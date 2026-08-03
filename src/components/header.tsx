
"use client";

import { LogOut, ShieldCheck, UserRound, Users } from "lucide-react";
import { Children, Fragment, isValidElement, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserManagementDialog } from "@/components/user-management-dialog";

type HeaderProps = {
  title: string;
  actions?: ReactNode;
};

export function Header({ title, actions }: HeaderProps) {
  const { actor } = useShop();
  const router = useRouter();
  const [isUserManagementOpen, setIsUserManagementOpen] = useState(false);

  const logout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  };

  const actionItems = isValidElement<{ children?: ReactNode }>(actions) && actions.type === Fragment
    ? Children.toArray(actions.props.children)
    : Children.toArray(actions);
  const [leadingAction, ...trailingActions] = actionItems;

  return (
    <header className="sticky top-0 z-10 flex min-h-12 flex-wrap items-center gap-2 border-b bg-background/80 px-4 py-1.5 backdrop-blur-sm md:px-5">
      {leadingAction && <div className="shrink-0">{leadingAction}</div>}
      <h1 className="min-w-0 flex-1 truncate text-lg font-semibold md:text-xl" title={title}>{title}</h1>
      {trailingActions.length > 0 && <div className="order-last flex w-full items-center gap-2 overflow-x-auto lg:order-none lg:ml-2 lg:w-auto lg:flex-1 lg:justify-end">{trailingActions}</div>}
      <div className="ml-auto flex shrink-0 items-center gap-2"><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" className="h-9 gap-2 px-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-4 w-4" /></span><span className="hidden max-w-40 truncate text-sm sm:inline">{actor.name}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel><span className="block truncate">{actor.name}</span><span className="block truncate text-xs font-normal text-muted-foreground">@{actor.username}</span></DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem disabled><ShieldCheck className="mr-2 h-4 w-4" /><span className="capitalize">{actor.role}</span></DropdownMenuItem>{actor.role === "admin" && <><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setIsUserManagementOpen(true)}><Users className="mr-2 h-4 w-4" />Manage users</DropdownMenuItem></>}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void logout()} className="text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu>{actor.role === "admin" && <UserManagementDialog open={isUserManagementOpen} onOpenChange={setIsUserManagementOpen} showTrigger={false} />}</div>
    </header>
  );
}

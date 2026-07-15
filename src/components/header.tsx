
"use client";

import { LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useShop } from "@/components/shop-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserManagementDialog } from "@/components/user-management-dialog";

type HeaderProps = {
  title: string;
};

export function Header({ title }: HeaderProps) {
  const { actor } = useShop();
  const router = useRouter();

  const logout = async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    router.replace("/login");
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-10 flex h-12 items-center border-b bg-background/80 px-4 backdrop-blur-sm md:px-5">
      <h1 className="min-w-0 truncate text-lg font-semibold md:text-xl" title={title}>{title}</h1>
      <div className="ml-auto flex items-center gap-2">{actor.role === "admin" && <UserManagementDialog />}<DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" className="h-9 gap-2 px-2"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-4 w-4" /></span><span className="hidden max-w-40 truncate text-sm sm:inline">{actor.name}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel><span className="block truncate">{actor.name}</span><span className="block truncate text-xs font-normal text-muted-foreground">{actor.email}</span></DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem disabled><ShieldCheck className="mr-2 h-4 w-4" /><span className="capitalize">{actor.role}</span></DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void logout()} className="text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>
    </header>
  );
}

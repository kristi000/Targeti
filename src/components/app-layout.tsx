
"use client";

import React from "react";
import { useShop } from "@/components/shop-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarProvider, Sidebar, SidebarInset } from "@/components/ui/sidebar";
import { SidebarNav } from "@/components/sidebar-nav";
import { Toaster } from "@/components/ui/toaster";

function AppSkeleton() {
  return (
    <div className="flex min-h-svh">
      <div className="hidden md:block">
        <div className="w-[16rem] h-full p-2">
            <div className="flex flex-col h-full bg-sidebar rounded-lg p-2 gap-2">
                <Skeleton className="h-10 w-full" />
                <div className="flex flex-col flex-1 gap-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                </div>
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
            </div>
        </div>
      </div>
      <div className="flex-1 p-2">
         <div className="h-16 flex items-center mb-4">
             <Skeleton className="h-8 w-48" />
         </div>
         <Skeleton className="h-[calc(100vh-8rem)] w-full" />
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
    const { loading } = useShop();

    if (loading) {
        return <AppSkeleton />;
    }

    return (
        <SidebarProvider>
            <Sidebar className="border-r" collapsible="icon">
                <SidebarNav />
            </Sidebar>
            <SidebarInset>{children}</SidebarInset>
            <Toaster />
        </SidebarProvider>
    );
}


"use client";

import React from "react";
import { SidebarNav } from "@/components/sidebar-nav";
import { useShop } from "@/components/shop-provider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toaster";

function AppSkeleton() {
  return (
    <div className="min-h-svh p-3">
      <div className="mb-3 flex h-12 items-center">
        <Skeleton className="h-7 w-48" />
      </div>
      <Skeleton className="h-[calc(100vh-5rem)] w-full" />
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
      <Sidebar collapsible="offcanvas">
        <SidebarNav />
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 overflow-hidden">
        {children}
      </SidebarInset>
      <Toaster />
    </SidebarProvider>
  );
}

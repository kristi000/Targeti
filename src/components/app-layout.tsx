
"use client";

import React from "react";
import { SidebarNav } from "@/components/sidebar-nav";
import { BrandLogo } from "@/components/brand-logo";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toaster";

function RouteSkeleton() {
  return (
    <div className="min-h-svh p-4 md:p-6">
      <Skeleton className="mb-6 h-8 w-52" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28" />
        ))}
      </div>
      <Skeleton className="mt-6 h-[min(32rem,55vh)] w-full" />
    </div>
  );
}

export function AppShellFallback() {
  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader>
          <div className="flex items-center gap-2.5">
            <BrandLogo />
          </div>
        </SidebarHeader>
        <SidebarContent className="space-y-3 px-2 pt-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-4/5" />
        </SidebarContent>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="min-w-0 overflow-hidden">
        <RouteSkeleton />
      </SidebarInset>
    </SidebarProvider>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
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

"use client";

import { useState, type ReactNode } from "react";
import {
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query";

export function QueryProvider({ children, dehydratedState }: { children: ReactNode; dehydratedState?: DehydratedState }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
    </QueryClientProvider>
  );
}

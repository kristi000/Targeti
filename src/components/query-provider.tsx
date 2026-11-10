import { useEffect, useState, type ReactNode } from "react";
import {
  HydrationBoundary,
  QueryClient,
  QueryClientProvider,
  type DehydratedState,
} from "@tanstack/react-query";

import { onAppRefresh } from "@/lib/app-refresh";

export function QueryProvider({ children, dehydratedState }: { children: ReactNode; dehydratedState?: DehydratedState }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  }));

  // router.refresh() refetches everything this client has loaded.
  useEffect(() => onAppRefresh(() => queryClient.invalidateQueries()), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
    </QueryClientProvider>
  );
}

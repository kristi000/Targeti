import "@fontsource-variable/inter";
import "@/styles/globals.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";

import { ThemeProvider } from "@/components/theme-provider";
import { onAppRefresh } from "@/lib/app-refresh";
import { bootstrapQueryKey } from "@/lib/query-keys";
import { router } from "@/router";

// App-wide data (translations, signed-in user). Page data lives in the
// per-user QueryProvider inside the locale layout.
const rootQueryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
onAppRefresh(() => rootQueryClient.invalidateQueries({ queryKey: bootstrapQueryKey }));

// index.html applies the saved theme before first paint.
const initialTheme = document.documentElement.classList.contains("dark") ? "dark" : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider initialTheme={initialTheme}>
      <QueryClientProvider client={rootQueryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);

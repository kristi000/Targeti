"use client";

import { useQuery } from "@tanstack/react-query";

export const restrictedAccessQueryKey = ["auth", "restricted-access"] as const;

export function useRestrictedAccess() {
  return useQuery({
    queryKey: restrictedAccessQueryKey,
    queryFn: async () => {
      const response = await fetch("/api/auth/restricted-access");
      if (!response.ok) return false;
      const result = await response.json() as { hasAccess: boolean };
      return result.hasAccess;
    },
    staleTime: 60_000,
  });
}

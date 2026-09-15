"use client";

import { useRouter } from "next/navigation";
import { RestrictedAccessPage } from "@/components/restricted-access";

export function BonusAccessGate() {
  const router = useRouter();
  return <RestrictedAccessPage onGranted={() => router.refresh()} />;
}

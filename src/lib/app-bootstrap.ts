import type { AppActor } from "@/lib/auth-types";
import type { ShopData } from "@/lib/types";

/** Response of GET /api/bootstrap: what the app shell needs before rendering. */
export type AppBootstrap = {
  actor: AppActor;
  directory: ShopData;
  performanceMetricsEnabled: boolean;
};

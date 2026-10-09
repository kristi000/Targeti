import "server-only";

import { performance } from "node:perf_hooks";

export function performanceMetricsEnabled() {
  return process.env.PERFORMANCE_METRICS_ENABLED === "true";
}

export async function measureServerOperation<T>(operation: string, load: () => Promise<T>): Promise<T> {
  if (!performanceMetricsEnabled()) return load();
  const started = performance.now();
  let outcome: "success" | "error" = "error";
  let result: T | undefined;
  try {
    result = await load();
    outcome = "success";
    return result;
  } finally {
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    // Diagnostics must never change the result or expose its contents.
    try {
      const serializedBytes = outcome === "success"
        ? Buffer.byteLength(JSON.stringify(result) ?? "", "utf8")
        : undefined;
      console.info(JSON.stringify({
        event: "targeti.performance", source: "server", operation,
        environment: process.env.NODE_ENV, outcome, durationMs, serializedBytes,
      }));
    } catch {
      // A result that cannot be JSON-encoded is still returned to its caller.
    }
  }
}

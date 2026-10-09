"use client";

import { useCallback, useEffect, useRef } from "react";
import { useReportWebVitals } from "next/web-vitals";
import { getPerformanceRoute, performanceMetricNames, type PerformanceMetricSample } from "@/lib/performance-metrics";

type WebVital = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

export function PerformanceVitals() {
  // Web Vitals describe the document load, not subsequent client navigations.
  const initialRoute = useRef<PerformanceMetricSample["route"] | null>(null);
  const samples = useRef(new Map<string, PerformanceMetricSample>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (!samples.current.size) return;
    const body = JSON.stringify({ metrics: [...samples.current.values()] });
    samples.current.clear();
    const blob = new Blob([body], { type: "application/json" });
    try {
      if (navigator.sendBeacon?.("/api/performance", blob)) return;
    } catch {
      // Browsers that reject beacons can use the same-origin fetch fallback.
    }
    void fetch("/api/performance", {
      method: "POST", body, headers: { "Content-Type": "application/json" },
      credentials: "same-origin", keepalive: true,
    }).catch(() => undefined);
  }, []);

  const report = useCallback((metric: WebVital) => {
    if (!(performanceMetricNames as readonly string[]).includes(metric.name) || !Number.isFinite(metric.value)) return;
    if (initialRoute.current === null) {
      const navigation = performance.getEntriesByType("navigation")[0];
      const documentPath = new URL(navigation?.name ?? window.location.href).pathname;
      // Sign-in uses client navigation: its buffered metrics belong to login.
      if (!/^\/(en|sq)(\/|$)/.test(documentPath)) return;
      initialRoute.current = getPerformanceRoute(documentPath);
    }
    samples.current.set(metric.name, {
      id: metric.id, name: metric.name as PerformanceMetricSample["name"], value: metric.value,
      route: initialRoute.current, viewport: window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop",
    });
    if (timer.current === null) timer.current = setTimeout(flush, 5000);
  }, [flush]);

  useReportWebVitals(report);
  useEffect(() => {
    const onVisibilityChange = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, [flush]);
  return null;
}

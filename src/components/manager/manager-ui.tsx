import type { ReactNode } from "react";
import { AlertCircle, ArrowDown, ArrowUp, Loader2, type LucideIcon } from "lucide-react";
import { useTranslations } from "use-intl";

import { achievementTone, toneText } from "@/components/dashboard-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Small building blocks shared by the manager app's tabs. */

export function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("mt-5", className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("manager-card rounded-[22px] p-4", className)}>{children}</div>;
}

/** Small outlined icon box used in card headers. */
export function IconBox({ icon: Icon, className }: { icon: LucideIcon; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border bg-card text-foreground", className)}>
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
}

/** Green up / red down chip with the change, followed by muted context ("since last import"). */
export function TrendChip({ value, suffix = "%", context }: { value: number | null | undefined; suffix?: string; context?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return context ? <span className="text-[11px] text-muted-foreground">{context}</span> : null;
  const up = value >= 0;
  const Arrow = up ? ArrowUp : ArrowDown;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
      <span className={cn("flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-white", up ? "bg-emerald-500" : "bg-rose-500")}>
        <Arrow aria-hidden="true" className="h-2.5 w-2.5" strokeWidth={3} />
      </span>
      <span className={cn("font-medium tabular-nums", up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
        {up ? "+" : ""}{Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value)}{suffix}
      </span>
      {context && <span className="truncate text-muted-foreground">{context}</span>}
    </span>
  );
}

/** Overview card: icon and label on top, a large value, and an optional trend line. */
export function StatCard({ icon, label, value, footer, className }: { icon: LucideIcon; label: string; value: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <div className={cn("manager-card flex min-w-0 flex-col rounded-[20px] p-3.5", className)}>
      <div className="flex items-center gap-2">
        <IconBox icon={icon} />
        <span className="truncate text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="mt-3 truncate text-[22px] font-bold leading-none tracking-tight tabular-nums">{value}</div>
      {footer && <div className="mt-2.5">{footer}</div>}
    </div>
  );
}

/** Semicircle gauge with the score in the middle, as in a health meter. */
export function Gauge({ value, label, sublabel }: { value: number | null; label: string; sublabel: string }) {
  const size = 220;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const half = Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  const arc = `M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`;
  return (
    <div className="relative mx-auto w-full max-w-[240px]">
      <svg viewBox={`0 0 ${size} ${size / 2 + stroke}`} className="w-full" role="img" aria-label={`${label} ${sublabel}`}>
        <path d={arc} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" className="text-foreground/[0.08]" />
        <path d={arc} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${(clamped / 100) * half} ${half}`} className="text-primary transition-[stroke-dasharray] duration-700" />
      </svg>
      <div className="absolute inset-x-0 bottom-1 text-center">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tracking-tight tabular-nums">{sublabel}</p>
      </div>
    </div>
  );
}

/** `toneValue` picks the colour (for example the month-end forecast) when it differs from the bar's value. */
export function ProgressBar({ value, toneValue, className }: { value: number | null | undefined; toneValue?: number | null; className?: string }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value ?? 0 : 0));
  const tone = achievementTone(toneValue === undefined ? value : toneValue);
  return (
    <div className={cn("manager-stripes h-2 overflow-hidden rounded-full", className)}>
      <div
        className={cn("h-full rounded-full", tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-primary" : "bg-muted-foreground/40")}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

export function ProgressRing({ value, toneValue, size = 88 }: { value: number | null; toneValue?: number | null; size?: number }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={value === null ? "—" : `${Math.round(value)}%`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-foreground/[0.08]" />
      <circle
        cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round"
        strokeDasharray={`${(clamped / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className={achievementTone(toneValue === undefined ? value : toneValue) === "good" ? "text-emerald-500" : "text-primary"}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-foreground text-lg font-semibold tabular-nums">
        {value === null ? "—" : `${Math.round(value)}%`}
      </text>
    </svg>
  );
}

export function Percent({ value, toneValue, className }: { value: number | null | undefined; toneValue?: number | null; className?: string }) {
  return (
    <span className={cn("tabular-nums font-semibold", toneText[achievementTone(toneValue === undefined ? value : toneValue)], className)}>
      {value === null || value === undefined || !Number.isFinite(value) ? "—" : `${Math.round(value)}%`}
    </span>
  );
}

export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("");
  return (
    <span aria-hidden="true" className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary", className)}>
      {letters || "?"}
    </span>
  );
}

export function SegmentedControl<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="manager-card flex rounded-full p-1">
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-w-0 flex-1 truncate rounded-full px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            option.value === value && "bg-foreground text-background",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function LoadingState() {
  const t = useTranslations("Manager");
  return (
    <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />{t("loading")}
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("Manager");
  return (
    <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
      <AlertCircle aria-hidden="true" className="h-6 w-6 text-destructive" />
      <p>{t("loadFailed")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>{t("retry")}</Button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}

const amountFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 0 });
const compactFormat = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

export function formatAmount(value: number) {
  return amountFormat.format(Math.round(value));
}

export function formatCompact(value: number) {
  return Math.abs(value) >= 100_000 ? compactFormat.format(value) : amountFormat.format(Math.round(value));
}

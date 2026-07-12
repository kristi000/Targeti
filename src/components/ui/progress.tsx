
"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

type ProgressProps = React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & {
  markerValue?: number
}

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressProps
>(({ className, value = 0, max = 100, markerValue, ...props }, ref) => {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100
  const safeValue = typeof value === "number" && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), safeMax)
    : 0
  const percentage = (safeValue / safeMax) * 100
  const markerPercentage = typeof markerValue === "number" && Number.isFinite(markerValue)
    ? (Math.min(Math.max(markerValue, 0), safeMax) / safeMax) * 100
    : null

  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={safeValue}
      max={safeMax}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all duration-500 ease-in-out"
        style={{ transform: `translateX(-${100 - percentage}%)` }}
      />
      {markerPercentage !== null && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 z-10 w-0.5 -translate-x-1/2 bg-foreground/70 shadow-[0_0_0_1px_hsl(var(--background)/0.5)]"
          style={{ left: `${markerPercentage}%` }}
        />
      )}
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }

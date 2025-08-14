import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { type PerformanceMetric } from "@/lib/types";
import { METRIC_CONFIG } from "@/lib/data";
import type { LucideIcon } from "lucide-react";

type StatsCardProps = {
  metric: PerformanceMetric | 'total';
  value: number;
  label?: string;
  icon?: LucideIcon;
  achievement?: number;
  prediction?: number;
  isPercentage?: boolean;
  caption?: string;
  timeframe: 'daily' | 'monthly';
};

export function StatsCard({ 
  metric,
  value,
  label,
  icon,
  achievement, 
  prediction,
  isPercentage = false,
  caption,
  timeframe
}: StatsCardProps) {
  const config = metric === 'total' ? { label, icon } : METRIC_CONFIG[metric];
  if (!config || !config.icon) return null;

  const { icon: Icon, label: configLabel } = config;
  const displayLabel = label || configLabel;

  const displayValue = isPercentage ? `${value.toFixed(1)}%` : value;

  const cappedAchievement = Math.min(achievement ?? 0, 120);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{displayLabel}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{displayValue}</div>
        {caption && (
          <p className="text-xs text-muted-foreground">{caption}</p>
        )}
        {achievement !== undefined && !isPercentage && (
          <div className="text-xs text-muted-foreground mt-2 space-y-1">
            <p>Achieved: {cappedAchievement.toFixed(1)}%</p>
            <Progress value={Math.min(cappedAchievement, 100)} className="h-2" />
            {prediction !== undefined && (
                 <p>EOM Prediction: {Math.round(prediction ?? 0)}</p>
            )}
          </div>
        )}
         {isPercentage && (
           <div className="text-xs text-muted-foreground mt-2 space-y-1">
            <p>Target: 100%</p>
            <Progress value={Math.min(value, 100)} className="h-2" />
          </div>
         )}
      </CardContent>
    </Card>
  );
}

export function StatsGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {children}
    </div>
  );
}

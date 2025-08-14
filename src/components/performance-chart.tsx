
"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { type PerformanceData, performanceMetrics, type Target } from "@/lib/types";
import { METRIC_WEIGHTS } from "@/lib/data";
import { format, parseISO } from "date-fns";
import { useTranslations } from "next-intl";

type PerformanceChartProps = {
  data: ({ date: string } & Record<string, number>)[];
  targets: Target;
};

export function PerformanceChart({ data, targets }: PerformanceChartProps) {
  const t = useTranslations("DetailedDashboard");
  const chartConfig = {
    contribution: {
      label: t('dailyContribution'),
      color: "hsl(var(--primary))",
    },
  };

  const chartData = data.map(day => {
    const dailyContribution = performanceMetrics.reduce((total, metric) => {
      const value = day[metric] ?? 0;
      const target = targets[metric];
      const achievement = target > 0 ? (value / target) * 100 : 0;
      return total + (achievement * METRIC_WEIGHTS[metric]);
    }, 0);

    return {
      date: day.date ? format(parseISO(day.date), "d") : "N/A",
      ...day,
      contribution: parseFloat(dailyContribution.toFixed(2)),
    }
  });


  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('performanceTrends')}</CardTitle>
        <CardDescription>
          {t('dailyContributionSummary')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="h-[300px] w-full">
          <BarChart data={chartData}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
            />
            <YAxis unit="%" />
            <Tooltip
              cursor={false}
              content={<ChartTooltipContent indicator="dot" />}
            />
            <Bar dataKey="contribution" fill="var(--color-contribution)" radius={4} name={t('dailyContribution')} unit="%" />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

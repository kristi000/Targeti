
"use client";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Trophy, ChevronRight, TrendingUp } from "lucide-react";

type ShopPerformanceCardProps = {
  shopName: string;
  totalPerformance: number;
  forecastPerformance: number;
};

export function ShopPerformanceCard({
  shopName,
  totalPerformance,
  forecastPerformance,
}: ShopPerformanceCardProps) {
  return (
    <Card className="hover:bg-muted/50 transition-colors">
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-4">
            <Trophy className="h-8 w-8 text-primary" />
            <div className="w-48">
                <p className="font-semibold">{shopName}</p>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span>{totalPerformance.toFixed(1)}%</span>
                    <Progress value={Math.min(totalPerformance, 100)} className="h-2 w-24" />
                </div>
                 <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                    <TrendingUp className="h-3 w-3" />
                    <span>EOM: {forecastPerformance.toFixed(1)}%</span>
                </div>
            </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}


"use client";

import { useState, type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bot, Lightbulb, ClipboardCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { handleAnalyzePerformanceData } from "@/app/actions";
import { type AnalyzePerformanceDataOutput } from "@/ai/flows/analyze-performance-data";
import { type Target, performanceMetrics, type PerformanceMetric } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "next-intl";

type AIAssistantDialogProps = {
  children: ReactNode;
  dailyData: Record<PerformanceMetric, number>;
  monthlyTarget: Target;
};

export function AIAssistantDialog({
  children,
  dailyData,
  monthlyTarget,
}: AIAssistantDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzePerformanceDataOutput | null>(
    null
  );
  const { toast } = useToast();
  const t = useTranslations("Dialogs");

  const onAnalyze = async () => {
    setLoading(true);
    setResult(null);

    const dailyDataInput = performanceMetrics.reduce((acc, metric) => {
      acc[metric] = dailyData[metric] || 0;
      return acc;
    }, {} as Record<string, number>);

    const analysisResult = await handleAnalyzePerformanceData({
      dailyData: dailyDataInput,
      monthlyTarget,
    });
    setLoading(false);

    if (analysisResult.success) {
      setResult(analysisResult.data);
    } else {
      toast({
        variant: "destructive",
        title: t('analysisFailed'),
        description: analysisResult.error,
      });
      setOpen(false);
    }
  };

  const onOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      onAnalyze();
    } else {
      setResult(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot /> {t('aiAssistantTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('aiAssistantDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4 space-y-6">
          {loading && (
            <div className="space-y-4">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {result && (
            <>
              <div>
                <h3 className="font-semibold mb-2 flex items-center gap-2"><ClipboardCheck className="text-primary"/>{t('summary')}</h3>
                <p className="text-sm text-muted-foreground">{result.summary}</p>
              </div>
              <div>
                <h3 className="font-semibold mb-2 flex items-center gap-2"><Lightbulb className="text-accent"/>{t('suggestions')}</h3>
                <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground">
                  {result.suggestions.map((suggestion, index) => (
                    <li key={index}>{suggestion}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>{t('close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


"use client";

import { useState, useMemo } from "react";
import {
  Bot,
  Settings,
  Check,
  Loader2,
  Pencil,
  Store,
  Edit,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  type PerformanceData,
  type Target,
  type PerformanceMetric,
  performanceMetrics,
  type RepPerformanceData,
  Shop,
} from "@/lib/types";
import { AIAssistantDialog } from "./ai-assistant-dialog";
import { useShop } from "./shop-provider";
import { SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "./ui/sidebar";
import { usePathname } from "next/navigation";
import { ManageShopsDialog } from "./manage-shops-dialog";
import { useTranslations } from "next-intl";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./ui/accordion";
import { ScrollArea } from "./ui/scroll-area";

export function SidebarActions() {
    const { selectedShop, allPerformanceData, allMonthlyTargets, updatePerformanceData, updateMonthlyTargets, updateShop, deleteShop, refreshDataForShop } = useShop();
    const pathname = usePathname();
    const t = useTranslations("Sidebar");
    const tDialog = useTranslations("Dialogs");
    const tMetric = useTranslations("Metrics");

    const isDashboard = !pathname.includes('/shop/');
    
    const performanceData = selectedShop ? allPerformanceData[selectedShop.id] || [] : [];
    const monthlyTargets = selectedShop ? allMonthlyTargets[selectedShop.id] || {} : {};

    const latestData = useMemo(() => {
        return performanceData.reduce((acc, day) => {
            day.reps.forEach(rep => {
                performanceMetrics.forEach(metric => {
                    acc[metric] = (acc[metric] || 0) + rep[metric];
                });
            });
            return acc;
        }, {} as Record<PerformanceMetric, number>);
    }, [performanceData]);
    
    const [editingTargets, setEditingTargets] = useState<Target>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false);
    const [isAchievementDialogOpen, setIsAchievementDialogOpen] = useState(false);
    
    const [isManagementDialogOpen, setIsManagementDialogOpen] = useState(false);
    const [editingShop, setEditingShop] = useState<Shop | null>(null);

    const initialRepTotals = useMemo(() => {
        const totals: Record<string, Record<PerformanceMetric, number>> = {};
        (selectedShop?.salesRepresentatives || []).forEach(rep => {
            totals[rep.id] = performanceMetrics.reduce((acc, metric) => {
                acc[metric] = 0;
                return acc;
            }, {} as Record<PerformanceMetric, number>);
        });

        performanceData.forEach(day => {
            day.reps.forEach(repData => {
                if (totals[repData.repId]) {
                    performanceMetrics.forEach(metric => {
                        totals[repData.repId][metric] += repData[metric];
                    });
                }
            });
        });
        return totals;
    }, [performanceData, selectedShop?.salesRepresentatives]);

    const [editingRepTotals, setEditingRepTotals] = useState<Record<string, Record<PerformanceMetric, number>>>({});

    const handleTargetChange = (metric: PerformanceMetric, value: string) => {
        setEditingTargets((prev) => ({ ...prev, [metric]: Number(value) }));
    };

    const onOpenTargetDialog = () => {
        setEditingTargets(monthlyTargets);
        setIsTargetDialogOpen(true);
    };

    const onSaveTargets = async () => {
        if (!selectedShop) return;
        setIsSaving(true);
        await updateMonthlyTargets(selectedShop.id, editingTargets);
        await refreshDataForShop(selectedShop.id);
        setIsSaving(false);
        setIsTargetDialogOpen(false);
    };

    const handleAchievementChange = (repId: string, metric: PerformanceMetric, value: string) => {
        setEditingRepTotals(prev => ({
            ...prev,
            [repId]: {
                ...prev[repId],
                [metric]: Number(value)
            }
        }));
    };

    const onOpenAchievementDialog = () => {
        setEditingRepTotals(initialRepTotals);
        setIsAchievementDialogOpen(true);
    };

    const onSaveAchievements = async () => {
        if (!editingRepTotals || !selectedShop) return;
        setIsSaving(true);
        
        const repsData: RepPerformanceData[] = Object.entries(editingRepTotals).map(([repId, metrics]) => ({
            repId,
            ...metrics
        }));

        const newPerformanceDataEntry: PerformanceData = {
            date: new Date().toISOString().split("T")[0],
            reps: repsData
        };

        const newPerformanceData = [newPerformanceDataEntry];
        
        await updatePerformanceData(selectedShop.id, newPerformanceData);
        await refreshDataForShop(selectedShop.id);
        setIsSaving(false);
        setIsAchievementDialogOpen(false);
    };

    const handleSaveShop = (shop: Shop) => {
        updateShop(shop);
        setIsManagementDialogOpen(false);
    };

    const handleDeleteShop = (shopId: string) => {
        deleteShop(shopId);
        setIsManagementDialogOpen(false);
    }

    const handleOpenManageShops = () => {
        setEditingShop(null);
        setIsManagementDialogOpen(true);
    }
    
    const handleOpenEditShop = () => {
        if(selectedShop) {
            setEditingShop(selectedShop);
            setIsManagementDialogOpen(true);
        }
    }
        
    return (
        <>
            <SidebarMenu>
                {isDashboard && (
                    <SidebarMenuItem>
                        <SidebarMenuButton onClick={handleOpenManageShops}>
                            <Store />
                            <span>{t('manageShops')}</span>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                )}
                {selectedShop && !isDashboard && (
                    <>
                        <Dialog open={isTargetDialogOpen} onOpenChange={setIsTargetDialogOpen}>
                            <DialogTrigger asChild>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={onOpenTargetDialog}>
                                        <Settings />
                                        <span>{t('setMonthlyTargets')}</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </DialogTrigger>
                            <DialogContent>
                            <DialogHeader>
                                <DialogTitle>{tDialog('setTargetsTitle', {shopName: selectedShop.name})}</DialogTitle>
                                <DialogDescription>
                                    {tDialog('setTargetsDescription')}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid grid-cols-2 gap-4 py-4">
                                {performanceMetrics.map((metric) => (
                                <div key={metric} className="space-y-2">
                                    <Label htmlFor={`target-${metric}`}>
                                        {tMetric(metric)}
                                    </Label>
                                    <Input
                                    id={`target-${metric}`}
                                    type="number"
                                    value={editingTargets[metric] || ''}
                                    onChange={(e) => handleTargetChange(metric, e.target.value)}
                                    />
                                </div>
                                ))}
                            </div>
                            <DialogFooter>
                                <Button onClick={onSaveTargets} disabled={isSaving}>
                                {isSaving ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="mr-2 h-4 w-4" />
                                )}
                                {tDialog('saveChanges')}
                                </Button>
                            </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <Dialog open={isAchievementDialogOpen} onOpenChange={setIsAchievementDialogOpen}>
                            <DialogTrigger asChild>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={onOpenAchievementDialog}>
                                        <Pencil />
                                        <span>{t('editAchievements')}</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                            <DialogHeader>
                                <DialogTitle>{tDialog('editAchievementsTitle', {shopName: selectedShop.name})}</DialogTitle>
                                <DialogDescription>
                                {tDialog('editAchievementsDescription')}
                                </DialogDescription>
                            </DialogHeader>
                            <ScrollArea className="h-[60vh] pr-6">
                            <Accordion type="single" collapsible className="w-full">
                                {(selectedShop.salesRepresentatives || []).map(rep => (
                                    <AccordionItem key={rep.id} value={rep.name}>
                                        <AccordionTrigger>{rep.name}</AccordionTrigger>
                                        <AccordionContent>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-1">
                                                {initialRepTotals[rep.id] && performanceMetrics.map((metric) => (
                                                    <div key={metric} className="grid grid-cols-2 items-center gap-2">
                                                        <Label htmlFor={`achievement-${rep.id}-${metric}`} className="text-right">
                                                            {tMetric(metric)}
                                                        </Label>
                                                        <Input
                                                            id={`achievement-${rep.id}-${metric}`}
                                                            type="number"
                                                            value={editingRepTotals[rep.id]?.[metric] || ''}
                                                            onChange={(e) => handleAchievementChange(rep.id, metric, e.target.value)}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                            </Accordion>
                            </ScrollArea>
                            <DialogFooter>
                                <Button onClick={onSaveAchievements} disabled={isSaving}>
                                {isSaving ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="mr-2 h-4 w-4" />
                                )}
                                {tDialog('saveChanges')}
                                </Button>
                            </DialogFooter>
                            </DialogContent>
                        </Dialog>
                        
                        <AIAssistantDialog
                            dailyData={latestData}
                            monthlyTarget={monthlyTargets}
                            >
                            <SidebarMenuItem>
                                <SidebarMenuButton>
                                    <Bot />
                                    <span>{t('aiAssistant')}</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                        </AIAssistantDialog>
                        <SidebarMenuItem>
                                <SidebarMenuButton onClick={handleOpenEditShop}>
                                    <Edit />
                                    <span>{t('editShop')}</span>
                                </SidebarMenuButton>
                            </SidebarMenuItem>
                    </>
                )}
            </SidebarMenu>
            
            <ManageShopsDialog
                isManagementDialogOpen={isManagementDialogOpen}
                onManagementDialogChange={(open) => {
                    if (!open) setEditingShop(null);
                    setIsManagementDialogOpen(open);
                }}
                editingShop={editingShop}
                setEditingShop={setEditingShop}
                onSave={handleSaveShop}
                onDelete={handleDeleteShop}
            />
        </>
    );
}

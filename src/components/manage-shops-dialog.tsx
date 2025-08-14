
"use client";

import { useState, type ReactNode, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    DialogClose
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { PlusCircle, Trash2, Edit } from "lucide-react";
import { useShop } from "./shop-provider";
import { type Shop, type SalesRepresentative } from "@/lib/types";
import { Card, CardContent } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTranslations } from "next-intl";

type ManageShopsDialogProps = {
    children?: ReactNode; // Allow children to be optional
    isManagementDialogOpen: boolean;
    onManagementDialogChange: (open: boolean) => void;
    editingShop: Shop | null;
    setEditingShop: (shop: Shop | null) => void;
    onSave: (shop: Shop) => void;
    onDelete: (shopId: string) => void;
};

export function ManageShopsDialog({ 
    isManagementDialogOpen,
    onManagementDialogChange,
    editingShop,
    setEditingShop,
    onSave,
    onDelete
}: ManageShopsDialogProps) {
    const { shops, addShop, loading } = useShop();
    const t = useTranslations("Dialogs");
    const [newShopName, setNewShopName] = useState("");
    const [newShopDescription, setNewShopDescription] = useState("");
    
    // Internal state for the form, initialized from props
    const [currentEditingShop, setCurrentEditingShop] = useState<Shop | null>(null);

    useEffect(() => {
        // Sync internal state when the prop changes
        setCurrentEditingShop(editingShop);
    }, [editingShop]);

    const handleCancelEdit = () => {
        setEditingShop(null); // Clear parent state
        onManagementDialogChange(false); // Close dialog
    };

    const handleSaveShop = async () => {
        if (currentEditingShop) {
            onSave(currentEditingShop);
            handleCancelEdit();
        }
    };

    const handleAddShop = async () => {
        if (newShopName.trim()) {
            try {
                await addShop(newShopName.trim(), newShopDescription.trim());
                setNewShopName("");
                setNewShopDescription("");
                onManagementDialogChange(false);
            } catch (error) {
                console.error("Error in handleAddShop:", error);
            }
        }
    };

    const handleSalesRepresentativeChange = (index: number, value: string) => {
        if (currentEditingShop) {
            const updatedSalesRepresentatives = [...(currentEditingShop.salesRepresentatives || [])];
            updatedSalesRepresentatives[index] = {...updatedSalesRepresentatives[index], name: value};
            setCurrentEditingShop({ ...currentEditingShop, salesRepresentatives: updatedSalesRepresentatives });
        }
    };

    const handleAddSalesRepresentative = () => {
        if (currentEditingShop) {
            const newRep: SalesRepresentative = { id: `rep${Date.now()}`, name: "" };
            const salesRepresentatives = currentEditingShop.salesRepresentatives ? [...currentEditingShop.salesRepresentatives, newRep] : [newRep];
            setCurrentEditingShop({ ...currentEditingShop, salesRepresentatives });
        }
    };

    const handleRemoveSalesRepresentative = (index: number) => {
        if (currentEditingShop && currentEditingShop.salesRepresentatives) {
            const updatedSalesRepresentatives = currentEditingShop.salesRepresentatives.filter((_, i) => i !== index);
            setCurrentEditingShop({ ...currentEditingShop, salesRepresentatives: updatedSalesRepresentatives });
        }
    };

    const handleDeleteShop = (shopId: string) => {
        onDelete(shopId);
    };
    
    return (
        <Dialog open={isManagementDialogOpen} onOpenChange={onManagementDialogChange}>
            <DialogContent className="sm:max-w-2xl">
                {currentEditingShop ? (
                    <>
                         <DialogHeader>
                            <DialogTitle>{t('editShopTitle', {shopName: currentEditingShop.name})}</DialogTitle>
                            <DialogDescription>{t('editShopDescription', {shopName: currentEditingShop.name})}</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                            <div className="space-y-2">
                                <Label htmlFor="shop-name">{t('shopName')}</Label>
                                <Input
                                    id="shop-name"
                                    value={currentEditingShop.name}
                                    onChange={(e) => setCurrentEditingShop({ ...currentEditingShop, name: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="shop-description">{t('description')}</Label>
                                <Textarea
                                    id="shop-description"
                                    placeholder={t('shopDescriptionPlaceholder')}
                                    value={currentEditingShop.description || ''}
                                    onChange={(e) => setCurrentEditingShop({ ...currentEditingShop, description: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <div className="flex justify-between items-center mb-2">
                                    <Label>{t('salesReps')}</Label>
                                    <Button size="sm" variant="outline" onClick={handleAddSalesRepresentative}><PlusCircle className="mr-2 h-4 w-4" />{t('add')}</Button>
                                </div>
                                <ScrollArea className="h-40 rounded-md border p-2">
                                    <div className="space-y-2">
                                        {(currentEditingShop.salesRepresentatives || []).length > 0 ? (
                                            currentEditingShop.salesRepresentatives?.map((salesRepresentative, index) => (
                                                <div key={salesRepresentative.id} className="flex items-center gap-2">
                                                    <Input
                                                        value={salesRepresentative.name}
                                                        onChange={(e) => handleSalesRepresentativeChange(index, e.target.value)}
                                                        placeholder={`Sales Representative #${index + 1}`}
                                                    />
                                                    <Button variant="ghost" size="icon" onClick={() => handleRemoveSalesRepresentative(index)}>
                                                        <Trash2 className="h-4 w-4 text-destructive" />
                                                    </Button>
                                                </div>
                                            ))
                                        ) : (
                                            <p className="text-sm text-muted-foreground text-center py-4">{t('noSalesReps')}</p>
                                        )}
                                    </div>
                                 </ScrollArea>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={handleCancelEdit}>{t('cancel')}</Button>
                            <Button onClick={handleSaveShop}>{t('saveChanges')}</Button>
                        </DialogFooter>
                    </>
                ) : (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t('manageShopsTitle')}</DialogTitle>
                            <DialogDescription>
                                {t('manageShopsDescription')}
                            </DialogDescription>
                        </DialogHeader>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                            <div className="space-y-4">
                                 <h3 className="font-semibold">{t('allShops')}</h3>
                                 <ScrollArea className="h-72">
                                    <div className="space-y-2 pr-4">
                                    {shops.map((shop) => (
                                        <Card key={shop.id}>
                                            <CardContent className="p-3 flex justify-between items-center">
                                                <div>
                                                    <p className="font-semibold">{shop.name}</p>
                                                    <p className="text-sm text-muted-foreground">{shop.description}</p>
                                                </div>
                                                <div className="flex items-center gap-1">
                                                    <Button variant="ghost" size="icon" onClick={() => setEditingShop(shop)}>
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <AlertDialog>
                                                      <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                      </AlertDialogTrigger>
                                                      <AlertDialogContent>
                                                        <AlertDialogHeader>
                                                          <AlertDialogTitle>{t('deleteConfirmationTitle')}</AlertDialogTitle>
                                                          <AlertDialogDescription>
                                                            {t('deleteConfirmationDescription')}
                                                          </AlertDialogDescription>
                                                        </AlertDialogHeader>
                                                        <AlertDialogFooter>
                                                          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                                                          <AlertDialogAction onClick={() => handleDeleteShop(shop.id)}>{t('continue')}</AlertDialogAction>
                                                        </AlertDialogFooter>
                                                      </AlertDialogContent>
                                                    </AlertDialog>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    ))}
                                    </div>
                                 </ScrollArea>
                            </div>
                            <div className="space-y-4">
                                 <h3 className="font-semibold">{t('addNewShop')}</h3>
                                 <div className="space-y-2">
                                    <Label htmlFor="new-shop-name">{t('shopName')}</Label>
                                    <Input
                                        id="new-shop-name"
                                        value={newShopName}
                                        onChange={(e) => setNewShopName(e.target.value)}
                                        placeholder={t('newShopNamePlaceholder')}
                                    />
                                 </div>
                                 <div className="space-y-2">
                                    <Label htmlFor="new-shop-description">{t('description')}</Label>
                                    <Textarea
                                        id="new-shop-description"
                                        value={newShopDescription}
                                        onChange={(e) => setNewShopDescription(e.target.value)}
                                        placeholder={t('newShopDescriptionPlaceholder')}
                                    />
                                 </div>
                                 <Button 
                                    onClick={handleAddShop} 
                                    className="w-full" 
                                    disabled={!newShopName.trim() || loading}
                                >
                                    <PlusCircle className="mr-2 h-4 w-4" /> 
                                    {loading ? t('adding') : t('addShop')}
                                </Button>
                            </div>
                        </div>
                        <DialogFooter>
                            <DialogClose asChild>
                                <Button type="button" variant="secondary">{t('close')}</Button>
                            </DialogClose>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

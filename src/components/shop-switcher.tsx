
"use client";

import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShop } from "./shop-provider";
import { type Shop } from "@/lib/types";
import { useTranslations } from "next-intl";

type ShopSwitcherProps = {
  shops: Shop[];
};

export function ShopSwitcher({ shops }: ShopSwitcherProps) {
  const { selectedShop, setSelectedShop } = useShop();
  const [open, setOpen] = useState(false);
  const t = useTranslations("Misc");

  const handleSelectShop = (shop: Shop) => {
    setSelectedShop(shop);
    setOpen(false);
  };

  if (!shops || shops.length === 0) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[200px] justify-between"
        >
          <Store className="mr-2 h-4 w-4" />
          {selectedShop?.name || "Select a shop"}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder={t('searchShop')} />
          <CommandList>
            <CommandEmpty>{t('noShopFound')}</CommandEmpty>
            <CommandGroup>
              {shops.map((shop) => (
                <CommandItem
                  key={shop.id}
                  onSelect={() => handleSelectShop(shop)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedShop?.id === shop.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {shop.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

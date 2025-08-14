
"use client";
import { DetailedDashboardClient } from "@/components/detailed-dashboard-client";
import { useShop } from "@/components/shop-provider";
import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function DetailedDashboardPage() {
  const params = useParams();
  const shopId = params.shopId as string;
  const { shops, selectedShop, setSelectedShop } = useShop();
  const locale = useLocale();
  const t = useTranslations("DetailedDashboard");

  useEffect(() => {
    const shopFromParams = shops.find((s) => s.id === shopId);
    if (shopFromParams && selectedShop?.id !== shopFromParams.id) {
      setSelectedShop(shopFromParams);
    }
  }, [shops, shopId, selectedShop, setSelectedShop]);


  if (!selectedShop || selectedShop.id !== shopId) {
    // This can show a loading state or null while the correct shop is being set.
    return (
        <div className="flex h-full flex-col p-4 md:p-6 lg:p-8">
             <Link href={`/${locale}/`} className={cn(buttonVariants({ variant: "outline" }), "mb-4 w-fit")}>
                <ArrowLeft className="mr-2" /> {t('backToOverview')}
            </Link>
            <div className="flex flex-1 items-center justify-center">
                <p>{t('shopNotFound')}</p>
            </div>
        </div>
    );
  }

  return <DetailedDashboardClient />;
}


import { getMessages, getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { AppLayout } from "@/components/app-layout";
import { ShopProvider } from "@/components/shop-provider";
import { QueryProvider } from "@/components/query-provider";
import { fetchAccessProfile, fetchShopData } from "@/app/actions";

type Props = {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
  }>;
};

export default async function LocaleLayout({
  children,
  params,
}: Props) {
   const { locale } = await params;
   let messages;
   try {
     messages = await getMessages({locale});
   } catch (error) {
     redirect('/en');
   }
   let initialShopData;
   let actor;
   try {
     [initialShopData, actor] = await Promise.all([fetchShopData(), fetchAccessProfile()]);
   } catch {
     redirect('/login');
   }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <QueryProvider>
        <ShopProvider initialData={initialShopData} actor={actor}>
          <AppLayout>{children}</AppLayout>
        </ShopProvider>
      </QueryProvider>
    </NextIntlClientProvider>
  );
}

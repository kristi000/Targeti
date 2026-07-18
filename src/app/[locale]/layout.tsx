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
   let actor;
   try {
     actor = await fetchAccessProfile();
   } catch {
     redirect('/login');
   }
   let initialShopData;
   try {
     initialShopData = await fetchShopData();
   } catch (error) {
     console.error("Could not load application data:", error);
     redirect('/login?error=database');
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

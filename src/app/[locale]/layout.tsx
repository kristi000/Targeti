import { getMessages, getLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { AppLayout } from "@/components/app-layout";
import { ShopProvider } from "@/components/shop-provider";
import { fetchShopData } from "@/app/actions";

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
   const initialShopData = await fetchShopData();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ShopProvider initialData={initialShopData}>
        <AppLayout>{children}</AppLayout>
      </ShopProvider>
    </NextIntlClientProvider>
  );
}

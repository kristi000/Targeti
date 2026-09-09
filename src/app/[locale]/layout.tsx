import { getMessages, getLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { ClientApplication } from "@/components/client-application";

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
     messages = await getMessages({ locale: "en" });
   }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ClientApplication>{children}</ClientApplication>
    </NextIntlClientProvider>
  );
}

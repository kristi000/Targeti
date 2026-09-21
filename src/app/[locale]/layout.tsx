import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getMessages } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { AppLayout, AppShellFallback } from "@/components/app-layout";
import { QueryProvider } from "@/components/query-provider";
import { ShopProvider } from "@/components/shop-provider";
import { getCurrentActor } from "@/lib/access";
import { getShopDirectory } from "@/lib/server/dashboard-loaders";

type Props = {
  children: ReactNode;
  params: Promise<{
    locale: string;
  }>;
};

async function AuthenticatedApplication({
  children,
  locale,
}: {
  children: ReactNode;
  locale: string;
}) {
  let actor;
  try {
    actor = await getCurrentActor();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      redirect(`/login?next=/${locale}`);
    }
    throw error;
  }

  const initialData = await getShopDirectory();

  return (
    <QueryProvider>
      <ShopProvider initialData={initialData} actor={actor}>
        <AppLayout>{children}</AppLayout>
      </ShopProvider>
    </QueryProvider>
  );
}

export default async function LocaleLayout({
  children,
  params,
}: Props) {
   const { locale } = await params;
   let messages;
   try {
     messages = await getMessages({locale});
   } catch {
     messages = await getMessages({ locale: "en" });
   }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <Suspense fallback={<AppShellFallback />}>
        <AuthenticatedApplication locale={locale}>
          {children}
        </AuthenticatedApplication>
      </Suspense>
    </NextIntlClientProvider>
  );
}

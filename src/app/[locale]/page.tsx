
import { DashboardClient } from "@/components/dashboard-client";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({params: {locale}}: {params: {locale: string}}) {
  const t = await getTranslations({locale, namespace: 'Metadata'});
 
  return {
    title: t('title'),
    description: t('description')
  };
}


export default function DashboardPage() {
  return (
    <DashboardClient />
  );
}

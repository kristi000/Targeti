import { redirect } from "next/navigation";

export default async function QuarterlyBonusPage({ params }: { params: Promise<{ locale: string; shopId: string }> }) {
  const { locale, shopId } = await params;
  redirect(`/${locale}/shop/${shopId}/bonus?view=quarterly`);
}

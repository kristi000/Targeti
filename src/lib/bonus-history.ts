import type { BonusSnapshot, QuarterlyBonusSnapshot } from "@/lib/types";
import type { getMonthlyBonusForecast } from "@/lib/forecast";
import type { calculateQuarterlyBonus } from "@/lib/quarterly-bonus";

export type BonusHistoryPerson = { id: string; name: string; role: "manager" | "representative"; amount: number };
export type BonusHistoryRecord = {
  period: string;
  payoutMonth: string;
  finalizedAt: string;
  total: number;
  people: BonusHistoryPerson[];
};
export type BonusHistoryMonth = {
  month: string;
  monthly: BonusHistoryRecord | null;
  quarterly: BonusHistoryRecord | null;
  prediction?: BonusHistoryPrediction;
  quarterPrediction?: BonusHistoryPrediction;
};
export type BonusHistoryPrediction = { asOfDate: string; total: number; people: BonusHistoryPerson[] };
export type BonusHistoryCursor = { month?: string; quarter?: string };

export function quarterlyPayoutMonth(quarter: string) {
  const [, year, number] = /^(\d{4})-Q([1-4])$/.exec(quarter) ?? [];
  return year ? `${year}-${String(Number(number) * 3).padStart(2, "0")}` : "";
}

export function monthlyHistoryRecord(snapshot: BonusSnapshot): BonusHistoryRecord | null {
  if (!Number.isFinite(snapshot.manager.totalBonus) || snapshot.representatives.some(item => !Number.isFinite(item.result.totalBonus))) return null;
  const people: BonusHistoryPerson[] = [
    { id: "manager", name: "", role: "manager", amount: snapshot.manager.totalBonus },
    ...snapshot.representatives.map(item => ({ id: `rep:${item.id}`, name: item.name, role: "representative" as const, amount: item.result.totalBonus })),
  ];
  return { period: snapshot.month, payoutMonth: snapshot.month, finalizedAt: snapshot.finalizedAt, total: people.reduce((sum, person) => sum + person.amount, 0), people };
}

export function quarterlyHistoryRecord(snapshot: QuarterlyBonusSnapshot): BonusHistoryRecord {
  return {
    period: snapshot.quarter,
    payoutMonth: quarterlyPayoutMonth(snapshot.quarter),
    finalizedAt: snapshot.finalizedAt,
    total: snapshot.result.totalBonus,
    people: [
      { id: "manager", name: "", role: "manager", amount: snapshot.result.manager.totalBonus },
      ...snapshot.result.representatives.map(item => ({ id: `rep:${item.id}`, name: item.name, role: "representative" as const, amount: item.totalBonus })),
    ],
  };
}

export function bonusHistoryPersonAmount(row: BonusHistoryMonth, id: string) {
  const amount = (record: { people: BonusHistoryPerson[] } | null | undefined) => record?.people.find(person => person.id === id)?.amount ?? 0;
  return { monthly: amount(row.monthly ?? row.prediction), quarterly: amount(row.quarterly ?? row.quarterPrediction) };
}

export function monthlyPredictionRecord(forecast: NonNullable<ReturnType<typeof getMonthlyBonusForecast>>): BonusHistoryPrediction {
  const people: BonusHistoryPerson[] = [
    { id: "manager", name: "", role: "manager", amount: forecast.manager.totalBonus },
    ...forecast.representatives.map(item => ({ id: `rep:${item.id}`, name: item.name, role: "representative" as const, amount: item.result.totalBonus })),
  ];
  return { asOfDate: forecast.asOfDate.toISOString(), total: people.reduce((sum, person) => sum + person.amount, 0), people };
}

export function quarterlyPredictionRecord(result: ReturnType<typeof calculateQuarterlyBonus>, asOfDate: Date): BonusHistoryPrediction {
  return {
    asOfDate: asOfDate.toISOString(),
    total: result.totalBonus,
    people: [
      { id: "manager", name: "", role: "manager", amount: result.manager.totalBonus },
      ...result.representatives.map(item => ({ id: `rep:${item.id}`, name: item.name, role: "representative" as const, amount: item.totalBonus })),
    ],
  };
}

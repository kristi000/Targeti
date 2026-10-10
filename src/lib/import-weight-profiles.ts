import { attendanceMonthSchema } from "@/lib/persistence-schemas";
import { getQuarterKey, type MetricWeightProfile, type Shop } from "@/lib/types";

type ProfileConfiguration = Pick<MetricWeightProfile, "name" | "year" | "quarter" | "group">;
type Quarter = NonNullable<MetricWeightProfile["quarter"]>;

const normalizeGroup = (group?: string) => group?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? "";

export function getWeightProfileImportConfiguration(profile: ProfileConfiguration): {
  year: number | null;
  quarter: Quarter | null;
  group?: string;
} {
  if (profile.year !== undefined || profile.quarter !== undefined) {
    return { year: profile.year ?? null, quarter: profile.quarter ?? null, group: profile.group };
  }
  // Infer old profiles only until their period and group are saved explicitly.
  const name = profile.name.trim().replace(/\s+/g, " ");
  const match = /^(?:(.+) )?q([1-4]) (\d{4})$/i.exec(name);
  return {
    year: match ? Number(match[3]) : null,
    quarter: match ? Number(match[2]) as Quarter : null,
    group: profile.group ?? match?.[1],
  };
}

export function getWeightProfilePeriodKey(profile: ProfileConfiguration): string | undefined {
  const period = getWeightProfileImportConfiguration(profile);
  return period.year !== null && period.quarter !== null
    ? `${period.year}-Q${period.quarter}:${normalizeGroup(period.group)}`
    : undefined;
}

export function getImportWeightProfile(
  profiles: readonly MetricWeightProfile[],
  shop: Pick<Shop, "weightProfileId"> | undefined,
  month: string,
): MetricWeightProfile | undefined {
  if (!attendanceMonthSchema.safeParse(month).success) return undefined;
  const quarter = getQuarterKey(month);
  const assigned = profiles.find(profile => profile.id === shop?.weightProfileId);
  const assignedPeriod = assigned && getWeightProfileImportConfiguration(assigned);
  const periodMatches = (profile: ProfileConfiguration) => {
    const period = getWeightProfileImportConfiguration(profile);
    return `${period.year}-Q${period.quarter}` === quarter;
  };
  if (assigned && periodMatches(assigned)) return assigned;

  const assignedGroup = normalizeGroup(assignedPeriod?.group);
  if (assignedGroup) {
    const familyMatches = profiles.filter(profile => {
      const period = getWeightProfileImportConfiguration(profile);
      return periodMatches(profile) && normalizeGroup(period.group) === assignedGroup;
    });
    if (familyMatches.length) return familyMatches.length === 1 ? familyMatches[0] : undefined;
  }

  const sharedMatches = profiles.filter(profile => {
    const period = getWeightProfileImportConfiguration(profile);
    return periodMatches(profile) && !normalizeGroup(period.group);
  });
  if (sharedMatches.length) return sharedMatches.length === 1 ? sharedMatches[0] : undefined;
  return assignedPeriod?.year !== null && assignedPeriod?.year !== undefined ? undefined : assigned;
}

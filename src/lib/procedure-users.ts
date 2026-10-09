import type { ProcedureSummary } from "@/lib/procedures";
import type { SalesRepresentative } from "@/lib/types";

const nameTokens = (name: string) => name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function resolveProcedureUserName(user: string, representatives: readonly SalesRepresentative[]): string {
  const tokens = nameTokens(user);
  if (!tokens.length) return user;
  const key = tokens.join("\0");
  const matches = representatives.filter(representative => {
    const rosterTokens = nameTokens(representative.name);
    if (!rosterTokens.length) return false;
    return key === rosterTokens.join("\0")
      || (rosterTokens.length > 1 && key === [...rosterTokens, ...rosterTokens.slice(1)].join("\0"))
      || (tokens.length === 1 && tokens[0] === rosterTokens[0]);
  });
  // Historical or ambiguous names remain intact rather than being assigned to another person.
  return matches.length === 1 ? matches[0].name : user;
}

export function groupProcedureUserTotals(userTotals: NonNullable<ProcedureSummary["userTotals"]>, representatives: readonly SalesRepresentative[]) {
  const totals = new Map<string, number>();
  for (const item of userTotals) {
    const user = resolveProcedureUserName(item.user, representatives);
    totals.set(user, (totals.get(user) ?? 0) + item.total);
  }
  return [...totals].map(([user, total]) => ({ user, total }));
}

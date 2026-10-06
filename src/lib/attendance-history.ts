import type { AttendanceEntry, AttendanceHistoryDetail, AttendanceStaff } from "@/lib/attendance";

export function attendanceDayCorrections(date: string, before: AttendanceEntry[], after: AttendanceEntry[], staff: AttendanceStaff[]): AttendanceHistoryDetail | null {
  const previous = new Map(before.map(entry => [entry.staffId, entry]));
  const next = new Map(after.map(entry => [entry.staffId, entry]));
  const names = new Map(staff.map(person => [person.id, person.name]));
  const changes = [...new Set([...previous.keys(), ...next.keys()])].flatMap(staffId => {
    const oldEntry = previous.get(staffId) ?? null;
    const newEntry = next.get(staffId) ?? null;
    if (oldEntry?.code === newEntry?.code && oldEntry?.note === newEntry?.note && oldEntry?.originalText === newEntry?.originalText) return [];
    return [{ staffId, name: names.get(staffId) ?? staffId, before: oldEntry, after: newEntry }];
  });
  return changes.length ? { kind: "day", date, changes } : null;
}

export function attendanceRosterCorrections(before: AttendanceStaff[], after: AttendanceStaff[]): AttendanceHistoryDetail | null {
  const previous = new Map(before.map(person => [person.id, person]));
  const next = new Map(after.map(person => [person.id, person]));
  const previousPositions = new Map(before.map((person, index) => [person.id, index + 1]));
  const nextPositions = new Map(after.map((person, index) => [person.id, index + 1]));
  const changes = [...new Set([...previous.keys(), ...next.keys()])].flatMap(id => {
    const oldPerson = previous.get(id) ?? null;
    const newPerson = next.get(id) ?? null;
    const beforePosition = previousPositions.get(id);
    const afterPosition = nextPositions.get(id);
    const moved = Boolean(oldPerson && newPerson && beforePosition !== afterPosition);
    if (oldPerson?.name === newPerson?.name && oldPerson?.role === newPerson?.role && !moved) return [];
    return [{ before: oldPerson, after: newPerson, ...(moved ? { beforePosition, afterPosition } : {}) }];
  });
  return changes.length ? { kind: "roster", changes } : null;
}

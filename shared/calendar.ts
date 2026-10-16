/** Keep every department/federation slot when several share the same date. */
export function groupSlotsByDate<T extends { slot: { date: string } }>(entries: T[]) {
  const byDate = new Map<string, T[]>();
  for (const entry of entries) {
    const day = byDate.get(entry.slot.date) ?? [];
    day.push(entry);
    byDate.set(entry.slot.date, day);
  }
  return byDate;
}

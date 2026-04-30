/** Normalize tag name for cross-ledger dedup in family cluster views. */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

export interface TagWithLedger {
  id: string;
  name: string;
  color: string;
  exclude_from_stats: boolean;
  ledger_id: string;
}

export interface MergedTagGroup {
  /** Stable key for React */
  key: string;
  /** Display label (first occurrence's casing) */
  displayName: string;
  members: TagWithLedger[];
}

/**
 * Buckets tags from multiple ledgers that share the same normalized name
 * for dashboard-style display (one chip, batch manual exclude).
 */
export function mergeTagsByNormalizedName(tags: TagWithLedger[]): MergedTagGroup[] {
  const map = new Map<string, TagWithLedger[]>();
  for (const t of tags) {
    const k = normalizeTagName(t.name);
    if (!k) continue;
    const arr = map.get(k) || [];
    arr.push(t);
    map.set(k, arr);
  }
  const out: MergedTagGroup[] = [];
  for (const [key, members] of map) {
    members.sort((a, b) => a.name.localeCompare(b.name) || a.ledger_id.localeCompare(b.ledger_id));
    out.push({
      key,
      displayName: members[0]?.name ?? key,
      members,
    });
  }
  out.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return out;
}

/** Ids that participate in manual exclude toggle (not server-default-excluded). */
export function togglableTagIds(group: MergedTagGroup): string[] {
  return group.members.filter((m) => !m.exclude_from_stats).map((m) => m.id);
}

export function allTogglableManuallyExcluded(group: MergedTagGroup, manualExcludeTagIds: string[]): boolean {
  const ids = togglableTagIds(group);
  if (ids.length === 0) return false;
  return ids.every((id) => manualExcludeTagIds.includes(id));
}

export function everyMemberDefaultExcluded(group: MergedTagGroup): boolean {
  return group.members.length > 0 && group.members.every((m) => m.exclude_from_stats);
}

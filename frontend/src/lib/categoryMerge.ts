/**
 * Merge categories across ledgers (e.g. family + linked personals) that share the same
 * bilingual names and type, so filter dropdowns show one row per logical category.
 */

export interface CategoryMergeSource {
  id: string;
  name: string;
  name_zh?: string;
  name_en?: string;
  type: string;
}

export function semanticCategoryKey(c: CategoryMergeSource): string {
  return `${c.type}\t${(c.name_zh || '').trim()}\t${(c.name_en || '').trim()}`;
}

/** Map merge key → all category UUIDs in the cluster + one representative row. */
export function groupCategoriesBySemanticKey(
  categories: CategoryMergeSource[],
): Map<string, { ids: string[]; rep: CategoryMergeSource }> {
  const out = new Map<string, { ids: string[]; rep: CategoryMergeSource }>();
  for (const c of categories) {
    const key = semanticCategoryKey(c);
    const cur = out.get(key);
    if (!cur) {
      out.set(key, { ids: [c.id], rep: c });
    } else {
      cur.ids.push(c.id);
    }
  }
  return out;
}

/** Stats row from dashboard/project summary `category_stats`. */
export interface CategoryStatRow {
  name: string;
  name_zh?: string;
  name_en?: string;
  category_id?: string;
  value: number;
  color: string;
}

export interface MergedCategoryStat extends CategoryStatRow {
  category_ids: string[];
}

function fallbackExpenseSemanticKey(row: CategoryStatRow): string {
  return `expense\t${(row.name_zh || '').trim()}\t${(row.name_en || '').trim()}`;
}

/**
 * Merge category_stats rows that share the same semantic category (across linked ledgers).
 * Picks color/name from the row with the largest single contribution; `category_ids` lists
 * every physical category id for drill-down.
 */
export function mergeCategoryStatsForPie(
  stats: CategoryStatRow[],
  categories: CategoryMergeSource[],
): MergedCategoryStat[] {
  const semanticGroups = groupCategoriesBySemanticKey(categories);
  const idToKey = new Map<string, string>();
  const keyToClusterIds = new Map<string, string[]>();
  for (const [, v] of semanticGroups) {
    const key = semanticCategoryKey(v.rep);
    keyToClusterIds.set(key, [...v.ids]);
    for (const id of v.ids) {
      idToKey.set(id, key);
    }
  }

  type Bucket = { value: number; best: CategoryStatRow; ids: Set<string> };
  const buckets = new Map<string, Bucket>();

  for (const row of stats) {
    const cid = row.category_id?.trim();
    let key = cid ? idToKey.get(cid) : undefined;
    if (!key) key = fallbackExpenseSemanticKey(row);

    let b = buckets.get(key);
    const clusterIds = keyToClusterIds.get(key);
    if (!b) {
      const initial = new Set<string>();
      if (clusterIds?.length) {
        clusterIds.forEach((id) => initial.add(id));
      } else if (cid) {
        initial.add(cid);
      }
      b = { value: 0, best: row, ids: initial };
      buckets.set(key, b);
    }
    b.value += row.value;
    if (row.value > b.best.value) {
      b.best = row;
    }
    if (cid) {
      b.ids.add(cid);
    }
  }

  const out: MergedCategoryStat[] = [];
  for (const b of buckets.values()) {
    const category_ids = [...b.ids];
    out.push({
      name: b.best.name,
      name_zh: b.best.name_zh,
      name_en: b.best.name_en,
      category_id: category_ids[0],
      category_ids,
      value: b.value,
      color: b.best.color,
    });
  }
  return out.sort((a, b) => b.value - a.value);
}

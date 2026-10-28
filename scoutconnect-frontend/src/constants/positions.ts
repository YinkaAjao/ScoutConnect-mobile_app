// src/constants/positions.ts
export const POSITION_CATEGORIES = {
  Goalkeeper: ['Goalkeeper'],
  Defender: ['Center Back', 'Left Fullback', 'Right Fullback', 'Left Wingback', 'Right Wingback'],
  Midfielder: ['Defensive Midfielder', 'Central Midfielder', 'Attacking Midfielder', 'Left Midfielder', 'Right Midfielder'],
  Forward: ['Left Winger', 'Right Winger', 'Striker / Center Forward'],
};

/**
 * Query-string fragment for a scout's position choice ('All', a category such as 'Defender', or 'Other').
 * Athletes are stored with specific positions ('Center Back'), but older records may hold the category name itself,
 * so a category matches both. 'Other' means everything outside the known categories.
 */
export const positionQueryFor = (selected: string): string => {
  if (selected === 'All') return '';
  const categories = POSITION_CATEGORIES as Record<string, string[]>;
  if (selected === 'Other') {
    const known = [...Object.keys(categories), ...Object.values(categories).flat()];
    return `excludePositions=${encodeURIComponent(known.join(','))}`;
  }
  const list = categories[selected];
  return list ? `positions=${encodeURIComponent([selected, ...list].join(','))}` : '';
};

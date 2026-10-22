/**
 * The five priority levels an owner can give a gift, and the only place their names live. The
 * owner and guest pages show the name, never the number.
 */
export interface PriorityLevel {
  value: number;
  name: string;
}

export const PRIORITY_LEVELS: readonly PriorityLevel[] = [
  { value: 1, name: "Nice to have" },
  { value: 2, name: "Would like" },
  { value: 3, name: "Want" },
  { value: 4, name: "Really want" },
  { value: 5, name: "Would love" },
];

/**
 * Names a stored priority. A value outside 1 to 5 is clamped to the nearest level, so a stray
 * number never renders as blank or as a digit. Only the web clamps; the Gateway serves the stored
 * number.
 */
export function priorityLevelName(priority: number): string {
  const lowest = PRIORITY_LEVELS[0];
  const highest = PRIORITY_LEVELS[PRIORITY_LEVELS.length - 1];
  const clamped = Math.min(
    highest.value,
    Math.max(lowest.value, Math.round(priority)),
  );
  return PRIORITY_LEVELS[clamped - 1].name;
}

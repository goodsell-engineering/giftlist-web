import { Badge, VisuallyHidden } from "@mantine/core";

import { priorityLevelName } from "./priorityLevels";

/**
 * Read-only badge naming an item's priority. One neutral style for every level, so it is never
 * mistaken for the reservation badges. Text content is "Priority: <level name>".
 */
export function PriorityBadge({ priority }: { priority: number }) {
  return (
    <Badge variant="light" color="gray" tt="none" mt={4}>
      <VisuallyHidden component="span">Priority: </VisuallyHidden>
      {priorityLevelName(priority)}
    </Badge>
  );
}

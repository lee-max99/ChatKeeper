/** Several rendered elements may represent the same logical message. */
export function uniqueMessageIds(ids: string[]): string[] {
  return [...new Set(ids.filter(id => id.length > 0))];
}

/** Each group contains only exact aliases supplied by the saved conversation. */
export function matchesMessagePath(path: string[][], visibleIds: string[]): boolean {
  let last = -1;
  for (const id of uniqueMessageIds(visibleIds)) {
    // A node ID and its message ID may both occur in the rendered markup.
    const index = path.findIndex((aliases, index) => index >= last && aliases.includes(id));
    if (index < 0) return false;
    last = index;
  }
  return true;
}

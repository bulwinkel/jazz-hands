/** The text of a thrown value, for a message on screen: an Error's message, or the value as a string. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

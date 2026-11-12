/** Small helpers for the page. */

/** The element that matches `selector`. Throws when the page has none: the markup is then wrong. */
export function find<T extends HTMLElement>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

/**
 * True for a click that a pointing hand made. A choice made by hand is a click made by the
 * page (see `GameUI.chooseHandTarget`), which the browser marks as not trusted.
 */
export function isHandClick(event: Event): boolean {
  return !event.isTrusted;
}

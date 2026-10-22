/**
 * Elements under `root` whose whole text content is exactly `text`. A function matcher on
 * `textContent` is needed where a visually hidden prefix splits the text across elements, which
 * `getByText` cannot see.
 */
export function elementsWithExactTextContent(
  root: Element,
  text: string,
): Element[] {
  return Array.from(root.querySelectorAll("*")).filter(
    (element) => element.textContent === text,
  );
}

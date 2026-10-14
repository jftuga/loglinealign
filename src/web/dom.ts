/** Look up required interface elements by ID. A missing element is a build or template error, so it fails immediately. */
export function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing interface element: ${id}`);
  return found as T;
}

/** Accept file drops throughout the interface while leaving text dragging alone. A single document drop handler prevents duplicate additions and clears the temporary overlay after completion or cancellation. */
export function initializeFileDrop(overlay: HTMLElement, onFiles: (files: FileList) => void): void {
  let depth = 0;
  const reset = (): void => { depth = 0; overlay.hidden = true; };
  document.addEventListener('dragenter', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    depth++;
    overlay.hidden = false;
  });
  document.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    overlay.hidden = false;
  });
  document.addEventListener('dragleave', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    depth = Math.max(0, depth - 1);
    if (!depth) reset();
  });
  document.addEventListener('drop', event => {
    reset();
    if (!event.dataTransfer?.files.length) return;
    event.preventDefault();
    onFiles(event.dataTransfer.files);
  });
  document.addEventListener('dragend', reset);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') reset(); });
  window.addEventListener('blur', reset);
}

/** Ask for confirmation in a modal page dialog. Escape, Cancel, or closing the dialog declines; Cancel has initial focus so a stray Enter is safe. */
import { element } from './dom';

export function confirmAction(message: string, action: string): Promise<boolean> {
  const dialog = element<HTMLDialogElement>('confirm-dialog');
  element('confirm-message').textContent = message;
  const accept = element<HTMLButtonElement>('confirm-accept');
  accept.textContent = action;
  accept.onclick = () => dialog.close('confirm');
  element<HTMLButtonElement>('confirm-cancel').onclick = () => dialog.close('cancel');
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

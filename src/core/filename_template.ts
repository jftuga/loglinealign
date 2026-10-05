/** Validate filename templates and expand them from one supplied local-time instant in either interface. */
import { tokenizeDateFormat } from './date_format';

export const defaultFilenameTemplate = 'merge--%Y%m%d.%H%M%S.log';

export function validateFilenameTemplate(template: string): void {
  tokenizeDateFormat(template, 'filename');
}

export function expandFilenameTemplate(template: string, date: Date): string {
  const tokens = tokenizeDateFormat(template, 'filename');
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date for filename template.');
  const offset = -date.getTimezoneOffset();
  const offsetMinutes = Math.abs(offset);
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  const values: Record<string, string> = {
    '%Y': String(date.getFullYear()).padStart(4, '0'),
    '%m': String(date.getMonth() + 1).padStart(2, '0'),
    '%d': String(date.getDate()).padStart(2, '0'),
    '%H': String(date.getHours()).padStart(2, '0'),
    '%M': String(date.getMinutes()).padStart(2, '0'),
    '%S': String(date.getSeconds()).padStart(2, '0'),
    '%1N': milliseconds.slice(0, 1),
    '%2N': milliseconds.slice(0, 2),
    '%3N': milliseconds,
    '%z': `${offset < 0 ? '-' : '+'}${String(Math.floor(offsetMinutes / 60)).padStart(2, '0')}${String(offsetMinutes % 60).padStart(2, '0')}`,
    '%s': String(Math.floor(date.getTime() / 1000)),
  };
  return tokens.map(token => token.kind === 'literal' ? token.value : values[token.value]!).join('');
}

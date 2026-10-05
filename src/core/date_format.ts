/** Tokenize shared date specifiers, enforcing each feature's subset and expanding calendar and clock shorthands. */
export type DateFormatFeature = 'override' | 'filename';
export type DateFormatToken = { kind: 'literal' | 'specifier'; value: string };

const calendarSpecifiers = ['%Y', '%m', '%d', '%H', '%M', '%S', '%F'];
const fractionSpecifiers = Array.from({ length: 9 }, (_, index) => `%${index + 1}N`);
export const overrideSpecifiers: readonly string[] = [...calendarSpecifiers, '%T', ...fractionSpecifiers, '%N', '%z', '%:z', '%%'];
export const filenameSpecifiers: readonly string[] = [...calendarSpecifiers, ...fractionSpecifiers.slice(0, 3), '%z', '%s', '%%'];

export function tokenizeDateFormat(format: string, feature: DateFormatFeature): DateFormatToken[] {
  const allowed = feature === 'override' ? overrideSpecifiers : filenameSpecifiers;
  const tokens: DateFormatToken[] = [];
  let index = 0;
  while (index < format.length) {
    if (format[index] !== '%') {
      const next = format.indexOf('%', index);
      const end = next < 0 ? format.length : next;
      tokens.push({ kind: 'literal', value: format.slice(index, end) });
      index = end;
      continue;
    }
    // Read a percent sequence, including invalid colon/width forms, so errors name the whole specifier.
    const specifier = /^%(?::[^%]?|[0-9]+[^%]?|.)?/s.exec(format.slice(index))![0];
    if (!allowed.includes(specifier)) {
      const suggestion = feature === 'filename' && specifier === '%:z' ? ' Use %z instead.' : feature === 'filename' && specifier === '%T' ? ' Use %H%M%S instead.' : '';
      throw new Error(`Unsupported specifier ${specifier}; valid specifiers: ${allowed.join(' ')}.${suggestion}`);
    }
    if (specifier === '%F' || specifier === '%T') {
      tokens.push(...tokenizeDateFormat(specifier === '%F' ? '%Y-%m-%d' : '%H:%M:%S', feature));
    } else {
      tokens.push(specifier === '%%' ? { kind: 'literal', value: '%' } : { kind: 'specifier', value: specifier });
    }
    index += specifier.length;
  }
  return tokens;
}

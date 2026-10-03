/** Stable source colors shared by the terminal and browser. Colors repeat after the curated palette is exhausted. */
const palette = [
  { ansi: 81, css: '#5fd7ff' }, { ansi: 114, css: '#87d787' },
  { ansi: 215, css: '#ffaf5f' }, { ansi: 183, css: '#d7afff' },
  { ansi: 211, css: '#ff87af' }, { ansi: 159, css: '#afffff' },
  { ansi: 221, css: '#ffd75f' }, { ansi: 147, css: '#afafff' },
];

export function sourceColor(order: number): { ansi: number; css: string } {
  return palette[order % palette.length]!;
}

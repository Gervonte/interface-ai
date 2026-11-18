// JSON.parse alone silently overwrites duplicate keys, including escaped aliases.
export function parseRequestJson(text: string): unknown {
  const value: unknown = JSON.parse(text);
  let position = 0; let nodes = 0;
  const whitespace = () => { while (/\s/.test(text[position] ?? '') && position < text.length) position++; };
  const string = (): string => {
    const start = position++;
    while (position < text.length) {
      const character = text[position++];
      if (character === '\\') position++;
      else if (character === '"') return JSON.parse(text.slice(start, position)) as string;
    }
    throw new Error('INVALID_JSON');
  };
  const visit = (depth: number): void => {
    if (++nodes > 20_000 || depth > 24) throw new Error('INVALID_JSON'); whitespace();
    if (text[position] === '{') {
      position++; whitespace(); const names = new Set<string>();
      if (text[position] === '}') { position++; return; }
      while (position < text.length) {
        whitespace(); const key = string();
        if (names.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('INVALID_JSON'); names.add(key);
        whitespace(); position++; visit(depth + 1); whitespace();
        if (text[position++] === '}') return;
      }
    } else if (text[position] === '[') {
      position++; whitespace(); if (text[position] === ']') { position++; return; }
      while (position < text.length) { visit(depth + 1); whitespace(); if (text[position++] === ']') return; }
    } else if (text[position] === '"') { string(); return; }
    else { while (position < text.length && !/[\s,\]}]/.test(text[position]!)) position++; return; }
    throw new Error('INVALID_JSON');
  };
  visit(0); whitespace(); if (position !== text.length) throw new Error('INVALID_JSON'); return value;
}

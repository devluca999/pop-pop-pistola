const NAMED: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'SPC', Enter: 'ENT', Tab: 'TAB',
  ShiftLeft: 'SHF', ShiftRight: 'SHF', ControlLeft: 'CTL', ControlRight: 'CTL', AltLeft: 'ALT', AltRight: 'ALT',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'BKS', CapsLock: 'CAP',
};

/** Short keycap label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6, 7);
  return NAMED[code] ?? code.slice(0, 3).toUpperCase();
}

const PAD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SEL', 'STA', 'LS', 'RS', '↑', '↓', '←', '→', 'HOM'];
export function padLabel(button: number): string {
  return PAD[button] ?? `B${button}`;
}

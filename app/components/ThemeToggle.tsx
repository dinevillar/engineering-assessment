'use client';

import { useEffect, useState } from 'react';
import { IconMonitor, IconMoon, IconSun } from './icons.tsx';

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_KEY = 'review-theme';

/** Runs before first paint (inlined in <head>) so the saved theme never flashes. */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch { /* private mode: theme still applies for this page */ }
}

const OPTIONS: { value: ThemeChoice; label: string; Icon: typeof IconSun }[] = [
  { value: 'system', label: 'System theme', Icon: IconMonitor },
  { value: 'light', label: 'Light theme', Icon: IconSun },
  { value: 'dark', label: 'Dark theme', Icon: IconMoon },
];

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>('system');
  useEffect(() => {
    const attr = document.documentElement.getAttribute('data-theme');
    setChoice(attr === 'light' || attr === 'dark' ? attr : 'system');
  }, []);
  return (
    <div className="segmented" role="radiogroup" aria-label="Color theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" role="radio" aria-checked={choice === value} aria-label={label} title={label}
          onClick={() => { setChoice(value); apply(value); }}>
          <Icon size={15} />
        </button>
      ))}
    </div>
  );
}

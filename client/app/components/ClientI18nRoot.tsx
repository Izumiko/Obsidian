'use client';

import { useEffect } from 'react';

const SUPPORTED = ['en', 'es', 'zh'] as const;
const DEFAULT_LANG = 'es';

function detectLanguage(): string {
  try {
    const match = document.cookie.match(/(?:^|; )i18nextLng=([^;]+)/);
    const lng = match ? decodeURIComponent(match[1]) : '';
    if ((SUPPORTED as readonly string[]).includes(lng)) return lng;
  } catch {}
  const nav = (typeof navigator !== 'undefined' && navigator.language ? navigator.language : DEFAULT_LANG).toLowerCase().slice(0, 2);
  return (SUPPORTED as readonly string[]).includes(nav) ? nav : DEFAULT_LANG;
}

export function ClientI18nRoot() {
  useEffect(() => {
    const lang = detectLanguage();
    document.documentElement.lang = lang;
    if (!/(?:^|; )i18nextLng=/.test(document.cookie)) {
      document.cookie = `i18nextLng=${lang}; path=/; max-age=31536000`;
    }
  }, []);
  return null;
}

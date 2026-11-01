// Language support: English (default) and Arabic. t() translates fixed UI text (the English text is the key);
// tx() translates sentences produced by the server. Missing translations fall back to English.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AR, AR_PATTERNS } from './ar';

export type Lang = 'en' | 'ar';
type Vars = Record<string, string | number>;

const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s);

/** Translate a server-generated sentence (exact match first, then the known sentence patterns). */
export function translateServer(s: string, lang: Lang): string {
  if (lang === 'en' || !s) return s;
  if (AR[s] !== undefined) return AR[s];
  let out = s;
  for (const [re, fn] of AR_PATTERNS) out = out.replace(re, fn as (...a: string[]) => string);
  return out;
}

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  dir: 'ltr' | 'rtl';
  t: (en: string, vars?: Vars) => string;
  tx: (serverText: string) => string;
}

const Ctx = createContext<I18n>({ lang: 'en', setLang: () => undefined, dir: 'ltr', t: fill, tx: (s) => s });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      return localStorage.getItem('pf-lang') === 'ar' ? 'ar' : 'en';
    } catch {
      return 'en';
    }
  });
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem('pf-lang', l);
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);
  const value = useMemo<I18n>(
    () => ({
      lang,
      setLang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      t: (en, vars) => fill(lang === 'ar' ? (AR[en] ?? en) : en, vars),
      tx: (s) => translateServer(s, lang),
    }),
    [lang, setLang],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

/** Button that switches between English and Arabic. */
export function LangToggle({ className = 'btn sm' }: { className?: string }) {
  const { lang, setLang } = useI18n();
  return (
    <button className={className} onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'} lang={lang === 'ar' ? 'en' : 'ar'}>
      {lang === 'ar' ? 'English' : 'العربية'}
    </button>
  );
}

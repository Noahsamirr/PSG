// Simple mode (default) shows one clear answer per timeframe; Advanced mode shows every tool and statistic.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Mode = 'simple' | 'advanced';

const Ctx = createContext<{ mode: Mode; setMode: (m: Mode) => void }>({ mode: 'simple', setMode: () => undefined });

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(() => {
    try {
      return localStorage.getItem('pf-mode') === 'advanced' ? 'advanced' : 'simple';
    } catch {
      return 'simple';
    }
  });
  const setMode = useCallback((m: Mode) => {
    setModeState(m);
    try {
      localStorage.setItem('pf-mode', m);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useMode = () => useContext(Ctx);

/** Two-button switch between Simple and Advanced. */
export function ModeSwitch() {
  const { mode, setMode } = useMode();
  return (
    <div className="mode-switch" role="group" aria-label="View mode">
      <button className={mode === 'simple' ? 'on' : ''} aria-pressed={mode === 'simple'} onClick={() => setMode('simple')}>
        Simple
      </button>
      <button className={mode === 'advanced' ? 'on' : ''} aria-pressed={mode === 'advanced'} onClick={() => setMode('advanced')}>
        Advanced
      </button>
    </div>
  );
}

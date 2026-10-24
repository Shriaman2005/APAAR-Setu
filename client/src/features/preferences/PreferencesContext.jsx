import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS } from './strings';

// Accessibility and language preferences for the utility strip (A- / A / A+, high contrast,
// language). Stored in localStorage only as a per-browser convenience.
const PreferencesContext = createContext(null);
const SCALES = [87.5, 100, 112.5, 125, 137.5, 150];

function readStored(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode): preferences simply are not remembered */
  }
}

export function PreferencesProvider({ children }) {
  const [scaleIndex, setScaleIndex] = useState(() => readStored('apaar.fontScale', 1));
  const [highContrast, setHighContrast] = useState(() => readStored('apaar.highContrast', false));
  const [language, setLanguage] = useState(() => readStored('apaar.language', 'en'));

  useEffect(() => {
    const index = Math.min(SCALES.length - 1, Math.max(0, scaleIndex));
    document.documentElement.style.setProperty('--font-scale', `${SCALES[index]}%`);
    store('apaar.fontScale', index);
  }, [scaleIndex]);

  useEffect(() => {
    if (highContrast) document.documentElement.setAttribute('data-contrast', 'high');
    else document.documentElement.removeAttribute('data-contrast');
    store('apaar.highContrast', highContrast);
  }, [highContrast]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', language === 'hi' ? 'hi' : 'en');
    store('apaar.language', language);
  }, [language]);

  const t = useCallback((key) => STRINGS[language]?.[key] || STRINGS.en[key] || key, [language]);

  const value = useMemo(() => ({
    t,
    language,
    setLanguage,
    highContrast,
    toggleContrast: () => setHighContrast((on) => !on),
    decreaseText: () => setScaleIndex((i) => Math.max(0, i - 1)),
    resetText: () => setScaleIndex(1),
    increaseText: () => setScaleIndex((i) => Math.min(SCALES.length - 1, i + 1)),
    textScale: SCALES[Math.min(SCALES.length - 1, Math.max(0, scaleIndex))],
  }), [t, language, highContrast, scaleIndex]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}

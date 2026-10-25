import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS } from './strings';

// High-contrast and language preferences (controls in the site header). Stored in localStorage
// only as a per-browser convenience. Larger text is left to the browser's own zoom.
const PreferencesContext = createContext(null);

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
  const [highContrast, setHighContrast] = useState(() => readStored('apaar.highContrast', false));
  const [language, setLanguage] = useState(() => readStored('apaar.language', 'en'));

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
  }), [t, language, highContrast]);

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside PreferencesProvider');
  return value;
}

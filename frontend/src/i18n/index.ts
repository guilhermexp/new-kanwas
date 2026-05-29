import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import en from './locales/en.json'
import pt from './locales/pt.json'

export const SUPPORTED_LANGUAGES = ['en', 'pt'] as const
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: AppLanguage = 'en'

/** localStorage key shared with the detector so the choice survives reloads. */
export const LANGUAGE_STORAGE_KEY = 'kanwas.language'

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pt: { translation: pt },
    },
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: {
      escapeValue: false, // React already escapes
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
  })

/**
 * Change the active language and persist it locally. The user-config sync layer
 * calls this so the choice applies immediately and survives reloads before the
 * config request resolves.
 */
export function setAppLanguage(language: AppLanguage): void {
  if (i18n.language !== language) {
    void i18n.changeLanguage(language)
  }
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

export default i18n

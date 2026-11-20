// Internationalisation. AHAAR ships with English + Hindi fully
// translated and stubs for the eight other most-spoken Indian
// languages, all falling back to English for any key not yet in the
// locale file so the app always renders something sensible.
//
// Add a string: edit src/locales/en.json first, then each other
// locale. See src/locales/README.md for the contribution flow.

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import hi from '../locales/hi.json';
import bn from '../locales/bn.json';
import ta from '../locales/ta.json';
import te from '../locales/te.json';
import mr from '../locales/mr.json';
import gu from '../locales/gu.json';
import kn from '../locales/kn.json';
import ml from '../locales/ml.json';
import pa from '../locales/pa.json';

export const LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: 'en', label: 'English',   native: 'English'  },
  { code: 'hi', label: 'Hindi',     native: 'हिन्दी'    },
  { code: 'bn', label: 'Bengali',   native: 'বাংলা'     },
  { code: 'ta', label: 'Tamil',     native: 'தமிழ்'     },
  { code: 'te', label: 'Telugu',    native: 'తెలుగు'   },
  { code: 'mr', label: 'Marathi',   native: 'मराठी'    },
  { code: 'gu', label: 'Gujarati',  native: 'ગુજરાતી'  },
  { code: 'kn', label: 'Kannada',   native: 'ಕನ್ನಡ'    },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം'  },
  { code: 'pa', label: 'Punjabi',   native: 'ਪੰਜਾਬੀ'   },
];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      bn: { translation: bn },
      ta: { translation: ta },
      te: { translation: te },
      mr: { translation: mr },
      gu: { translation: gu },
      kn: { translation: kn },
      ml: { translation: ml },
      pa: { translation: pa },
    },
    fallbackLng: 'en',
    supportedLngs: LANGUAGES.map((l) => l.code),
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: 'ahaar:lang',
      caches: ['localStorage'],
    },
    returnEmptyString: false,
  });

export default i18n;

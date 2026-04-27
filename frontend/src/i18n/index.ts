import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import commonZh from '../locales/zh-CN/common.json';
import commonEn from '../locales/en/common.json';
import navZh from '../locales/zh-CN/nav.json';
import navEn from '../locales/en/nav.json';
import authZh from '../locales/zh-CN/auth.json';
import authEn from '../locales/en/auth.json';
import dashboardZh from '../locales/zh-CN/dashboard.json';
import dashboardEn from '../locales/en/dashboard.json';
import transactionsZh from '../locales/zh-CN/transactions.json';
import transactionsEn from '../locales/en/transactions.json';
import ledgerZh from '../locales/zh-CN/ledger.json';
import ledgerEn from '../locales/en/ledger.json';
import categoriesZh from '../locales/zh-CN/categories.json';
import categoriesEn from '../locales/en/categories.json';
import membersZh from '../locales/zh-CN/members.json';
import membersEn from '../locales/en/members.json';
import projectsZh from '../locales/zh-CN/projects.json';
import projectsEn from '../locales/en/projects.json';
import adminZh from '../locales/zh-CN/admin.json';
import adminEn from '../locales/en/admin.json';
import botZh from '../locales/zh-CN/bot.json';
import botEn from '../locales/en/bot.json';
import modalsZh from '../locales/zh-CN/modals.json';
import modalsEn from '../locales/en/modals.json';

export const LOCALE_STORAGE_KEY = 'sprouts_locale';

const namespaces = [
  'common',
  'nav',
  'auth',
  'dashboard',
  'transactions',
  'ledger',
  'categories',
  'members',
  'projects',
  'admin',
  'bot',
  'modals',
] as const;

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'zh-CN': {
        common: commonZh,
        nav: navZh,
        auth: authZh,
        dashboard: dashboardZh,
        transactions: transactionsZh,
        ledger: ledgerZh,
        categories: categoriesZh,
        members: membersZh,
        projects: projectsZh,
        admin: adminZh,
        bot: botZh,
        modals: modalsZh,
      },
      en: {
        common: commonEn,
        nav: navEn,
        auth: authEn,
        dashboard: dashboardEn,
        transactions: transactionsEn,
        ledger: ledgerEn,
        categories: categoriesEn,
        members: membersEn,
        projects: projectsEn,
        admin: adminEn,
        bot: botEn,
        modals: modalsEn,
      },
    },
    fallbackLng: 'zh-CN',
    supportedLngs: ['zh-CN', 'en'],
    nonExplicitSupportedLngs: true,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
    },
    defaultNS: 'common',
    ns: [...namespaces],
    interpolation: { escapeValue: false },
  });

export function setAppLocale(lng: 'zh-CN' | 'en') {
  void i18n.changeLanguage(lng);
}

export default i18n;

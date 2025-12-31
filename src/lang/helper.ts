import type { App } from "obsidian";

import en from "./locale/en";
import zh from "./locale/zh";
import type { LocaleText } from "./types";

export type LocaleKey = "en" | "zh";
export type LocalePreference = LocaleKey | "system";

const DEFAULT_LOCALE: LocaleKey = "en";

const LOCALES: Record<LocaleKey, LocaleText> = {
  en,
  zh,
};

function pickLocaleFromLang(lang: string | null | undefined): LocaleKey {
  if (!lang) return DEFAULT_LOCALE;
  const lower = lang.toLowerCase();
  if (lower.startsWith("zh")) return "zh";
  return "en";
}

export function detectLocale(app: App): LocaleKey {
  const html = app.workspace?.containerEl?.ownerDocument?.documentElement;
  return pickLocaleFromLang(html?.lang);
}

export function getLocale(app: App, preference: LocalePreference = DEFAULT_LOCALE): LocaleText {
  if (preference === "system") return LOCALES[detectLocale(app)];
  return LOCALES[preference];
}

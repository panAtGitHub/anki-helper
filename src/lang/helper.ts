import { getLanguage, type App } from "obsidian";

import en from "./locale/en";
import zh from "./locale/zh";
import zhTw from "./locale/zh-tw";
import type { LocaleText } from "./types";

export type LocaleKey = "en" | "zh" | "zh-tw";
export type LocalePreference = LocaleKey | "system";

const DEFAULT_LOCALE: LocaleKey = "en";

const LOCALES: Record<LocaleKey, LocaleText> = {
  en,
  zh,
  "zh-tw": zhTw,
};

function pickLocaleFromLang(lang: string | null | undefined): LocaleKey {
  if (!lang) return DEFAULT_LOCALE;
  const lower = lang.toLowerCase();
  if (lower.startsWith("zh-hant") || lower.startsWith("zh-hk") || lower.startsWith("zh-tw")) {
    return "zh-tw";
  }
  if (lower.startsWith("zh")) return "zh";
  return "en";
}

export function detectLocale(app: App): LocaleKey {
  void app;
  return pickLocaleFromLang(getLanguage());
}

export function getLocale(app: App, preference: LocalePreference = DEFAULT_LOCALE): LocaleText {
  if (preference === "system") return LOCALES[detectLocale(app)];
  return LOCALES[preference];
}

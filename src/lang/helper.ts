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

// 根据 Obsidian 语言代码归一化到插件支持的三种语言。
function pickLocaleFromLang(lang: string | null | undefined): LocaleKey {
  if (!lang) return DEFAULT_LOCALE;
  const lower = lang.toLowerCase();
  if (lower.startsWith("zh-hant") || lower.startsWith("zh-hk") || lower.startsWith("zh-tw")) {
    return "zh-tw";
  }
  if (lower.startsWith("zh")) return "zh";
  return "en";
}

// 系统语言检测：统一使用官方 API，避免从 DOM 推断。
export function detectLocale(app: App): LocaleKey {
  void app;
  return pickLocaleFromLang(getLanguage());
}

// 返回最终使用的文案集合：支持显式语言和 system 自动模式。
export function getLocale(app: App, preference: LocalePreference = DEFAULT_LOCALE): LocaleText {
  if (preference === "system") return LOCALES[detectLocale(app)];
  return LOCALES[preference];
}

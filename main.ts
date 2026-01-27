// Obsidian Plugin – Anki Helper
// Implements:
// 1. Under selected heading levels insert a backlink to the heading
// 2. Remove configurable characters inside heading text
// 3. Insert TARGET DECK section below YAML or before first heading
// 4. Delete empty trailing list items (ordered & unordered)
// 5. Ensure one blank line containing a single space between a list and the following paragraph
// Trigger: run via Command Palette or a user-assigned hotkey

import { App, Plugin, PluginSettingTab, Setting, MarkdownView, TFile, Notice } from "obsidian";

import { getLocale, type LocaleKey } from "./src/lang/helper";
import type { LocaleText } from "./src/lang/types";

function findYamlEnd(lines: string[]): number {
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    return end >= 0 ? end + 1 : 0;
  }
  return 0;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withPlaceholders = escaped.replace(/\*\*/g, "§§");
  const single = withPlaceholders.replace(/\*/g, "[^/]*");
  return new RegExp("^" + single.replace(/§§/g, ".*") + "$");
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface AnkiHelperSettings {
  uiLanguage: LocaleKey;
  headingLevel: number;
  clozeHeadingLevel: number;
  headingRemoveChars: string;
  targetDeckTemplate: string;
  enableTargetDeck: boolean;
  targetDeckLocation: "body" | "yaml";
  enableHeadingOps: boolean;
  enableListTidy: boolean;
  runScope: "all" | "include" | "exclude";
  includePaths: string[];
  excludePaths: string[];
  clozeMarker?: string;
}

const DEFAULT_SETTINGS: AnkiHelperSettings = {
  uiLanguage: "en",
  headingLevel: 4,
  clozeHeadingLevel: 5,
  headingRemoveChars: "` < > [ ]",
  targetDeckTemplate: "[[anki]]::[[filename]]",
  enableTargetDeck: true,
  targetDeckLocation: "yaml",
  enableHeadingOps: true,
  enableListTidy: true,
  runScope: "all",
  includePaths: [],
  excludePaths: [],
  clozeMarker: "==",
};

export default class AnkiHelperPlugin extends Plugin {
  settings!: AnkiHelperSettings;
  private includePatterns: RegExp[] = [];
  private excludePatterns: RegExp[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();
    const locale = this.getLocaleText();

    this.addCommand({
      id: "run",
      name: locale.commandInsertName,
      callback: () => {
        const file = this.getActiveFile();
        if (!file) {
          new Notice("Anki Helper: no active file.");
          return;
        }
        if (file.extension !== "md") {
          new Notice("Anki Helper: active file is not a Markdown file.");
          return;
        }
        void this.processFile(file);
      },
    });

    this.addCommand({
      id: "cloze-one",
      name: locale.commandClozeOneName,
      editorCallback: () => this.runClozeConvert("one"),
    });
    this.addCommand({
      id: "cloze-seq",
      name: locale.commandClozeSeqName,
      editorCallback: () => this.runClozeConvert("seq"),
    });
    this.addCommand({
      id: "cloze-restore",
      name: locale.commandClozeRestoreName,
      editorCallback: () => this.runClozeRestore(),
    });

    this.addSettingTab(new AnkiHelperSettingTab(this.app, this));
  }

  onunload(): void {}

  private async processFile(file: TFile): Promise<void> {
    if (!this.isInScope(file)) {
      new Notice("Anki Helper: skipped (out of scope)");
      return;
    }

    await this.app.vault.process(file, (raw) => {
      const lines = raw.split(/\r?\n/);
      let changed = false;

      if (this.settings.enableTargetDeck) {
        changed = this.ensureTargetDeck(lines, file) || changed;
      }
      if (this.settings.enableHeadingOps) {
        changed = this.rewriteHeadingsAndCollectLists(lines, file) || changed;
      }
      if (this.settings.enableListTidy) {
        changed = this.tidyLists(lines) || changed;
      }

      return changed ? lines.join("\n") : raw;
    });
  }

  private isInScope(file: TFile): boolean {
    const path = file.path;
    if (this.settings.runScope === "include") {
      return this.includePatterns.some((r) => r.test(path));
    }
    if (this.settings.runScope === "exclude") {
      return !this.excludePatterns.some((r) => r.test(path));
    }
    return true;
  }

  private ensureTargetDeck(lines: string[], file: TFile): boolean {
    const marker = "TARGET DECK";
    const tpl = this.settings.targetDeckTemplate.replace(/filename/g, file.basename);
    const lineValue = `${marker}: ${tpl}`;
    const location = this.settings.targetDeckLocation ?? "body";

    const getYamlEnd = () => (lines[0] === "---" ? lines.indexOf("---", 1) : -1);

    const removeBodyTargetDeck = (): boolean => {
      const idx = lines.findIndex((l) => l.trim() === marker);
      if (idx < 0) return false;
      let removeCount = 1;
      const next = lines[idx + 1];
      if (next !== undefined) {
        const nextTrim = next.trim();
        if (nextTrim === "") {
          removeCount++;
        } else if (!nextTrim.startsWith("#") && nextTrim !== "---") {
          removeCount++;
          const after = lines[idx + 2];
          if (after !== undefined && after.trim() === "") removeCount++;
        }
      }
      lines.splice(idx, removeCount);
      return true;
    };

    const removeYamlTargetDeck = (end: number): boolean => {
      for (let i = 1; i < end; i++) {
        if (/^TARGET DECK\s*:/.test(lines[i])) {
          lines.splice(i, 1);
          return true;
        }
      }
      return false;
    };

    const ensureYamlTargetDeck = (): boolean => {
      const end = getYamlEnd();
      if (end > 0) {
        for (let i = 1; i < end; i++) {
          if (/^TARGET DECK\s*:/.test(lines[i])) {
            if (lines[i] !== lineValue) {
              lines[i] = lineValue;
              return true;
            }
            return false;
          }
        }
        lines.splice(end, 0, lineValue);
        return true;
      }
      lines.unshift("---", lineValue, "---", "");
      return true;
    };

    const ensureBodyTargetDeck = (): boolean => {
      if (lines.some((l) => l.trim() === marker)) return false;
      let idx = findYamlEnd(lines);
      if (idx === 0) {
        const firstHeading = lines.findIndex((l) => l.trim().startsWith("#"));
        if (firstHeading >= 0) idx = firstHeading;
      }
      if (idx > 0 && lines[idx - 1] === "---") {
        lines.splice(idx, 0, "");
        idx++;
      }
      lines.splice(idx, 0, marker, tpl, "");
      return true;
    };

    if (location === "yaml") {
      const changedYaml = ensureYamlTargetDeck();
      const removedBody = removeBodyTargetDeck();
      return changedYaml || removedBody;
    }

    const end = getYamlEnd();
    const removedYaml = end > 0 ? removeYamlTargetDeck(end) : false;
    const changedBody = ensureBodyTargetDeck();
    return removedYaml || changedBody;
  }

  private rewriteHeadingsAndCollectLists(lines: string[], file: TFile): boolean {
    let changed = false;
    const qaLvl = this.settings.headingLevel ?? 4;
    const clozeLvl = this.settings.clozeHeadingLevel ?? 5;
    const prefixes = new Set<string>(["#".repeat(qaLvl) + " ", "#".repeat(clozeLvl) + " "]);
    const noteName = file.basename;
    const start = findYamlEnd(lines);

    const rawChars = this.settings.headingRemoveChars.trim() || "` < > [ ]";
    const tokens = rawChars.split(/\s+/).filter(Boolean);
    const pattern = tokens.length ? tokens.map(escapeRegExp).join("|") : "`|<|>|\\[|\\]";
    const removeRegex = new RegExp(pattern, "g");

    for (let i = start; i < lines.length; i++) {
      const line = lines[i];

      let hPrefix: string | null = null;
      for (const p of prefixes) {
        if (line.startsWith(p)) {
          hPrefix = p;
          break;
        }
      }
      if (!hPrefix) continue;

      const rawHeading = line.slice(hPrefix.length);
      const cleanHeading = rawHeading.replace(removeRegex, "").trim();
      if (rawHeading !== cleanHeading) {
        lines[i] = hPrefix + cleanHeading;
        changed = true;
      }

      const backlink = `[[${noteName}#${cleanHeading}]]`;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j >= lines.length) {
        lines.push(backlink);
        changed = true;
      } else if (!/^\[\[.*?#.*?\]\]$/.test(lines[j].trim())) {
        lines.splice(j, 0, backlink);
        changed = true;
      } else if (lines[j].trim() !== backlink) {
        lines[j] = backlink;
        changed = true;
      }
    }

    return changed;
  }

  private tidyLists(lines: string[]): boolean {
    let changed = false;

    const isList = (l: string) => /^(\s*)([-+*]|\d+\.)\s*/.test(l);
    const isEmptyItem = (l: string) => /^(\s*)([-+*]|\d+\.)\s*$/.test(l);
    const isBlankLine = (l: string) => /^\s*$/.test(l);
    const isHtmlCmt = (l: string) => /^\s*<!--.*-->/.test(l);

    const start = findYamlEnd(lines);
    for (let i = start; i < lines.length; i++) {
      if (!isList(lines[i])) continue;

      let end = i;
      while (end + 1 < lines.length && isList(lines[end + 1])) end++;

      for (let j = end; j >= i; j--) {
        if (isEmptyItem(lines[j])) {
          lines.splice(j, 1);
          changed = true;
          end--;
        }
      }

      const nextLine = lines[end + 1];
      if (nextLine !== undefined) {
        const needSpace = !isBlankLine(nextLine) && !isList(nextLine) && !isHtmlCmt(nextLine);
        if (needSpace) {
          lines.splice(end + 1, 0, " ");
          changed = true;
        }
      }

      i = end;
    }

    return changed;
  }

  private getActiveFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  private buildClozeMarkerRegex(): RegExp {
    const m = escapeRegExp(this.settings.clozeMarker || "==");
    return new RegExp(`${m}([\\s\\S]*?)${m}`, "g");
  }

  private forEachClozeBlock(text: string, fn: (block: string) => string): string {
    const lvl = this.settings.clozeHeadingLevel ?? 5;
    const headingRe = new RegExp(`^#{${lvl}}\\s+`);
    const lines = text.split("\n");
    const isBlank = (s: string) => s === "";

    let i = 0;
    let matched = false;

    while (i < lines.length) {
      if (!headingRe.test(lines[i])) {
        i++;
        continue;
      }
      matched = true;

      const start = i + 1;
      let j = start;
      while (j < lines.length && !isBlank(lines[j])) j++;

      const block = lines.slice(start, j).join("\n");
      const out = fn(block);
      lines.splice(start, j - start, ...out.split("\n"));
      i = start + out.split("\n").length;
    }

    if (!matched) return fn(text);
    return lines.join("\n");
  }

  private clozeConvertOneScoped(text: string): string {
    const rx = this.buildClozeMarkerRegex();
    return this.forEachClozeBlock(text, (blk) => blk.replace(rx, (_m, inner) => `{{c1::${inner}}}`));
  }

  private clozeConvertSeq(text: string): string {
    const rx = this.buildClozeMarkerRegex();
    return this.forEachClozeBlock(text, (blk) => {
      let idx = 1;
      return blk.replace(rx, (_m, inner) => `{{c${idx++}::${inner}}}`);
    });
  }

  private runClozeConvert(mode: "one" | "seq") {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("No active Markdown view.");
      return;
    }
    const editor = view.editor;

    const src = editor.getSelection() || editor.getValue();
    const out = mode === "one" ? this.clozeConvertOneScoped(src) : this.clozeConvertSeq(src);

    if (editor.somethingSelected()) editor.replaceSelection(out);
    else editor.setValue(out);
  }

  private clozeRestore(text: string): string {
    const marker = this.settings.clozeMarker || "==";
    return text.replace(/\{\{c\d+::([\s\S]*?)\}\}/g, (_m, inner) => `${marker}${inner}${marker}`);
  }

  private runClozeRestore() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) {
      new Notice("No active Markdown view.");
      return;
    }
    const editor = view.editor;

    const src = editor.getSelection() || editor.getValue();
    const out = this.clozeRestore(src);
    if (editor.somethingSelected()) editor.replaceSelection(out);
    else editor.setValue(out);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.updateScopePatterns();
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  updateScopePatterns() {
    const toGlob = (p: string) => (p.endsWith("/") ? p + "**" : p);
    this.includePatterns = this.settings.includePaths.map((p) => globToRegExp(toGlob(p)));
    this.excludePatterns = this.settings.excludePaths.map((p) => globToRegExp(toGlob(p)));
  }

  getLocaleText(): LocaleText {
    return getLocale(this.app, this.settings.uiLanguage);
  }
}

class AnkiHelperSettingTab extends PluginSettingTab {
  plugin: AnkiHelperPlugin;
  constructor(app: App, plugin: AnkiHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const t = this.plugin.getLocaleText();

    new Setting(containerEl).setName(t.settingsTitle).setHeading();

    new Setting(containerEl)
      .setName(t.language)
      .addDropdown((d) => {
        d.addOptions({ en: t.langEnglish, zh: t.langChinese })
          .setValue(this.plugin.settings.uiLanguage)
          .onChange((v) => {
            if (v !== "en" && v !== "zh") return;
            this.plugin.settings.uiLanguage = v;
            void this.plugin.saveSettings().then(
              () => this.display(),
              (err) => console.error("Failed to save settings", err),
            );
          });
      });

    const createFoldCard = (title: string, opened = false) => {
      const card = containerEl.createDiv({ cls: "ah-card" });
      const header = card.createEl("div", { cls: "ah-card-title", text: title });
      const content = card.createDiv({ cls: "ah-card-content" });
      content.classList.toggle("is-open", opened);
      header.addEventListener("click", () => {
        content.classList.toggle("is-open", !content.classList.contains("is-open"));
      });
      return { card, header, content };
    };

    const getPatternQA = (x: number) =>
      `^#{${x}}\\s(.+)\\n*((?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)`;
    const getPatternCloze = (x: number) =>
      `^#{${x}}\\s(.+\\n*(?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)`;

    const cardLevel = createFoldCard(t.card1Title, false);
    cardLevel.content.createEl("div", { cls: "ah-card-subtitle", text: t.qaSubtitle });
    cardLevel.content.createEl("div", { cls: "ah-card-desc", text: t.qaDesc });

    new Setting(cardLevel.content)
      .setName(t.headingLevelName)
      .setDesc(t.headingLevelDesc)
      .addDropdown((d) => {
        d.addOptions({ "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6" })
          .setValue(String(this.plugin.settings.headingLevel))
          .onChange((v) => {
            this.plugin.settings.headingLevel = Number(v);
            void this.plugin.saveSettings().then(updateQARegexp, (err) =>
              console.error("Failed to save settings", err),
            );
          });
      });

    const qaCode = cardLevel.content.createEl("pre", { cls: "ah-code" }).createEl("code");
    const qaCopyBtn = cardLevel.content
      .createDiv({ cls: "ah-actions" })
      .createEl("button", { text: t.copyRegex });
    const updateQARegexp = () => {
      qaCode.setText(getPatternQA(this.plugin.settings.headingLevel));
    };
    updateQARegexp();
    qaCopyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(qaCode.textContent ?? "").then(
        () => new Notice(t.copied),
        (err) => console.error("Failed to write clipboard", err),
      );
    });

    cardLevel.content.createEl("div", { cls: "ah-card-subtitle", text: t.clozeSubtitle });
    cardLevel.content.createEl("div", { cls: "ah-card-desc", text: t.clozeDesc });

    let lastClozeLvl = this.plugin.settings.clozeHeadingLevel ?? 5;
    new Setting(cardLevel.content)
      .setName(t.clozeHeadingName)
      .setDesc(t.clozeHeadingDesc)
      .addDropdown((d) => {
        d.addOptions({ "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6" })
          .setValue(String(lastClozeLvl))
          .onChange((v) => {
            const lvl = Number(v);
            if (lvl === this.plugin.settings.headingLevel) {
              new Notice(t.levelConflict);
              d.setValue(String(lastClozeLvl));
              return;
            }
            this.plugin.settings.clozeHeadingLevel = lvl;
            lastClozeLvl = lvl;
            void this.plugin.saveSettings().then(updateClozeRegexp, (err) =>
              console.error("Failed to save settings", err),
            );
          });
      });

    const clozeCode = cardLevel.content.createEl("pre", { cls: "ah-code" }).createEl("code");
    const clozeCopyBtn = cardLevel.content
      .createDiv({ cls: "ah-actions" })
      .createEl("button", { text: t.copyRegex });
    const updateClozeRegexp = () => {
      clozeCode.setText(getPatternCloze(this.plugin.settings.clozeHeadingLevel ?? 5));
    };
    updateClozeRegexp();
    clozeCopyBtn.addEventListener("click", () => {
      void navigator.clipboard.writeText(clozeCode.textContent ?? "").then(
        () => new Notice(t.copied),
        (err) => console.error("Failed to write clipboard", err),
      );
    });

    const cardDeck = createFoldCard(t.card2Title, false);
    cardDeck.content.createEl("div", { cls: "ah-card-desc", text: t.card2Desc });
    new Setting(cardDeck.content)
      .setName(t.enableDeckName)
      .setDesc(t.enableDeckDesc)
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.enableTargetDeck).onChange((v) => {
          this.plugin.settings.enableTargetDeck = v;
          void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
        }),
      );
    new Setting(cardDeck.content)
      .setName(t.targetDeckLocationName)
      .setDesc(t.targetDeckLocationDesc)
      .addDropdown((d) =>
        d
          .addOptions({ body: t.targetDeckLocationBody, yaml: t.targetDeckLocationYaml })
          .setValue(this.plugin.settings.targetDeckLocation ?? "body")
          .onChange((v) => {
            if (v !== "body" && v !== "yaml") return;
            this.plugin.settings.targetDeckLocation = v;
            void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
          }),
      );
    new Setting(cardDeck.content)
      .setName(t.deckTemplateName)
      .setDesc(
        createFragment((frag) => {
          frag.createEl("div", { text: t.deckTemplateDesc1 });
          frag.createEl("div", { text: t.deckTemplateDesc2 });
        }),
      )
      .addText((text) =>
        text
          .setPlaceholder(t.deckTemplatePlaceholder)
          .setValue(this.plugin.settings.targetDeckTemplate)
          .onChange((value) => {
            this.plugin.settings.targetDeckTemplate = value.trim() || t.deckTemplatePlaceholder;
            void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
          }),
      );

    const cardCleanup = createFoldCard(t.card3Title, false);
    cardCleanup.content.createEl("div", { cls: "ah-card-desc", text: t.card3Desc });
    let headingCharsSetting: Setting;
    new Setting(cardCleanup.content)
      .setName(t.enableHeadingOpsName)
      .setDesc(t.enableHeadingOpsDesc)
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.enableHeadingOps).onChange((v) => {
          this.plugin.settings.enableHeadingOps = v;
          headingCharsSetting.setDisabled(!v);
          void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
        }),
      );
    headingCharsSetting = new Setting(cardCleanup.content)
      .setName(t.headingRemoveCharsName)
      .setDesc(t.headingRemoveCharsDesc)
      .addText((text) =>
        text
          .setPlaceholder(t.headingRemovePlaceholder)
          .setValue(this.plugin.settings.headingRemoveChars)
          .onChange((value) => {
            this.plugin.settings.headingRemoveChars = value.trim() || t.headingRemovePlaceholder;
            void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
          }),
      );
    headingCharsSetting.setDisabled(!this.plugin.settings.enableHeadingOps);

    new Setting(cardCleanup.content)
      .setName(t.enableListTidyName)
      .setDesc(t.enableListTidyDesc)
      .addToggle((tg) =>
        tg.setValue(this.plugin.settings.enableListTidy).onChange((v) => {
          this.plugin.settings.enableListTidy = v;
          void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
        }),
      );

    const cardCloze = createFoldCard(t.card4Title, false);
    cardCloze.content.createEl("div", { cls: "ah-card-desc", text: t.card4Desc });
    new Setting(cardCloze.content)
      .setName(t.clozeMarkerName)
      .setDesc(t.clozeMarkerDesc)
      .addText((text) =>
        text
          .setPlaceholder("==")
          .setValue(this.plugin.settings.clozeMarker || "==")
          .onChange((v) => {
            this.plugin.settings.clozeMarker = v || "==";
            void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
          }),
      );

    const cardScope = createFoldCard(t.card5Title, false);
    cardScope.content.createEl("div", { cls: "ah-card-desc", text: t.card5Desc });

    new Setting(cardScope.content).setName(t.scopeName).setDesc(t.scopeDesc).addDropdown((d) => {
      d.addOptions({
        all: t.scopeOptionAll,
        include: t.scopeOptionInclude,
        exclude: t.scopeOptionExclude,
      })
        .setValue(this.plugin.settings.runScope)
        .onChange((v) => {
          if (v !== "all" && v !== "include" && v !== "exclude") return;
          this.plugin.settings.runScope = v;
          void this.plugin.saveSettings().then(updateScopeUI, (err) =>
            console.error("Failed to save settings", err),
          );
        });
    });

    const includeSetting = new Setting(cardScope.content).setName(t.includeName).setDesc(t.includeDesc);
    const includeArea = includeSetting.controlEl.createEl("textarea");
    includeArea.setAttr("rows", 4);
    includeArea.setAttr("placeholder", t.includePlaceholder);
    includeArea.value = this.plugin.settings.includePaths.join("\n");
    includeArea.addEventListener("blur", () => {
      this.plugin.settings.includePaths = includeArea.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      this.plugin.updateScopePatterns();
      void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
    });

    const excludeSetting = new Setting(cardScope.content).setName(t.excludeName).setDesc(t.excludeDesc);
    const excludeArea = excludeSetting.controlEl.createEl("textarea");
    excludeArea.setAttr("rows", 4);
    excludeArea.setAttr("placeholder", t.excludePlaceholder);
    excludeArea.value = this.plugin.settings.excludePaths.join("\n");
    excludeArea.addEventListener("blur", () => {
      this.plugin.settings.excludePaths = excludeArea.value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      this.plugin.updateScopePatterns();
      void this.plugin.saveSettings().catch((err) => console.error("Failed to save settings", err));
    });

    const updateScopeUI = () => {
      const mode = this.plugin.settings.runScope;
      includeSetting.settingEl.toggle(mode === "include");
      excludeSetting.settingEl.toggle(mode === "exclude");
    };
    updateScopeUI();
  }
}

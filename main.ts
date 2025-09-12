// Obsidian Plugin – Anki Helper
// Implements:
// 1. Under every H4 heading (####) insert a backlink to the heading
// 2. Remove configurable characters inside H4 heading text itself
// 3. Check and insert TARGET DECK section below YAML or before first heading
// 4. Delete empty trailing list items (ordered & unordered)
// 5. Ensure one blank line containing a single space between a list and the following paragraph
// Trigger: run via Command Palette or a user-assigned hotkey

import { App, Plugin, PluginSettingTab, Setting, MarkdownView, TFile, Notice } from "obsidian";

/* ✨ 新增：通用工具函数 —— 返回 YAML 结束后的第一行下标 */
function findYamlEnd(lines: string[]): number {
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    return end >= 0 ? end + 1 : 0;    // 若未闭合也视作 0
  }
  return 0;
}

// 将简单的 glob 表达式转换为 RegExp
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const withPlaceholders = escaped.replace(/\*\*/g, "§§");
  const single = withPlaceholders.replace(/\*/g, "[^/]*");
  return new RegExp("^" + single.replace(/§§/g, ".*") + "$");
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Settings */
interface AnkiHelperSettings {
  headingLevel: number; //      问答题卡片用的“问题”标题级别，默认4（####）
  clozeHeadingLevel: number; // 填空题卡片用的“问题”标题级别，默认5（#####）
  headingRemoveChars: string;       // space-separated chars to remove from headings
  targetDeckTemplate: string; // e.g. '[[anki背诵]]::[[filename]]'
  enableTargetDeck: boolean;            // 启用 TARGET DECK 自动插入，增加开关
  enableHeadingOps: boolean;            // 启用 标题清理 + 标题级回链，增加开关
  enableListTidy: boolean;              // 启用 列表清理，增加开关
  runScope: "all" | "include" | "exclude"; // 运行范围模式
  includePaths: string[];               // 仅在这些文件夹/文件执行
  excludePaths: string[];               // 排除的文件夹/文件
  clozeMarker?: string;                // 对称标记，如 "=="，2025-08-25新增

}

const DEFAULT_SETTINGS: AnkiHelperSettings = {
  headingLevel: 4,
  clozeHeadingLevel: 5,
  headingRemoveChars: "` < > [ ]",
  targetDeckTemplate: "[[anki背诵]]::[[filename]]",
  enableTargetDeck: true,
  enableHeadingOps: true,
  enableListTidy: true,
  runScope: "all",
  includePaths: [],
  excludePaths: [],
  clozeMarker: "==",
}


// 以下是自定义cmd+P时出现的命令行
export default class AnkiHelperPlugin extends Plugin {
  settings!: AnkiHelperSettings;
  private includePatterns: RegExp[] = [];
  private excludePatterns: RegExp[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "anki-helper-run",
      name: "Insert Deck & Backlink；插入牌组（若无）并插入标题级回链；",
      callback: () => {
        const file = this.getActiveFile();
        if (file) this.processFile(file);
      }
    });
    this.addCommand({
      id: "anki-helper-cloze-one",
      name: "Cloze: Convert markers → {{c1::…}} (挖空答案在卡片「同时」出现)",
      editorCallback: () => this.runClozeConvert("one"),
    });
    this.addCommand({
      id: "anki-helper-cloze-seq",
      name: "Cloze: Convert markers → {{c1::…}}, {{c2::…}}… (挖空答案在卡片「按顺序」出现)",
      editorCallback: () => this.runClozeConvert("seq"),
    });
    this.addCommand({
      id: "anki-helper-cloze-restore",
      name: "Cloze: Restore {{cN::…}} → markers（将挖空标记转回成原始标记）",
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

    const raw = await this.app.vault.read(file);
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

    if (changed) await this.app.vault.modify(file, lines.join("\n"));
  }

  private isInScope(file: TFile): boolean {
    const path = file.path;
    if (this.settings.runScope === "include") {
      return this.includePatterns.some(r => r.test(path));
    }
    if (this.settings.runScope === "exclude") {
      return !this.excludePatterns.some(r => r.test(path));
    }
    return true; // all
  }

  private ensureTargetDeck(lines: string[], file: TFile): boolean {
    const marker = "TARGET DECK";
    if (lines.some((l) => l.includes(marker))) return false;

    let idx = findYamlEnd(lines);
    if (idx === 0) {
      const fh = lines.findIndex((l) => l.trim().startsWith("#"));
      if (fh >= 0) idx = fh;
    }

    const tpl = this.settings.targetDeckTemplate.replace(/filename/g, file.basename);
    if (idx > 0 && lines[idx - 1] === "---") {
      lines.splice(idx, 0, "");
      idx++;
    }
    lines.splice(idx, 0, marker, tpl, "");
    return true;
  }

  private rewriteHeadingsAndCollectLists(lines: string[], file: TFile): boolean {
    let changed = false;
    const qaLvl = this.settings.headingLevel ?? 4;          // 问答题标题级别
    const clozeLvl = this.settings.clozeHeadingLevel ?? 5;  // 填空题标题级别
    const prefixes = new Set<string>([
      "#".repeat(qaLvl) + " ",
      "#".repeat(clozeLvl) + " ",
    ]);
    const noteName = file.basename;
    const start = findYamlEnd(lines); // 从 YAML 之后开始

    // 标题清理字符
    const rawChars = this.settings.headingRemoveChars.trim() || "` < > [ ]";
    const tokens = rawChars.split(/\s+/).filter(Boolean);
    const pattern = tokens.length ? tokens.map(escapeRegExp).join("|") : "`|<|>|\\[|\\]";
    const removeRegex = new RegExp(pattern, "g");

    for (let i = start; i < lines.length; i++) {
      const line = lines[i];

      // 命中两类标题之一
      let hPrefix: string | null = null;
      for (const p of prefixes) {
        if (line.startsWith(p)) { hPrefix = p; break; }
      }
      if (!hPrefix) continue;

      // ① 清理标题字符
      const rawHeading = line.slice(hPrefix.length);
      const cleanHeading = rawHeading.replace(removeRegex, "").trim();
      if (rawHeading !== cleanHeading) {
        lines[i] = hPrefix + cleanHeading;
        changed = true;
      }

      // ② 插入/更新紧随其后的回链 [[Note#Heading]]
      const backlink = `[[${noteName}#${cleanHeading}]]`;
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++; // 跳过空行
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

	const isList      = (l: string) => /^(\s*)([-+*]|\d+\.)\s*/.test(l);      // 无序或有序列表
	const isEmptyItem = (l: string) => /^(\s*)([-+*]|\d+\.)\s*$/.test(l);     // 空列表项
	const isBlankLine = (l: string) => /^\s*$/.test(l);                       // 纯空白
	const isHtmlCmt   = (l: string) => /^\s*<!--.*-->/.test(l);               // HTML 注释

	const start = findYamlEnd(lines);
	for (let i = start; i < lines.length; i++) {
		if (!isList(lines[i])) continue;

		// 找到当前列表块的末尾行号 end
		let end = i;
		while (end + 1 < lines.length && isList(lines[end + 1])) end++;

		/* ---------- 1️⃣ 删除列表中的所有空项 ---------- */
		for (let j = end; j >= i; j--) {           // 倒序删，避免索引错位
		if (isEmptyItem(lines[j])) {
			lines.splice(j, 1);
			changed = true;
			end--;                                 // 删除后列表块向上收缩
		}
		}

		/* ---------- 2️⃣ 处理列表块尾部与下一段落的间距 ---------- */
		const nextLine = lines[end + 1];
		if (nextLine !== undefined) {
		const needSpace =
			!isBlankLine(nextLine) &&              // 下一行不是空行
			!isList(nextLine) &&                   // 也不是另一个列表
			!isHtmlCmt(nextLine);                  // 且不是 HTML 注释

		if (needSpace) {
			lines.splice(end + 1, 0, " ");         // 插入仅含空格的占位行
			changed = true;
		}
		// 如果下一行是注释或本身已有空行，则保持现状
		}

		// 跳过已处理完的列表块
		i = end;
	}

	return changed;
	}


  private getActiveFile(): TFile | null {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return view?.file ?? null;
  }

  private buildClozeMarkerRegex(): RegExp {
    const m = escapeRegExp(this.settings.clozeMarker || "==");
    return new RegExp(`${m}([\\s\\S]*?)${m}`, "g"); // 非贪婪，允许跨行
  }

  // 以“填空题卡片”的标题级别为块起点（^#{L}\s+），到严格空行结束；2025-08-26
  // 若选区/文本里没有命中任何块，则把整段 text 当作一个块处理。
  private forEachClozeBlock(text: string, fn: (block: string) => string): string {
    const lvl = this.settings.clozeHeadingLevel ?? 5;
    const headingRe = new RegExp(`^#{${lvl}}\\s+`);
    const lines = text.split("\n");
    const isBlank = (s: string) => s === "";

    let i = 0;
    let matched = false;

    while (i < lines.length) {
      if (!headingRe.test(lines[i])) { i++; continue; }
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
  }  //2025-08-26


  // private clozeConvertOne(text: string): string {
  //   return text.replace(this.buildClozeMarkerRegex(), (_m, inner) => `{{c1::${inner}}}`);
  // }  2025-08-26，用下面的替换

  private clozeConvertOneScoped(text: string): string {
    const rx = this.buildClozeMarkerRegex();
    return this.forEachClozeBlock(text, (blk) =>
      blk.replace(rx, (_m, inner) => `{{c1::${inner}}}`)
    );
  }

  // 顺序：块内 c1,c2,c3...
  private clozeConvertSeq(text: string): string {
    const rx = this.buildClozeMarkerRegex();
    return this.forEachClozeBlock(text, (blk) => {
      let idx = 1;
      return blk.replace(rx, (_m, inner) => `{{c${idx++}::${inner}}}`);
    });
  }

  private runClozeConvert(mode: "one" | "seq") {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) { new Notice("No active Markdown view."); return; }
    const editor = view.editor;

    const src = editor.getSelection() || editor.getValue();
    const out = mode === "one"
      ? this.clozeConvertOneScoped(src)
      : this.clozeConvertSeq(src);

    if (editor.somethingSelected()) editor.replaceSelection(out);
    else editor.setValue(out);
  }
  // 以上单块函数2025-08-26

  private clozeRestore(text: string): string {
    const marker = this.settings.clozeMarker || "==";
    return text.replace(/\{\{c\d+::([\s\S]*?)\}\}/g, (_m, inner) => `${marker}${inner}${marker}`);
  }

  private runClozeRestore() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) { new Notice("No active Markdown view."); return; }
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
    const toGlob = (p: string) => p.endsWith('/') ? p + '**' : p;
    this.includePatterns = this.settings.includePaths.map(p => globToRegExp(toGlob(p)));
    this.excludePatterns = this.settings.excludePaths.map(p => globToRegExp(toGlob(p)));
  }
}

// 以下是插件的问题所在页，用来显示界面用的。
class AnkiHelperSettingTab extends PluginSettingTab {
  plugin: AnkiHelperPlugin;
  constructor(app: App, plugin: AnkiHelperPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  display(): void {
  const { containerEl } = this;
  containerEl.empty();

  // ===== 工具：创建可折叠卡片 =====
  const createFoldCard = (title: string, opened = false) => {
    const card = containerEl.createDiv({ cls: "ah-card" });
    const header = card.createEl("div", { cls: "ah-card-title", text: title });
    const content = card.createDiv({ cls: "ah-card-content" });
    content.style.display = opened ? "block" : "none";
    header.addEventListener("click", () => {
      content.style.display = content.style.display === "none" ? "block" : "none";
    });
    return { card, header, content };
  };

  // ===== 标题 =====
  containerEl.createEl("h1", { text: "Anki Helper Settings" });

  // ===== 正则生成工具 =====
  const getPatternQA = (x: number) =>
    `^#{${x}}\\s(.+)\\n*((?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)`;
  const getPatternCloze = (x: number) =>
    `^#{${x}}\\s(.+\\n*(?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)`;

  // =========================
  // 卡片 1：标题级别与正则
  // =========================
  const cardLevel = createFoldCard("一，确定「卡片标题」所在的标题级别（问答题 + 填空题）", false);
  // —— 问答题段落
  cardLevel.content.createEl("div", { cls: "ah-card-subtitle", text: "1，确定「问答题卡片」的「卡片标题」所在的标题级别" });
  cardLevel.content.createEl("div", {
    cls: "ah-card-desc",
    text: "默认为四级标题（4）。可以在下行选择 1～6 级，且“Custom Regexp语法”会自动联动。"
  });
  new Setting(cardLevel.content)
    .setName("请选择标题级别（默认为四级标题）：")
    .setDesc("注：请点击下方的「复制正则表达式语法」按钮，并粘贴到 obsidian_to_anki 插件 的“Custom Regexp”中。")
    .addDropdown(d => {
      d.addOptions({ "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6" })
        .setValue(String(this.plugin.settings.headingLevel))
        .onChange(async (v) => {
          this.plugin.settings.headingLevel = Number(v);
          await this.plugin.saveSettings();
          updateQARegexp();
        });
    });
  const qaPre = cardLevel.content.createEl("pre", { cls: "ah-code" });
  const qaCode = qaPre.createEl("code");
  const qaActions = cardLevel.content.createDiv({ cls: "ah-actions" });
  const qaCopyBtn = qaActions.createEl("button", { text: "复制正则表达式语法" });
  const updateQARegexp = () => { qaCode.setText(getPatternQA(this.plugin.settings.headingLevel)); };
  updateQARegexp();
  qaCopyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(qaCode.textContent ?? "");
    new Notice("已复制到剪贴板");
  });

  // —— 填空题段落
  cardLevel.content.createEl("div", { cls: "ah-card-subtitle", text: "2，确定「填空题卡片」的「卡片标题」所在的标题级别" });
  cardLevel.content.createEl("div", {
    cls: "ah-card-desc",
    text: "默认为五级标题（5）。可以在下行选择 1～6 级，且“Custom Regexp语法”会自动联动。\n注意不要与「问答题卡片」的标题级别相同，否则插件会读取有误。"
  });
  let lastClozeLvl = this.plugin.settings.clozeHeadingLevel ?? 5;
  new Setting(cardLevel.content)
    .setName("请选择标题级别（默认为五级标题）")
    .setDesc("注：可点击下方的「复制正则表达式语法」按钮，并粘贴到 obsidian_to_anki 插件的“Custom Regexp”中。")
    .addDropdown((d) => {
      d.addOptions({ "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6" })
        .setValue(String(lastClozeLvl))
        .onChange(async (v) => {
          const lvl = Number(v);
          if (lvl === this.plugin.settings.headingLevel) {
            new Notice("与「问答题卡片」级别相同，会导致读取错误。请更换级别。");
            d.setValue(String(lastClozeLvl));
            return;
          }
          this.plugin.settings.clozeHeadingLevel = lvl;
          lastClozeLvl = lvl;
          await this.plugin.saveSettings();
          updateClozeRegexp();
        });
    });
  const clozePre = cardLevel.content.createEl("pre", { cls: "ah-code" });
  const clozeCode = clozePre.createEl("code");
  const clozeActions = cardLevel.content.createDiv({ cls: "ah-actions" });
  const clozeCopyBtn = clozeActions.createEl("button", { text: "复制正则表达式语法" });
  const updateClozeRegexp = () => {
    clozeCode.setText(getPatternCloze(this.plugin.settings.clozeHeadingLevel ?? 5));
  };
  updateClozeRegexp();
  clozeCopyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(clozeCode.textContent ?? "");
    new Notice("已复制到剪贴板");
  });

  // =========================
  // 卡片 2：TARGET DECK
  // =========================
  const cardDeck = createFoldCard("二，加入 TARGET DECK，给 Anki 指定「牌组」", false);
  cardDeck.content.createEl("div", {
    cls: "ah-card-desc",
    text: "给Anki卡片指定牌组，方便在Anki中进行管理，推荐采用「父子牌组」的结构化管理方式"
  });
  new Setting(cardDeck.content)
    .setName("启用 TARGET DECK （目标牌组）的插入功能")
    .setDesc("注：运行命令「Insert Deck & Backlink」后在文件开头插入「牌组名」，以便在 Anki 中归类、定位")
    .addToggle(t => t
      .setValue(this.plugin.settings.enableTargetDeck)
      .onChange(async (v) => {
        this.plugin.settings.enableTargetDeck = v;
        await this.plugin.saveSettings();
      })
    );
  new Setting(cardDeck.content)
    .setName("TARGET DECK 模板示例")
    .setDesc(createFragment(frag => {
      frag.createEl("div", { text: "[[anki背诵]]为父牌组，可按自己使用习惯进行修改" });
      frag.createEl("div", { text: "[[filename]] 为固定语法，以文件名生成子牌组名称" });
    }))
    .addText((text) =>
      text
        .setPlaceholder("[[anki背诵]]::[[filename]]")
        .setValue(this.plugin.settings.targetDeckTemplate)
        .onChange(async (value) => {
          this.plugin.settings.targetDeckTemplate = value.trim() || "[[anki背诵]]::[[filename]]";
          await this.plugin.saveSettings();
        })
    );

  // =========================
  // 卡片 3：生成标题级回链
  // =========================
  const cardCleanup = createFoldCard("三，为卡片生成「标题级回链」，实现复习时「卡片级跳转」", false);
  cardCleanup.content.createEl("div", {
    cls: "ah-card-desc",
    text: "清理「卡片标题」中的特殊字符并插入标题级回链；列表与段落间自动插空行。"
  });
  let charSetting: Setting;
  new Setting(cardCleanup.content)
    .setName("启用：生成标题级回链 功能")
    .setDesc("注：运行命令「Insert Deck & Backlink」后会清理「卡片标题」中的特殊字符，同时插入或更新标题级回链，以便在 anki 复习时跳转到对应卡片进行修改。")
    .addToggle(t => t
      .setValue(this.plugin.settings.enableHeadingOps)
      .onChange(async (v) => {
        this.plugin.settings.enableHeadingOps = v;
        charSetting.setDisabled(!v);
        await this.plugin.saveSettings();
      })
    );
  charSetting = new Setting(cardCleanup.content)
    .setName("「卡片标题」中要删除的字符")
    .setDesc("输入要从标题中移除的字符，以空格分隔。默认移除：` < > [ ]")
    .addText(text =>
      text
        .setPlaceholder("` < > [ ]")
        .setValue(this.plugin.settings.headingRemoveChars)
        .onChange(async (value) => {
          this.plugin.settings.headingRemoveChars = value.trim() || "` < > [ ]";
          await this.plugin.saveSettings();
        })
    );
  charSetting.setDisabled(!this.plugin.settings.enableHeadingOps);
  new Setting(cardCleanup.content)
    .setName("启用：列表与段落间自动留空行功能")
    .setDesc("在列表与后续段落间自动留一空行，使在Anki中的显示更加美观。")
    .addToggle(t => t
      .setValue(this.plugin.settings.enableListTidy)
      .onChange(async (v) => {
        this.plugin.settings.enableListTidy = v;
        await this.plugin.saveSettings();
      })
    );

  // =========================
  // 卡片 4：Cloze 填空题卡片转换
  // =========================
  const cardCloze = createFoldCard("四，更方便的「填空题卡片」挖空功能", false);
  cardCloze.content.createEl("div", {
    cls: "ah-card-desc",
    text: "挖空标识的转换：如将「hello ==world==」转换为「hello {{c1::world}}。也可将后者转化成前者」"
  });
  new Setting(cardCloze.content)
    .setName("在右侧输入「挖空标记」")
    .setDesc("可输入类似「==、**、$$等标记」，默认 ==")
    .addText(t => t
      .setPlaceholder("==")
      .setValue(this.plugin.settings.clozeMarker || "==")
      .onChange(async v => {
        this.plugin.settings.clozeMarker = v || "==";
        await this.plugin.saveSettings();
      })
    );

  // =========================
  // 卡片 5：作用范围
  // =========================
  const cardScope = createFoldCard("五，本插件作用范围", false);
  cardScope.content.createEl("div", {
    cls: "ah-card-desc",
    text: "选择本插件在哪些文件路径生效。"
  });
  const scopeSetting = new Setting(cardScope.content)
    .setName("运行范围")
    .setDesc("选择插件处理哪些文件")
    .addDropdown(d => {
      d.addOptions({
        all: "全部文件",
        include: "仅在指定文件夹",
        exclude: "排除指定路径",
      })
        .setValue(this.plugin.settings.runScope)
        .onChange(async (v) => {
          this.plugin.settings.runScope = v as any;
          await this.plugin.saveSettings();
          toggleAreas();
        });
    });

  const includeSetting = new Setting(cardScope.content)
    .setName("仅在以下文件夹生效")
    .setDesc("相对库根路径，每行一条。以 `/` 结尾表示文件夹前缀匹配；不以 `/` 结尾则精确到文件路径。");
  const includeArea = includeSetting.controlEl.createEl("textarea");
  includeArea.setAttr("rows", 4);
  includeArea.setAttr("placeholder", "例：\nNotes/Anki/\nInbox/Todo.md");
  includeArea.value = this.plugin.settings.includePaths.join("\n");
  includeArea.addEventListener("change", async () => {
    this.plugin.settings.includePaths = includeArea.value.split(/\n+/)
      .map(s => s.trim())
      .filter(Boolean);
    await this.plugin.saveSettings();
    this.plugin.updateScopePatterns();
  });

  const excludeSetting = new Setting(cardScope.content)
    .setName("排除以下路径")
    .setDesc("相对库根路径，每行一条。以 `/` 结尾表示文件夹前缀匹配；不以 `/` 结尾则精确到文件路径。");
  const excludeArea = excludeSetting.controlEl.createEl("textarea");
  excludeArea.setAttr("rows", 4);
  excludeArea.setAttr("placeholder", "例：\nNotes/Anki/\nInbox/Todo.md");
  excludeArea.value = this.plugin.settings.excludePaths.join("\n");
  excludeArea.addEventListener("change", async () => {
    this.plugin.settings.excludePaths = excludeArea.value.split(/\n+/)
      .map(s => s.trim())
      .filter(Boolean);
    await this.plugin.saveSettings();
    this.plugin.updateScopePatterns();
  });

  const toggleAreas = () => {
    includeSetting.settingEl.toggle(this.plugin.settings.runScope === "include");
    excludeSetting.settingEl.toggle(this.plugin.settings.runScope === "exclude");
  };
  toggleAreas();
}

}


// Obsidian Plugin – Anki Helper
// Implements:
// 1. Under every H4 heading (####) insert a backlink to the heading
// 2. Remove specific characters (` < >) inside H4 heading text itself
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

/** Settings */
interface AnkiHelperSettings {
  headingLevel: number; // default 4 (####)
  targetDeckTemplate: string; // e.g. '[[anki背诵]]::[[filename]]'
  enableTargetDeck: boolean;            // 启用 TARGET DECK 自动插入，增加开关
  enableHeadingOps: boolean;            // 启用 标题清理 + 标题级回链，增加开关
  enableListTidy: boolean;              // 启用 列表清理，增加开关
  excludeGlobs: string[];               // 指定需要跳过的文件（glob 模式）
}

const DEFAULT_SETTINGS: AnkiHelperSettings = {
  headingLevel: 4,
  targetDeckTemplate: "[[anki背诵]]::[[filename]]",
  enableTargetDeck: true,
  enableHeadingOps: true,
  enableListTidy: true,
  excludeGlobs: [],
}

export default class AnkiHelperPlugin extends Plugin {
  settings!: AnkiHelperSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "anki-helper-run",
      name: "Run on current file for Anki（在当前文件运行命令）",
      callback: () => {
        const file = this.getActiveFile();
        if (file) this.processFile(file);
      }
    });

    this.addSettingTab(new AnkiHelperSettingTab(this.app, this));
  }

  onunload(): void {}

  private async processFile(file: TFile): Promise<void> {
    if (this.isExcluded(file)) {
      new Notice("Anki Helper: skipped excluded file");
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

  private isExcluded(file: TFile): boolean {
    const path = file.path;
    return this.settings.excludeGlobs.some(g => globToRegExp(g).test(path));
  }


	private ensureTargetDeck(lines: string[], file: TFile): boolean {
	const marker = "TARGET DECK";
	if (lines.some((l) => l.includes(marker))) return false;

	let idx = 0;                                   // 默认插入位置
	if (lines[0] === "---") {
		const end = lines.indexOf("---", 1);
		if (end > 0) idx = end + 1;                  // YAML 结束行的下一行
	} else {
		const fh = lines.findIndex((l) => l.trim().startsWith("#"));
		if (fh >= 0) idx = fh;
	}

	const tpl = this.settings.targetDeckTemplate.replace(/filename/g, file.basename);

	// ⚡️ 关键：如果紧贴 YAML 尾部，就先插一个空行
	if (idx > 0 && lines[idx - 1] === "---") {
		lines.splice(idx, 0, "");                    // prepend blank line
		idx++;                                       // 调整下标，保持后续顺序
	}

	lines.splice(idx, 0, marker, tpl, "");         // 原有逻辑保持
	return true;
	}


  private rewriteHeadingsAndCollectLists(lines: string[], file: TFile): boolean {
    let changed = false;
    const hPrefix = "#".repeat(this.settings.headingLevel) + " ";
    const noteName = file.basename;
	const start = findYamlEnd(lines);           // ← 从 YAML 之后开始

    for (let i = start; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith(hPrefix)) continue;

      const rawHeading = line.slice(hPrefix.length);
      const cleanHeading = rawHeading.replace(/[`<>]+/g, "").trim();
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

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

  // 标题
  containerEl.createEl("h2", { text: "Anki Helper Settings" });

  // 工具函数：生成“推荐正则”
  const getPattern = (x: number) =>
    `^#{${x}}\\s(.+)\\n*((?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)`;

  // ===== 卡片 1：问题标题设置 =====
  const cardHeading = containerEl.createDiv({ cls: "ah-card" });
  cardHeading.createEl("div", { cls: "ah-card-title", text: "一，确定做卡片用的「问题」所在的标题级别" });
  cardHeading.createEl("div", {
    cls: "ah-card-desc",
    text: "默认为四级标题（####）。可以在下行选择 1～6 级，且“Custom Regexp语法”会自动联动。"
  });

  // 下拉：1..6
  new Setting(cardHeading)
    .setName("请选择「问题」所在的标题级别：（默认为四级标题）")
    .setDesc("注：可点击下方的「复制正则表达式语法」按钮，并粘贴到 obsidian_to_anki插件 的“Custom Regexp”中。")
    .addDropdown(d => {
      d.addOptions({ "1": "#", "2": "##", "3": "###", "4": "####", "5": "#####", "6": "######" })
        .setValue(String(this.plugin.settings.headingLevel))
        .onChange(async (v) => {
          this.plugin.settings.headingLevel = Number(v);
          await this.plugin.saveSettings();
          updateRecommendedRegexp();
        });
    });

  // 推荐正则 + 复制
  const pre = cardHeading.createEl("pre", { cls: "ah-code" });
  const codeEl = pre.createEl("code");
  const actions = cardHeading.createDiv({ cls: "ah-actions" });
  const copyBtn = actions.createEl("button", { text: "复制正则表达式语法" });
  const updateRecommendedRegexp = () => {
    codeEl.setText(getPattern(this.plugin.settings.headingLevel));
  };
  updateRecommendedRegexp();
  copyBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(codeEl.textContent ?? "");
    new Notice("已复制到剪贴板");
  });

  // ===== 卡片 2：TARGET DECK =====
  const cardDeck = containerEl.createDiv({ cls: "ah-card" });
  cardDeck.createEl("div", { cls: "ah-card-title", text: "二，加入 TARGET DECK" });
  cardDeck.createEl("div", { cls: "ah-card-desc", text: "建议加入父牌组，示例：[[anki背诵]]::[[filename]]。（备注：filename即md本身的文件名称，会自动生成）" });

  new Setting(cardDeck)
    .setName("启用 TARGET DECK 自动插入")
    .setDesc("注：在文首（或 YAML 后）插入 “TARGET DECK + 牌组名”，这样方便在anki中定位")
    .addToggle(t => t
      .setValue(this.plugin.settings.enableTargetDeck)
      .onChange(async (v) => {
        this.plugin.settings.enableTargetDeck = v;
        await this.plugin.saveSettings();
      })
    );

  new Setting(cardDeck)
    .setName("TARGET DECK 模板")
    // .setDesc("[[anki背诵]]为父牌组，可按自己使用习惯进行替换,[[filename]] 为当前笔记名，可自动生成子牌组名称")
    .setDesc(createFragment(frag => {
      frag.createEl("div", { text: "[[anki背诵]]为父牌组，可按自己使用习惯进行替换" });
      frag.createEl("div", { text: "[[filename]] 为当前笔记名，可自动生成子牌组名称" });
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

  // ===== 卡片 3：清理与排版 =====
  const cardCleanup = containerEl.createDiv({ cls: "ah-card" });
  cardCleanup.createEl("div", { cls: "ah-card-title", text: "三，清理与排版" });
  cardCleanup.createEl("div", {
    cls: "ah-card-desc",
    text: "清理「问题标题」中的特殊字符并插入回链；删除空列表项；列表与段落间自动插空行。"
  });

  new Setting(cardCleanup)
    .setName("启用：标题清理 + 标题级回链 功能")
    .setDesc("注：清理标题特殊字符后，将不影响[[ ]]的生成。同时插入类似 [[Note#Heading]] 的回链，以方便在anki复习时直接跳到对应的卡片中。")
    .addToggle(t => t
      .setValue(this.plugin.settings.enableHeadingOps)
      .onChange(async (v) => {
        this.plugin.settings.enableHeadingOps = v;
        await this.plugin.saveSettings();
      })
    );

  new Setting(cardCleanup)
    .setName("启用：列表与段落间自动留空行功能")
    .setDesc("注：在列表与后续段落间自动留一空行，这样在anki中显示会更美观。")
    .addToggle(t => t
      .setValue(this.plugin.settings.enableListTidy)
      .onChange(async (v) => {
        this.plugin.settings.enableListTidy = v;
        await this.plugin.saveSettings();
      })
    );

  // ===== 卡片 4：排除文件 =====
  const cardExclude = containerEl.createDiv({ cls: "ah-card" });
  cardExclude.createEl("div", { cls: "ah-card-title", text: "四，排除文件" });
  cardExclude.createEl("div", {
    cls: "ah-card-desc",
    text: "每行一个 Glob 模式，匹配的文件将不会执行本插件。"
  });

  const excludeSetting = new Setting(cardExclude)
    .setName("排除模式")
    .setDesc("示例：**/*.excalidraw.md 或 3R-Templates/**");
  const textarea = excludeSetting.controlEl.createEl("textarea");
  textarea.setAttr("rows", 4);
  textarea.value = this.plugin.settings.excludeGlobs.join("\n");
  textarea.addEventListener("change", async () => {
    this.plugin.settings.excludeGlobs = textarea.value.split(/\n+/)
      .map(s => s.trim())
      .filter(Boolean);
    await this.plugin.saveSettings();
  });
}

}

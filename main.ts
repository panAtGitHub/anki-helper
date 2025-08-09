// Obsidian Plugin – Anki Helper
// Implements:
// 1. Under every H4 heading (####) insert a backlink to the heading
// 2. Remove specific characters (` < >) inside H4 heading text itself
// 3. Check and insert TARGET DECK section below YAML or before first heading
// 4. Delete empty trailing list items (ordered & unordered)
// 5. Ensure one blank line containing a single space between a list and the following paragraph
// Trigger: runs only via default hotkey Ctrl+S (Windows/Linux/macOS）

import { App, Plugin, PluginSettingTab, Setting, MarkdownView, TFile, Notice } from "obsidian";

/* ✨ 新增：通用工具函数 —— 返回 YAML 结束后的第一行下标 */
function findYamlEnd(lines: string[]): number {
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    return end >= 0 ? end + 1 : 0;    // 若未闭合也视作 0
  }
  return 0;
}

/** Settings */
interface AnkiHelperSettings {
  headingLevel: number; // default 4 (####)
  targetDeckTemplate: string; // e.g. '[[anki背诵]]::[[filename]]'
  enableTargetDeck: boolean;            // 启用 TARGET DECK 自动插入，增加开关
  enableHeadingOps: boolean;            // 启用 标题清理 + 标题级回链，增加开关
  enableListTidy: boolean;              // 启用 列表清理，增加开关
}

const DEFAULT_SETTINGS: AnkiHelperSettings = {
  headingLevel: 4,
  targetDeckTemplate: "[[anki背诵]]::[[filename]]",
  enableTargetDeck: true,
  enableHeadingOps: true,
  enableListTidy: true,
}

export default class AnkiHelperPlugin extends Plugin {
  settings!: AnkiHelperSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "anki-helper-run",
      name: "Run Anki Helper on current file",
      callback: () => {
        const file = this.getActiveFile();
        if (file) this.processFile(file);
      },
      hotkeys: [{ modifiers: ["Ctrl"], key: "s" }]
    });

    this.addSettingTab(new AnkiHelperSettingTab(this.app, this));
  }

  onunload(): void {}

  private async processFile(file: TFile): Promise<void> {
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
    containerEl.createEl("h2", { text: "Anki Helper Settings" });
    // 插件使用教程
    containerEl.createEl("p", { text: "使用说明：在文件中，按 Ctrl+S（可修改快捷键）即可执行卡片生成前的清理操作。" });
    containerEl.createEl("ul", {});
    containerEl.createEl("li", { text: "1. 清理「问题」标题中的特殊字符，并插入标题级回链。" });
    containerEl.createEl("li", { text: "2. 在文件开头生成 TARGET DECK （建议加入父牌组）。" });
    containerEl.createEl("li", { text: "3. 清理空的列表，并在列表和段落间添加空行。" });

	  // Custom Regexp 推荐语法
    // containerEl.createEl("h2", { text: "Custom Regexp 推荐语法" });
	  // containerEl.createEl("pre", { text: "^#{4}\\s(.+)\\n*((?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)" });
    // containerEl.createEl("button", { text: "复制以上语法的正则表达式" }, (btn) => {
    //   btn.addEventListener("click", () => {
    //     navigator.clipboard.writeText("^#{4}\\s(.+)\\n*((?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)");
    //     new Notice("正则已复制，请填到Obsidian_to_Anki插件的Custom Regexp表达式里");
    //   });
    // });

    // —— 标题级别设置 + Custom Regexp 推荐语法（联动） —— //
    const getPattern = (x: number) =>
      `^#{${x}}\\s(.+)\\n*((?:\\n(?:^[^\\n#].{0,2}$|^[^\\n#].{3}(?<!<!--).*))+)`;
    let codeEl: HTMLElement | null = null;
    const updateRecommendedRegexp = () => {
      if (!codeEl) return;
      codeEl.setText(getPattern(this.plugin.settings.headingLevel));
    };

    // ① 标题级别下拉（1–6），默认 4
    new Setting(containerEl)
      .setName("用于卡片问题的标题级别")
      .setDesc("默认 4（####）。选择 1–6 级，影响下方推荐正则以及处理逻辑。")
      .addDropdown(d => {
        d.addOptions({ "1": "#", "2": "##", "3": "###", "4": "####", "5": "#####", "6": "######" })
        .setValue(String(this.plugin.settings.headingLevel))
        .onChange(async (v) => {
          this.plugin.settings.headingLevel = Number(v);
          await this.plugin.saveSettings();
          updateRecommendedRegexp();   // 联动更新推荐语法
        });
      });

     // ② 推荐语法展示 + 复制按钮（随 x 联动）
    containerEl.createEl("p", { text: "Custom Regexp 推荐语法" });
    const pre = containerEl.createEl("pre");
    codeEl = pre.createEl("code");
    updateRecommendedRegexp();
    containerEl.createEl("button", { text: "复制以上语法的正则表达式" }, (btn) => {
      btn.addEventListener("click", () => {
        navigator.clipboard.writeText(codeEl!.textContent ?? "");
        new Notice("正则已复制，请填到 Obsidian_to_Anki 的 Custom Regexp 里");
      });
    });

    // —— 功能开关 —— //
    new Setting(containerEl)
      .setName("启用 TARGET DECK 自动插入")
      .setDesc("在文档开头（或首个标题前）插入 “TARGET DECK + 模板行”。")
      .addToggle(t => t
        .setValue(this.plugin.settings.enableTargetDeck)
        .onChange(async (v) => {
          this.plugin.settings.enableTargetDeck = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Target Deck 模板")
      .setDesc("建议加入父牌组")
      .addText((text) =>
        text
          .setPlaceholder("[[anki背诵]]::[[filename]]")
          .setValue(this.plugin.settings.targetDeckTemplate)
          .onChange(async (value) => {
            this.plugin.settings.targetDeckTemplate = value.trim() || "[[anki背诵]]::[[filename]]";
            await this.plugin.saveSettings();
          })
      );
      
    new Setting(containerEl)
      .setName("启用 标题清理 + 标题级回链")
      .setDesc("清理「问题标题」中的特殊字符，并在该标题下插入 [[Note#Heading]] 回链。")
      .addToggle(t => t
        .setValue(this.plugin.settings.enableHeadingOps)
        .onChange(async (v) => {
          this.plugin.settings.enableHeadingOps = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("启用 列表清理")
      .setDesc("删除空的列表项；并在列表与后续段落间自动留一空行（不含 HTML 注释）。")
      .addToggle(t => t
        .setValue(this.plugin.settings.enableListTidy)
        .onChange(async (v) => {
          this.plugin.settings.enableListTidy = v;
          await this.plugin.saveSettings();
        })
      );

  }
}

# Anki Helper for Obsidian

一个与 obsidian_to_anki 配合使用的增强插件，围绕“用标题做题干、标题下文本做答案”的工作流，提供更顺手的制卡体验：自动插入牌组信息、生成标题级回链、清理标题字符、整理列表空行、快速进行 Cloze（填空）标记转换，并支持按路径控制作用范围。内置中英文设置界面与用于 obsidian_to_anki 的正则生成器。

An enhancement plugin that pairs with obsidian_to_anki for workflows where headings act as questions and following text as answers. It inserts a target deck, adds heading-level backlinks, cleans title characters, tidies list spacing, converts cloze markers, and lets you scope where it runs. Includes bilingual settings (ZH/EN) and a regexp helper for obsidian_to_anki.

## 功能概览 / Features

- 目标牌组：支持写入到正文或 YAML；支持模板与 `[[filename]]` 变量，且可在两处同时存在时按配置自动清理另一处。
- 标题级回链：在设定的“问答题标题级别”和“填空题标题级别”下，自动插入 `[[Note#Heading]]` 回链，复习时可直接回跳到卡片位置。
- 标题清理：从卡片标题中移除指定字符（默认移除 `` ` < > [ ] ``，可自定义，以空格分隔）。
- 列表整理：删除空的列表项；在列表与后续段落之间自动插入一行（仅含空格），便于在 Anki 中更美观显示。
- Cloze 转换：将对称标记（默认 `==`，也可用 `**`、`$$` 等）转换为 `{{cN::…}}`，支持“同时出现 (c1)”与“按序出现 (c1,c2,…)”；支持将 `{{cN::…}}` 还原为自定义标记。
- 作用范围：支持全部、仅包含、排除路径三种模式，支持文件夹（以 `/` 结尾）与单文件精确匹配。
- 定时批处理：可按 15/30/60 分钟固定间隔自动检测并批量处理当前作用范围内的脏文件；默认关闭，启动后不会立即执行第一轮。
  - 支持静默模式：定时批处理成功或无匹配文件时不提示，仅失败时提示；手动批处理仍显示汇总。
- 正则助手：根据你选择的“问答题/填空题标题级别”，一键复制 obsidian_to_anki 的 Custom Regexp 语法。
- 多语言：设置页支持中文与英文。

## 命令 / Commands

- Insert Deck & Backlink：
  - 插入 `TARGET DECK`（若不存在）；
  - 在卡片标题（两种级别）下方插入或更新回链；
  - 清理卡片标题中的指定字符；
  - 整理列表与段落的空行；
  - 仅处理当前笔记，支持按“作用范围”设置过滤文件。
- Batch process all in-scope files: insert deck & backlink：
  - 对当前“作用范围”内的全部 Markdown 文件批量执行与单文件命令相同的处理；
  - `include` 模式下优先定向扫描指定目录/文件，减少无关遍历；
  - 使用增量索引，只重跑新增、已修改或受设置变更影响的文件。
- 删除标题级回链：
  - 仅处理当前笔记，支持按“作用范围”设置过滤文件；
  - 删除当前文件正文中所有独立一行的 `[[Note#Heading]]` 标题级回链；
  - 不修改 `TARGET DECK`、标题文本或列表空行。
- Cloze: Convert markers → `{{c1::…}}`（答案同时出现）。
- Cloze: Convert markers → `{{c1::…}}, {{c2::…}}…`（答案按顺序出现）。
- Cloze: Restore `{{cN::…}}` → markers（将 `{{cN::…}}` 还原为自定义对称标记）。

提示：Cloze 转换优先在“填空题标题级别”的块内生效（从该级标题下一行到空行为止）。若选区/文本中找不到此级标题，则对整个选区或全文处理。

## 设置项 / Settings

- 语言：切换中文或英文界面。
- 卡片标题级别：
  - 问答题卡片标题级别（默认 H4）。
  - 填空题卡片标题级别（默认 H5，不应与问答题级别相同）。
  - 提供对应的 Custom Regexp 语法，点击“复制”后粘贴到 obsidian_to_anki 的设置中。
- TARGET DECK：
  - 开关：是否自动插入 `TARGET DECK`。
  - 写入位置：可选择写入正文（原先格式）或 YAML 区（`TARGET DECK: ...`）。
  - 模板：例如 `[[anki背诵]]::[[filename]]`，其中 `[[filename]]` 会被替换为当前文件名作为子牌组。
- 标题与回链：
  - 开关：是否执行标题清理与回链插入。
  - 要移除的字符：以空格分隔的字符列表，默认 `` ` < > [ ] ``。
- 列表整理：开启后删除空列表项，并在列表与段落之间自动留一行（仅含空格）。
- Cloze 标记：为“对称标记”输入框设置你常用的标记（默认 `==`）。
- 作用范围：
  - 模式：全部文件 / 仅在指定文件夹 / 排除指定路径。
  - 语法：每行一条相对库根的路径。以 `/` 结尾表示文件夹前缀匹配（内部等价于 `**` 通配）；否则为精确文件路径。
  - 示例：
    - 仅包含：`Notes/Anki/`、`Inbox/Todo.md`
    - 排除：`Archive/`、`Templates/Card.md`
- 定时批处理：
  - 开关：是否按固定间隔自动运行批处理。
  - 间隔：支持 15 / 30 / 60 分钟。
  - 行为：仅处理当前作用范围内的脏文件；插件启动后不会立即执行第一轮。
  - 静默模式：仅影响定时批处理。开启后成功和无匹配文件时不提示，仅失败时提示。

## 快速开始 / Quick Start

1) 在 Obsidian 启用插件后，打开“Anki Helper”设置：
   - 选择界面语言；
   - 选择问答题/填空题的标题级别，并将提供的 Custom Regexp 复制到 obsidian_to_anki；
   - 根据需要配置 TARGET DECK 模板、标题清理字符、列表整理与作用范围。
2) 在要处理的笔记中，运行命令面板里的 “Insert Deck & Backlink”。
   - 若要一次处理作用范围内的全部文件，运行批处理命令 “Batch process all in-scope files: insert deck & backlink”。
3) 需要挖空时，选中文本（或不选以处理全文），运行所需的 Cloze 命令。

## 安装 / Install

- 本地开发/手动安装：将本项目放入你的库目录下的 `.obsidian/plugins/Anki_Helper`，在 Obsidian 设置中启用即可。
- 若需构建：在项目目录执行 `npm install` 与 `npm run build` 生成 `main.js` 后再启用。

要求：Obsidian ≥ 1.5.0，仅桌面端可用。

## 作用范围示例 / Scope Demo

运行 `node scripts/scope-demo.js` 可验证某路径是否会被处理或跳过；脚本会输出每个路径是 "processed" 还是 "skipped"。（注意：该脚本仅用于开发/调试，发布到 Obsidian 插件市场时不会随插件一起分发。）

Run `node scripts/scope-demo.js` to check which sample paths fall inside or outside of the chosen scope and would therefore be processed or skipped.

## 兼容性与致谢 / Notes

- 主要与 obsidian_to_anki 配合使用；设置页内置了该插件所需的 Custom Regexp 生成与复制按钮。
- 标题级回链为 `[[笔记名#标题]]` 形式；标题清理仅作用于标题本身，不改动正文。
- 列表整理会删除空的列表项，并在列表与后续段落之间插入一行仅含空格的占位行以优化导出显示。
- 批处理逻辑位于 `src/batch/batch-processor.ts`，并在插件 `data.json` 中维护增量索引；首次运行会建索引，后续只处理变更文件。

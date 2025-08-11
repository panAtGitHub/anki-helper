# Anki Helper for Obsidian

obsidian_to_Anki 无疑是个非常好用的插件，且提供了非常丰富的制卡方式。
而我本人比较喜欢用：四级标题做问题，四级标题下的文字做答案
因此围绕以上制卡方式，通过本插件我提供了进一步的卡片定制化功能，可以更好地配合obsidian_to_Anki进行制卡

通过本插件的定制化后，你可以得到
1. 生成带有「父牌组::子牌组」这样的卡组名
2. 在四级标题下生成「标题级的回链」，这样在anki中复习时可以直接跳转到该问题标题，以进行修改
3. 对卡片里的标题、内容做了些字符上的清理，可以更好地配合obsidian_to_Anki插件生成更美观的卡片
4. 可指定 Glob 模式以排除某些文件，不对这些文件执行命令

**obsidian\_to\_Anki** is already a terrific plugin with a rich set of card-creation modes.
My preferred workflow is simple: use an **H4 heading as the question** and the **text right below it as the answer**.
This companion plugin adds an extra layer of customization around that workflow so it meshes even better with obsidian\_to\_Anki.

After running it, you get:

1. **Deck names in the form `ParentDeck::SubDeck`** automatically generated.
2. A **“heading-level backlink”** inserted right under every H4 question, letting you jump straight to that section in Obsidian while reviewing in Anki.
3. Small character-level clean-ups on both headings and content, yielding tidier cards when processed by obsidian\_to\_Anki.
4. Ability to skip files matching user-provided glob patterns.

## 排除模式示例 / Exclusion demo

运行 `node scripts/exclude-demo.js` 可以快速验证某个文件是否会被排除；
示例脚本会输出每个路径是 "excluded" 还是 "processed"。

Run `node scripts/exclude-demo.js` to see which sample paths match the configured
globs and would be skipped by the plugin.

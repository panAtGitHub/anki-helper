# Repository Instructions

## Default Delivery Workflow

- After completing code changes in this repository, automatically use the `anki-helper-dev-sync` skill without waiting for an extra reminder from the user.
- The default finish sequence is:
  1. `git status --short` and `git diff --stat`
  2. `npm run lint`
  3. `npm run build`
  4. Create a git commit with both English and Chinese summaries
  5. Sync `main.js`, `manifest.json`, and `styles.css` to:
     `/Users/panxiaorong/Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian/.obsidian/plugins/Anki Helper`
- Never overwrite or delete the destination `data.json`.
- If `lint` or `build` fails, stop and report the failure instead of committing or syncing.

## Scope

- These instructions apply to this repository only:
  `/Users/panxiaorong/Documents/ObsidianPluginCode/AnkiHelperForCoding`

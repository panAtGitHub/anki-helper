import { Notice, TFile, TFolder, type App, type CachedMetadata } from "obsidian";

import type { LocaleText } from "../lang/types";
import type { AnkiHelperSettings } from "../plugin-types";

export interface BatchFileState {
  mtime: number;
  configSig: string;
}

export interface BatchState {
  schemaVersion: 1;
  filesByPath: Record<string, BatchFileState>;
}

export interface BatchSummary {
  candidates: number;
  dirty: number;
  processed: number;
  skipped: number;
  failed: number;
}

export interface BatchDeps {
  app: App;
  settings: AnkiHelperSettings;
  locale: LocaleText;
  isInScope: (file: TFile) => boolean;
  processFile: (file: TFile, options?: { skipScopeCheck?: boolean }) => Promise<void>;
  getBatchState: () => BatchState;
  saveBatchState: (state: BatchState) => Promise<void>;
}

const BATCH_SCHEMA_VERSION = 1;
const BATCH_YIELD_INTERVAL = 20;

export function normalizeBatchState(raw: unknown): BatchState {
  if (!raw || typeof raw !== "object") {
    return { schemaVersion: BATCH_SCHEMA_VERSION, filesByPath: {} };
  }
  const obj = raw as { schemaVersion?: number; filesByPath?: Record<string, BatchFileState> };
  return {
    schemaVersion: BATCH_SCHEMA_VERSION,
    filesByPath: obj.filesByPath ?? {},
  };
}

export async function runBatchProcess(deps: BatchDeps): Promise<BatchSummary> {
  const { app, locale, settings } = deps;
  const batchState = normalizeBatchState(deps.getBatchState());
  const configSig = createConfigSignature(settings);
  const candidates = collectCandidates(app, settings, deps.isInScope);

  pruneBatchState(batchState, candidates);

  if (candidates.length === 0) {
    new Notice(locale.noticeBatchNoEligibleFiles);
    await deps.saveBatchState(batchState);
    return { candidates: 0, dirty: 0, processed: 0, skipped: 0, failed: 0 };
  }

  const summary: BatchSummary = {
    candidates: candidates.length,
    dirty: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
  };

  for (let i = 0; i < candidates.length; i++) {
    const file = candidates[i];
    const currentState = batchState.filesByPath[file.path];
    const dirty = isDirtyFile(file, currentState, configSig);
    if (!dirty) {
      summary.skipped++;
      continue;
    }

    summary.dirty++;

    try {
      const shouldWrite = await shouldProcessFile(app, file, settings);
      if (shouldWrite) {
        await deps.processFile(file, { skipScopeCheck: true });
        summary.processed++;
        batchState.filesByPath[file.path] = {
          mtime: Date.now(),
          configSig,
        };
      } else {
        summary.skipped++;
        batchState.filesByPath[file.path] = {
          mtime: file.stat.mtime,
          configSig,
        };
      }
    } catch (error) {
      summary.failed++;
      console.error(`Anki Helper: batch processing failed for ${file.path}`, error);
    }

    if ((i + 1) % BATCH_YIELD_INTERVAL === 0) {
      await Promise.resolve();
    }
  }

  await deps.saveBatchState(batchState);
  new Notice(formatBatchSummary(locale.noticeBatchSummary, summary));
  return summary;
}

function collectCandidates(app: App, settings: AnkiHelperSettings, isInScope: (file: TFile) => boolean): TFile[] {
  const filesByPath = new Map<string, TFile>();

  if (settings.runScope === "include") {
    for (const rawPath of settings.includePaths) {
      const path = rawPath.trim();
      if (!path) continue;

      const lookupPath = path.endsWith("/") ? path.replace(/\/+$/, "") : path;
      const abstractFile = app.vault.getAbstractFileByPath(lookupPath);
      if (abstractFile instanceof TFile) {
        if (abstractFile.extension === "md") {
          filesByPath.set(abstractFile.path, abstractFile);
        }
        continue;
      }
      if (abstractFile instanceof TFolder) {
        collectFolderMarkdownFiles(abstractFile, filesByPath);
      }
    }
    return Array.from(filesByPath.values()).filter(isInScope);
  }

  for (const file of app.vault.getMarkdownFiles()) {
    if (settings.runScope === "all" || isInScope(file)) {
      filesByPath.set(file.path, file);
    }
  }
  return Array.from(filesByPath.values());
}

function collectFolderMarkdownFiles(folder: TFolder, filesByPath: Map<string, TFile>): void {
  for (const child of folder.children) {
    if (child instanceof TFile && child.extension === "md") {
      filesByPath.set(child.path, child);
    } else if (child instanceof TFolder) {
      collectFolderMarkdownFiles(child, filesByPath);
    }
  }
}

function pruneBatchState(batchState: BatchState, candidates: TFile[]): void {
  const candidatePaths = new Set(candidates.map((file) => file.path));
  for (const path of Object.keys(batchState.filesByPath)) {
    if (!candidatePaths.has(path)) {
      delete batchState.filesByPath[path];
    }
  }
}

function createConfigSignature(settings: AnkiHelperSettings): string {
  return JSON.stringify({
    headingLevel: settings.headingLevel,
    clozeHeadingLevel: settings.clozeHeadingLevel,
    headingRemoveChars: settings.headingRemoveChars,
    targetDeckTemplate: settings.targetDeckTemplate,
    enableTargetDeck: settings.enableTargetDeck,
    targetDeckLocation: settings.targetDeckLocation,
    enableHeadingOps: settings.enableHeadingOps,
    enableListTidy: settings.enableListTidy,
    runScope: settings.runScope,
    includePaths: settings.includePaths,
    excludePaths: settings.excludePaths,
  });
}

function isDirtyFile(file: TFile, state: BatchFileState | undefined, configSig: string): boolean {
  if (!state) return true;
  return file.stat.mtime > state.mtime || state.configSig !== configSig;
}

async function shouldProcessFile(app: App, file: TFile, settings: AnkiHelperSettings): Promise<boolean> {
  if (!settings.enableTargetDeck && !settings.enableHeadingOps && !settings.enableListTidy) {
    return false;
  }

  const cache = app.metadataCache.getFileCache(file);
  const raw = await app.vault.cachedRead(file);
  const lines = raw.split(/\r?\n/);
  if (settings.enableTargetDeck && targetDeckNeedsUpdate(lines, file, settings, cache)) {
    return true;
  }

  if (!settings.enableHeadingOps && !settings.enableListTidy) {
    return false;
  }

  const start = getContentStartLine(lines, cache);

  if (settings.enableHeadingOps && headingsNeedRewrite(lines, file, settings, cache, start)) {
    return true;
  }
  if (settings.enableListTidy && listsNeedTidy(lines, start)) {
    return true;
  }

  return false;
}

function targetDeckNeedsUpdate(
  lines: string[],
  file: TFile,
  settings: AnkiHelperSettings,
  cache?: CachedMetadata | null,
): boolean {
  const expected = settings.targetDeckTemplate.replace(/filename/g, file.basename);
  const location = settings.targetDeckLocation ?? "body";
  const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
  const yamlValue = frontmatter?.["TARGET DECK"];
  const bodyValue = getBodyTargetDeck(lines);

  if (location === "yaml") {
    return yamlValue !== expected || bodyValue !== null;
  }
  return bodyValue !== expected || yamlValue !== undefined;
}

function getBodyTargetDeck(lines: string[]): string | null {
  const markerIndex = lines.findIndex((line) => line.trim() === "TARGET DECK");
  if (markerIndex < 0) {
    return null;
  }
  const nextLine = lines[markerIndex + 1];
  if (nextLine === undefined) return "";
  return nextLine.trim();
}

function headingsNeedRewrite(
  lines: string[],
  file: TFile,
  settings: AnkiHelperSettings,
  cache: CachedMetadata | null | undefined,
  start: number,
): boolean {
  const qaLvl = settings.headingLevel ?? 4;
  const clozeLvl = settings.clozeHeadingLevel ?? 5;
  const prefixes = new Set<string>(["#".repeat(qaLvl) + " ", "#".repeat(clozeLvl) + " "]);
  const removeRegex = buildHeadingRemoveRegex(settings.headingRemoveChars);

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    let prefix: string | null = null;
    for (const candidate of prefixes) {
      if (line.startsWith(candidate)) {
        prefix = candidate;
        break;
      }
    }
    if (!prefix) continue;

    const rawHeading = line.slice(prefix.length);
    const cleanHeading = rawHeading.replace(removeRegex, "").trim();
    if (rawHeading !== cleanHeading) {
      return true;
    }

    const backlink = `[[${file.basename}#${cleanHeading}]]`;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j >= lines.length || lines[j].trim() !== backlink) {
      return true;
    }
  }

  return false;
}

function listsNeedTidy(lines: string[], start: number): boolean {
  const isList = (line: string) => /^(\s*)([-+*]|\d+\.)\s*/.test(line);
  const isEmptyItem = (line: string) => /^(\s*)([-+*]|\d+\.)\s*$/.test(line);
  const isBlankLine = (line: string) => /^\s*$/.test(line);
  const isHtmlCmt = (line: string) => /^\s*<!--.*-->/.test(line);

  for (let i = start; i < lines.length; i++) {
    if (!isList(lines[i])) continue;
    let end = i;
    while (end + 1 < lines.length && isList(lines[end + 1])) end++;

    for (let j = i; j <= end; j++) {
      if (isEmptyItem(lines[j])) {
        return true;
      }
    }

    const nextLine = lines[end + 1];
    if (nextLine !== undefined && !isBlankLine(nextLine) && !isList(nextLine) && !isHtmlCmt(nextLine)) {
      return true;
    }

    i = end;
  }

  return false;
}

function getContentStartLine(lines: string[], cache?: CachedMetadata | null): number {
  const end = cache?.frontmatterPosition?.end;
  if (end && end.line >= 0 && end.line < lines.length) {
    return end.line + 1;
  }
  return findYamlEnd(lines);
}

function findYamlEnd(lines: string[]): number {
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    return end >= 0 ? end + 1 : 0;
  }
  return 0;
}

function buildHeadingRemoveRegex(rawChars: string): RegExp {
  const tokens = (rawChars.trim() || "` < > [ ]").split(/\s+/).filter(Boolean);
  const pattern = tokens.length ? tokens.map(escapeRegExp).join("|") : "`|<|>|\\[|\\]";
  return new RegExp(pattern, "g");
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatBatchSummary(template: string, summary: BatchSummary): string {
  return template
    .replace("{candidates}", String(summary.candidates))
    .replace("{dirty}", String(summary.dirty))
    .replace("{processed}", String(summary.processed))
    .replace("{skipped}", String(summary.skipped))
    .replace("{failed}", String(summary.failed));
}

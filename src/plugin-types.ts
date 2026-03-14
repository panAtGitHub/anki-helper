export interface AnkiHelperSettings {
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
  enableScheduledBatch: boolean;
  scheduledBatchIntervalMinutes: 15 | 30 | 60;
  silentScheduledBatch: boolean;
  clozeMarker?: string;
}

export const DEFAULT_SETTINGS: AnkiHelperSettings = {
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
  enableScheduledBatch: false,
  scheduledBatchIntervalMinutes: 30,
  silentScheduledBatch: true,
  clozeMarker: "==",
};

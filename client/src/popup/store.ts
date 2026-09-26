// client/src/popup/store.ts
import { create } from "zustand";
import type { ScanResultMessage } from "../content/index";
import type { Suggestion, UserProfile } from "../types/index";
import { EMPTY_CHECKS, type PrepareChecks, type PrepareStatus } from "./health";

export const DISCLAIMER =
  "RBG Candidate automates form filling but does not provide legal advice. Ensure compliance with job site terms.";

export type PopupTab = "settings" | "prepare" | "fill" | "review";
export type StageDecision = "pending" | "filled" | "skipped";
export type AiStatus = "idle" | "running" | "done" | "offline";

export interface ServerStatus {
  online: boolean;
  workers: number;
  available: number;
  models: string[];
}

export interface ScanStats {
  aiTasks: number;
  workersUsed: number;
  profileFields: number;
  seconds: number;
  models: string[];
}

export type ProfileFieldKey = keyof Omit<UserProfile, "updatedAt" | "details">;

export const PROFILE_FIELDS: Array<{ key: ProfileFieldKey; label: string }> = [
  { key: "fullName", label: "Full name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "headline", label: "Headline" },
  { key: "summary", label: "Summary" },
  { key: "resume", label: "Resume / extra details (used by AI workers)" },
];

export function profileFieldValue(
  profile: UserProfile | null,
  field: string,
): string {
  if (profile === null) {
    return "";
  }
  switch (field) {
    case "fullName":
      return profile.fullName ?? "";
    case "email":
      return profile.email ?? "";
    case "phone":
      return profile.phone ?? "";
    case "headline":
      return profile.headline ?? "";
    case "summary":
      return profile.summary ?? "";
    case "resume":
      return profile.resume ?? "";
    default:
      return "";
  }
}

interface PopupState {
  tab: PopupTab;
  profile: UserProfile | null;
  scan: ScanResultMessage | null;
  scanning: boolean;
  filling: boolean;
  previewOpen: boolean;
  selected: Record<string, boolean>;
  stageDecisions: Record<string, StageDecision>;
  suggestions: Record<string, Suggestion>;
  server: ServerStatus | null;
  setServer: (server: ServerStatus | null) => void;
  prepareStatus: PrepareStatus;
  prepareChecks: PrepareChecks;
  prepareLastCheckedAt: number | null;
  setPrepare: (status: PrepareStatus, checks?: PrepareChecks) => void;
  aiStatus: AiStatus;
  aiInfo: string | null;
  scanStats: ScanStats | null;
  setScanStats: (stats: ScanStats | null) => void;
  error: string | null;
  notice: string | null;
  setSuggestions: (suggestions: Record<string, Suggestion>) => void;
  editSuggestion: (id: string, value: string) => void;
  setAiStatus: (status: AiStatus, info?: string | null) => void;
  setTab: (tab: PopupTab) => void;
  setProfile: (profile: UserProfile | null) => void;
  setScan: (scan: ScanResultMessage | null) => void;
  setScanning: (scanning: boolean) => void;
  setFilling: (filling: boolean) => void;
  setPreviewOpen: (open: boolean) => void;
  setSelected: (selected: Record<string, boolean>) => void;
  toggleField: (field: string) => void;
  setStageDecision: (stage: string, decision: StageDecision) => void;
  setError: (error: string | null) => void;
  setNotice: (notice: string | null) => void;
}

export function selectAllFields(fields: Record<string, string>): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const key of Object.keys(fields)) {
    next[key] = true;
  }
  return next;
}

export const usePopupStore = create<PopupState>()((set) => ({
  tab: "settings",
  profile: null,
  scan: null,
  scanning: false,
  filling: false,
  previewOpen: false,
  selected: {},
  stageDecisions: {},
  suggestions: {},
  server: null,
  setServer: (server) => set({ server }),
  prepareStatus: "unknown",
  prepareChecks: EMPTY_CHECKS,
  prepareLastCheckedAt: null,
  setPrepare: (prepareStatus, checks) =>
    set(
      checks === undefined
        ? { prepareStatus }
        : {
            prepareStatus,
            prepareChecks: checks,
            prepareLastCheckedAt: Date.now(),
            server: {
              online: checks.server,
              workers: checks.workersTotal,
              available: checks.workers,
              models: checks.models,
            },
          },
    ),
  aiStatus: "idle",
  aiInfo: null,
  scanStats: null,
  setScanStats: (scanStats) => set({ scanStats }),
  error: null,
  notice: null,
  setTab: (tab) => set({ tab, error: null, notice: null }),
  setProfile: (profile) => set({ profile }),
  setScan: (scan) => set({ scan }),
  setScanning: (scanning) => set({ scanning }),
  setFilling: (filling) => set({ filling }),
  setPreviewOpen: (previewOpen) => set({ previewOpen }),
  setSelected: (selected) => set({ selected }),
  toggleField: (field) =>
    set((state) => ({
      selected: { ...state.selected, [field]: !(state.selected[field] ?? false) },
    })),
  setStageDecision: (stage, decision) =>
    set((state) => ({
      stageDecisions: { ...state.stageDecisions, [stage]: decision },
    })),
  setSuggestions: (suggestions) => set({ suggestions }),
  editSuggestion: (id, value) =>
    set((state) => {
      const prev = state.suggestions[id];
      const next: Suggestion = prev
        ? { ...prev, value, source: prev.source === "none" && value !== "" ? "profile" : prev.source }
        : { value, source: "profile", confidence: 1 };
      return { suggestions: { ...state.suggestions, [id]: next } };
    }),
  setAiStatus: (aiStatus, info = null) => set({ aiStatus, aiInfo: info }),
  setError: (error) => set({ error }),
  setNotice: (notice) => set({ notice }),
}));

/** Pre-select every field that has a non-empty suggested value. */
export function selectFilled(suggestions: Record<string, Suggestion>): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const [id, s] of Object.entries(suggestions)) {
    next[id] = s.value !== "";
  }
  return next;
}

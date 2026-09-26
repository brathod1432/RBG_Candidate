// client/src/types/index.ts

export interface UserProfile {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  headline: string | null;
  summary: string | null;
  /** Free-form resume / extra facts the AI workers may use (optional). */
  resume?: string | null;
  /** Structured CV imported from the Markdown template (optional). */
  details?: ProfileDetails;
  updatedAt: number;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  location: string;
  employmentType: string;
  /** Normalised "YYYY-MM" (or "YYYY"); "" when unknown. */
  start: string;
  /** Normalised "YYYY-MM", "present", or "". */
  end: string;
  bullets: string[];
}

export interface EducationEntry {
  school: string;
  degree: string;
  field: string;
  start: string;
  end: string;
  grade: string;
  notes: string[];
}

export interface ProjectEntry {
  name: string;
  link: string;
  bullets: string[];
}

/** Everything the Markdown template can carry. */
export interface ProfileDetails {
  personal: Record<string, string>;
  headline: string;
  summary: string;
  experience: ExperienceEntry[];
  education: EducationEntry[];
  skills: Record<string, string[]>;
  /**
   * Skill categories in the order the user wrote them (most important first).
   * chrome.storage sorts object keys alphabetically, so the order of `skills`
   * itself does not survive a save; always read skills via orderedSkillEntries().
   */
  skillOrder?: string[];
  languages: Array<{ language: string; level: string }>;
  certifications: string[];
  projects: ProjectEntry[];
  answers: Record<string, string>;
  /** Computed from experience dates (overlaps merged), one decimal. */
  totalYears: number;
  importedAt: number;
}

export interface FieldMap {
  [profileField: string]: string;
}

export interface StageHint {
  stage: string;
  confidence: number;
  reason: string;
  updatedAt: number;
}

export type FieldControlType =
  | "text"
  | "email"
  | "tel"
  | "number"
  | "url"
  | "search"
  | "textarea"
  | "select";

/** One fillable control on the page, as sent to POST /fill. */
export interface FieldDescriptor {
  /** Stable key for this scan (element id, else name, else field-N). */
  id: string;
  selector: string;
  label: string;
  type: FieldControlType;
  placeholder: string;
  options: string[];
  required: boolean;
  maxLength?: number;
  /** Local profile key when the heuristic recognises the field. */
  profileKey?: string;
}

export interface JobContext {
  title?: string;
  company?: string;
  url?: string;
  description?: string;
}

/** One suggested value shown in Review (editable before fill). */
export interface Suggestion {
  value: string;
  source: "profile" | "ai" | "none";
  confidence: number;
  model?: string;
  workerId?: number;
  error?: string;
}

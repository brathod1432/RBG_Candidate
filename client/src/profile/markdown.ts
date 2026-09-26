// client/src/profile/markdown.ts
// Parse the Markdown CV template into ProfileDetails, and back.
// Tolerant by design: unknown keys/sections are kept as answers, HTML
// comments are ignored, dates accept several formats.
import { orderedSkillEntries } from "./skills";
import type {
  EducationEntry,
  ExperienceEntry,
  ProfileDetails,
  ProjectEntry,
  UserProfile,
} from "../types/index";

export const RESUME_TEXT_MAX = 20_000;

export interface ParseResult {
  details: ProfileDetails;
  warnings: string[];
}

// ── keys ─────────────────────────────────────────────────────────────────

const norm = (s: string): string =>
  s.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();

const PERSONAL_ALIASES: Record<string, string[]> = {
  first_name: ["first name", "given name", "forename", "firstname"],
  middle_name: ["middle name", "middle names", "middle name s"],
  last_name: ["last name", "surname", "family name", "lastname"],
  preferred_name: ["preferred name", "nickname"],
  full_name: ["full name", "name", "legal name"],
  email: ["email", "e mail", "email address"],
  phone: ["phone", "mobile", "telephone", "phone number", "mobile phone"],
  city: ["city", "town"],
  country: ["country"],
  location: ["location", "current location"],
  address: ["address", "street address"],
  postal_code: ["postal code", "zip", "zip code", "postcode"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile"],
  github: ["github", "github url"],
  website: ["website", "portfolio", "personal website", "portfolio website", "web"],
  work_authorization: ["work authorization", "work authorisation", "right to work", "work permit"],
  visa_sponsorship: ["requires visa sponsorship", "visa sponsorship", "sponsorship", "need sponsorship"],
  willing_to_relocate: ["willing to relocate", "relocation", "relocate"],
  work_mode: ["preferred work mode", "work mode", "remote preference"],
  notice_period: ["notice period", "notice"],
  available_from: ["available from", "availability", "start date", "earliest start date"],
  desired_salary: ["desired salary", "salary expectation", "salary expectations", "expected salary"],
  gender: ["gender", "sex"],
};

export const PERSONAL_LABELS: Array<[string, string]> = [
  ["first_name", "First name"],
  ["middle_name", "Middle name"],
  ["last_name", "Last name"],
  ["preferred_name", "Preferred name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["city", "City"],
  ["country", "Country"],
  ["address", "Address"],
  ["postal_code", "Postal code"],
  ["linkedin", "LinkedIn"],
  ["github", "GitHub"],
  ["website", "Website"],
  ["work_authorization", "Work authorization"],
  ["visa_sponsorship", "Requires visa sponsorship"],
  ["willing_to_relocate", "Willing to relocate"],
  ["work_mode", "Preferred work mode"],
  ["notice_period", "Notice period"],
  ["available_from", "Available from"],
  ["desired_salary", "Desired salary"],
  ["gender", "Gender"],
];

const EXPERIENCE_KEYS: Record<string, keyof ExperienceEntry | "dates"> = {
  company: "company", employer: "company", organisation: "company", organization: "company",
  title: "title", role: "title", position: "title", "job title": "title",
  location: "location",
  "employment type": "employmentType", type: "employmentType", contract: "employmentType",
  start: "start", from: "start", "start date": "start", since: "start",
  end: "end", to: "end", until: "end", "end date": "end",
  dates: "dates", period: "dates",
};

const EDUCATION_KEYS: Record<string, keyof EducationEntry | "dates"> = {
  school: "school", university: "school", institution: "school", college: "school",
  degree: "degree", qualification: "degree",
  field: "field", "field of study": "field", major: "field", subject: "field",
  start: "start", from: "start", end: "end", to: "end", graduated: "end", graduation: "end",
  dates: "dates", grade: "grade", gpa: "grade", result: "grade",
};

const PROJECT_KEYS: Record<string, keyof ProjectEntry> = {
  name: "name", project: "name", link: "link", url: "link", repo: "link", repository: "link",
};

type Section =
  | "personal" | "headline" | "summary" | "experience" | "education" | "skills"
  | "languages" | "certifications" | "projects" | "answers" | "other";

function sectionOf(title: string): Section {
  const t = norm(title);
  if (/^(personal|contact|about me|details|personal details|contact details)/.test(t)) return "personal";
  if (/^(headline|title|tagline)/.test(t)) return "headline";
  if (/^(summary|profile|professional summary|about)/.test(t)) return "summary";
  if (/^(experience|work experience|employment|work history|career)/.test(t)) return "experience";
  if (/^(education|studies|academic)/.test(t)) return "education";
  if (/^(skills|technical skills|competencies)/.test(t)) return "skills";
  if (/^(languages|spoken languages)/.test(t)) return "languages";
  if (/^(certifications|certificates|licenses|licences)/.test(t)) return "certifications";
  if (/^(projects|portfolio projects)/.test(t)) return "projects";
  if (/^(answers|q a|qa|questions|prepared answers|faq)/.test(t)) return "answers";
  return "other";
}

function personalKey(label: string): string {
  const n = norm(label);
  for (const [key, aliases] of Object.entries(PERSONAL_ALIASES)) {
    if (aliases.includes(n)) {
      return key;
    }
  }
  return n.replace(/\s+/g, "_");
}

// ── dates ────────────────────────────────────────────────────────────────

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "2021-03" | "03/2021" | "Mar 2021" | "March 2021" | "2021" | "present" → normalised. */
export function normalizeDate(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s === "") return "";
  if (/^(present|current|now|today|ongoing)$/.test(s)) return "present";
  let m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/);
  if (m) return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
  m = s.match(/^([a-z]{3})[a-z]*\.?\s+(\d{4})$/);
  if (m) {
    const idx = MONTHS.indexOf(m[1] ?? "");
    if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
  }
  m = s.match(/^(\d{4})$/);
  if (m) return m[1] ?? "";
  return raw.trim();
}

function splitDates(raw: string): [string, string] {
  const parts = raw.split(/\s+(?:–|—|-|to|until)\s+|\s*[–—]\s*/i).map((p) => p.trim()).filter(Boolean);
  return [normalizeDate(parts[0] ?? ""), normalizeDate(parts[1] ?? "")];
}

/** Month index since year 0; start-of-range for "YYYY" when !isEnd, end-of-range otherwise. */
function monthIndex(date: string, isEnd: boolean, now: Date): number | null {
  if (date === "present") return now.getFullYear() * 12 + now.getMonth();
  let m = date.match(/^(\d{4})-(\d{2})$/);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  m = date.match(/^(\d{4})$/);
  if (m) return Number(m[1]) * 12 + (isEnd ? 11 : 0);
  return null;
}

export function durationYears(start: string, end: string, now = new Date()): number | null {
  const a = monthIndex(start, false, now);
  const b = monthIndex(end || "present", true, now);
  if (a === null || b === null || b < a) return null;
  return Math.round(((b - a + 1) / 12) * 10) / 10;
}

/** Total years across jobs with overlapping periods merged. */
export function totalExperienceYears(jobs: ExperienceEntry[], now = new Date()): number {
  const spans: Array<[number, number]> = [];
  for (const j of jobs) {
    const a = monthIndex(j.start, false, now);
    const b = monthIndex(j.end || "present", true, now);
    if (a !== null && b !== null && b >= a) spans.push([a, b]);
  }
  spans.sort((x, y) => x[0] - y[0]);
  let months = 0;
  let cur: [number, number] | null = null;
  for (const s of spans) {
    if (cur === null || s[0] > cur[1] + 1) {
      if (cur !== null) months += cur[1] - cur[0] + 1;
      cur = [s[0], s[1]];
    } else {
      cur[1] = Math.max(cur[1], s[1]);
    }
  }
  if (cur !== null) months += cur[1] - cur[0] + 1;
  return Math.round((months / 12) * 10) / 10;
}

// ── parse ────────────────────────────────────────────────────────────────

function emptyDetails(): ProfileDetails {
  return {
    personal: {}, headline: "", summary: "", experience: [], education: [], skills: {},
    languages: [], certifications: [], projects: [], answers: {}, totalYears: 0, importedAt: Date.now(),
  };
}

const newJob = (): ExperienceEntry => ({ company: "", title: "", location: "", employmentType: "", start: "", end: "", bullets: [] });
const newSchool = (): EducationEntry => ({ school: "", degree: "", field: "", start: "", end: "", grade: "", notes: [] });
const newProject = (): ProjectEntry => ({ name: "", link: "", bullets: [] });

const KV_RE = /^([^:]{1,80}?)\s*:\s*(.*)$/;
const PLACEHOLDER_BLOCK = /^(job|school|project|position|company|entry)\s*\d*$/i;

export function parseProfileMarkdown(markdown: string, now = new Date()): ParseResult {
  const warnings: string[] = [];
  const d = emptyDetails();
  const text = markdown.replace(/\r\n?/g, "\n").replace(/<!--[\s\S]*?-->/g, "");
  let section: Section | null = null;
  let otherTitle = "";
  let job: ExperienceEntry | null = null;
  let school: EducationEntry | null = null;
  let project: ProjectEntry | null = null;
  let blockTitle = "";
  const para: Record<string, string[]> = {};

  const closeBlock = (): void => {
    if (job) {
      if (!job.company && blockTitle && !PLACEHOLDER_BLOCK.test(blockTitle)) {
        const [c, t] = blockTitle.split(/\s+[—–|@-]\s+|\s+at\s+/i);
        job.company = (c ?? "").trim();
        if (!job.title && t) job.title = t.trim();
      }
      if (job.company || job.title) d.experience.push(job);
    }
    if (school) {
      if (!school.school && blockTitle && !PLACEHOLDER_BLOCK.test(blockTitle)) school.school = blockTitle;
      if (school.school || school.degree) d.education.push(school);
    }
    if (project) {
      if (!project.name && blockTitle && !PLACEHOLDER_BLOCK.test(blockTitle)) project.name = blockTitle;
      if (project.name) d.projects.push(project);
    }
    job = null; school = null; project = null; blockTitle = "";
  };

  const openBlock = (): void => {
    if (section === "experience") job = newJob();
    else if (section === "education") school = newSchool();
    else if (section === "projects") project = newProject();
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line === "" || /^#\s/.test(line)) continue;

    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      closeBlock();
      section = sectionOf(h2[1] ?? "");
      otherTitle = (h2[1] ?? "").trim();
      continue;
    }
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      closeBlock();
      blockTitle = (h3[1] ?? "").trim();
      openBlock();
      continue;
    }
    if (section === null) continue;

    const isBullet = /^[-*+]\s*/.test(line);
    const body = line.replace(/^[-*+]\s*/, "").trim();
    if (body === "") continue;
    const kv = body.match(KV_RE);
    const key = kv ? norm(kv[1] ?? "") : "";
    const value = kv ? (kv[2] ?? "").trim() : "";

    switch (section) {
      case "personal": {
        if (kv) {
          if (value !== "") d.personal[personalKey(kv[1] ?? "")] = value;
        }
        break;
      }
      case "headline":
      case "summary":
        (para[section] ??= []).push(body);
        break;
      case "experience": {
        const field = kv ? EXPERIENCE_KEYS[key] : undefined;
        if (field !== undefined) {
          job ??= newJob();
          if (field === "dates") {
            [job.start, job.end] = splitDates(value);
          } else if (field === "start" || field === "end") {
            job[field] = normalizeDate(value);
          } else if (field !== "bullets") {
            job[field] = value;
          }
        } else if (job) {
          job.bullets.push(body);
        }
        break;
      }
      case "education": {
        const field = kv ? EDUCATION_KEYS[key] : undefined;
        if (field !== undefined) {
          school ??= newSchool();
          if (field === "dates") {
            [school.start, school.end] = splitDates(value);
          } else if (field === "start" || field === "end") {
            school[field] = normalizeDate(value);
          } else if (field !== "notes") {
            school[field] = value;
          }
        } else if (school) {
          school.notes.push(body);
        }
        break;
      }
      case "projects": {
        const field = kv ? PROJECT_KEYS[key] : undefined;
        if (field !== undefined && field !== "bullets") {
          project ??= newProject();
          project[field] = value;
        } else if (project) {
          project.bullets.push(body);
        }
        break;
      }
      case "skills": {
        if (kv && value !== "") {
          d.skills[(kv[1] ?? "").trim()] = value.split(/\s*[,;]\s*/).filter(Boolean);
        } else if (!kv && isBullet) {
          (d.skills["Other"] ??= []).push(...body.split(/\s*[,;]\s*/).filter(Boolean));
        }
        break;
      }
      case "languages": {
        if (kv && value !== "") d.languages.push({ language: (kv[1] ?? "").trim(), level: value });
        else if (!kv) {
          const m = body.match(/^(.+?)\s*[(–—-]\s*(.+?)\)?$/);
          d.languages.push(m ? { language: (m[1] ?? "").trim(), level: (m[2] ?? "").trim() } : { language: body, level: "" });
        }
        break;
      }
      case "certifications":
        d.certifications.push(body);
        break;
      case "answers": {
        if (kv && value !== "") d.answers[(kv[1] ?? "").trim().replace(/\?$/, "") + "?"] = value;
        break;
      }
      case "other": {
        const existing = d.answers[otherTitle];
        d.answers[otherTitle] = existing ? `${existing}\n${body}` : body;
        break;
      }
    }
  }
  closeBlock();

  d.skillOrder = Object.keys(d.skills);
  d.headline = (para["headline"] ?? []).join(" ").trim();
  d.summary = (para["summary"] ?? []).join(" ").trim();

  // Full name given instead of parts → split it.
  const full = d.personal["full_name"];
  if (full && !d.personal["first_name"]) {
    const parts = full.split(/\s+/);
    d.personal["first_name"] = parts[0] ?? "";
    if (parts.length > 1) d.personal["last_name"] = parts[parts.length - 1] ?? "";
    if (parts.length > 2) d.personal["middle_name"] = parts.slice(1, -1).join(" ");
  }
  delete d.personal["full_name"];
  if (!d.personal["location"] && (d.personal["city"] || d.personal["country"])) {
    d.personal["location"] = [d.personal["city"], d.personal["country"]].filter(Boolean).join(", ");
  }

  for (const j of d.experience) {
    for (const [k, v] of [["start", j.start], ["end", j.end]] as const) {
      if (v !== "" && v !== "present" && !/^\d{4}(-\d{2})?$/.test(v)) {
        warnings.push(`Couldn't read ${k} date "${v}" for ${j.company || j.title}. Use YYYY-MM.`);
      }
    }
    if (j.start === "") warnings.push(`No start date for ${j.company || j.title}.`);
  }
  d.totalYears = totalExperienceYears(d.experience, now);
  if (!d.personal["first_name"]) warnings.push("First name is empty.");
  if (!d.personal["email"]) warnings.push("Email is empty.");
  return { details: d, warnings };
}

// ── to profile / resume text ─────────────────────────────────────────────

export function fullNameOf(d: ProfileDetails): string {
  return [d.personal["first_name"], d.personal["middle_name"], d.personal["last_name"]]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .join(" ");
}

function range(start: string, end: string): string {
  const e = end === "" ? "present" : end;
  return start ? `${start} – ${e}` : e === "present" ? "" : `until ${e}`;
}

/**
 * How much detail the plain-text CV keeps. When a big profile does not fit the
 * server's 20k limit, detail is removed from the least useful places first
 * (prepared answers - sent separately anyway - then project and older-job
 * bullets) instead of chopping the end off and losing whole sections.
 */
interface Detail {
  answers: boolean;
  projectBullets: number;
  educationNotes: number;
  currentJobBullets: number;
  olderJobBullets: number;
  skills: number;
}

const DETAIL_LEVELS: Detail[] = [
  { answers: true, projectBullets: 99, educationNotes: 99, currentJobBullets: 99, olderJobBullets: 99, skills: 999 },
  { answers: false, projectBullets: 99, educationNotes: 99, currentJobBullets: 99, olderJobBullets: 99, skills: 999 },
  { answers: false, projectBullets: 1, educationNotes: 1, currentJobBullets: 99, olderJobBullets: 99, skills: 999 },
  { answers: false, projectBullets: 1, educationNotes: 1, currentJobBullets: 99, olderJobBullets: 3, skills: 999 },
  { answers: false, projectBullets: 0, educationNotes: 0, currentJobBullets: 12, olderJobBullets: 2, skills: 200 },
  { answers: false, projectBullets: 0, educationNotes: 0, currentJobBullets: 8, olderJobBullets: 1, skills: 120 },
];

/** Plain-text CV the AI workers read (compact, within `max` characters). */
export function renderResumeText(d: ProfileDetails, now = new Date(), max = RESUME_TEXT_MAX): string {
  let text = "";
  for (const level of DETAIL_LEVELS) {
    text = renderResumeAt(d, now, level);
    if (text.length <= max) return text;
  }
  // Still too big: end on a whole line.
  const cut = text.lastIndexOf("\n", max - 1);
  return `${text.slice(0, cut > 0 ? cut : max - 1)}\n…`;
}

function renderResumeAt(d: ProfileDetails, now: Date, level: Detail): string {
  const p = d.personal;
  const out: string[] = [];
  if (d.totalYears > 0) out.push(`Total professional experience: ${d.totalYears} years`);
  const loc = p["location"] || [p["city"], p["country"]].filter(Boolean).join(", ");
  if (loc) out.push(`Location: ${loc}`);
  const links = [["LinkedIn", p["linkedin"]], ["GitHub", p["github"]], ["Website", p["website"]]]
    .filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (links.length) out.push(links.join(" | "));
  const prefs = [
    ["Work authorization", p["work_authorization"]], ["Requires visa sponsorship", p["visa_sponsorship"]],
    ["Willing to relocate", p["willing_to_relocate"]], ["Preferred work mode", p["work_mode"]],
    ["Notice period", p["notice_period"]], ["Available from", p["available_from"]],
    ["Desired salary", p["desired_salary"]],
  ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
  if (prefs.length) out.push(prefs.join("; "));
  if (d.experience.length) {
    out.push("Experience:");
    d.experience.forEach((j, i) => {
      const yrs = durationYears(j.start, j.end, now);
      const meta = [j.location, j.employmentType].filter(Boolean).join(", ");
      out.push(
        `- ${j.title || "Role"} at ${j.company || "company"}${meta ? ` (${meta})` : ""}` +
          `${range(j.start, j.end) ? `, ${range(j.start, j.end)}` : ""}${yrs !== null ? ` (${yrs} years)` : ""}`,
      );
      const keep = i === 0 ? level.currentJobBullets : level.olderJobBullets;
      for (const b of j.bullets.slice(0, keep)) out.push(`  • ${b}`);
    });
  }
  if (d.education.length) {
    out.push("Education:");
    for (const e of d.education) {
      const what = [e.degree, e.field].filter(Boolean).join(" in ");
      out.push(`- ${what || "Studies"}, ${e.school}${range(e.start, e.end) ? `, ${range(e.start, e.end)}` : ""}${e.grade ? ` (grade: ${e.grade})` : ""}`);
      for (const n of e.notes.slice(0, level.educationNotes)) out.push(`  • ${n}`);
    }
  }
  let budget = level.skills;
  const skills = orderedSkillEntries(d)
    .map(([k, v]): [string, string[]] => {
      const kept = v.slice(0, Math.max(0, budget));
      budget -= kept.length;
      return [k, kept];
    })
    .filter(([, v]) => v.length);
  if (skills.length) out.push(`Skills: ${skills.map(([k, v]) => `${k}: ${v.join(", ")}`).join("; ")}`);
  if (d.languages.length) out.push(`Languages: ${d.languages.map((l) => (l.level ? `${l.language} (${l.level})` : l.language)).join(", ")}`);
  if (d.certifications.length) out.push(`Certifications: ${d.certifications.join("; ")}`);
  if (d.projects.length) {
    out.push("Projects:");
    for (const pr of d.projects) {
      out.push(`- ${pr.name}${pr.link ? ` (${pr.link})` : ""}`);
      for (const b of pr.bullets.slice(0, level.projectBullets)) out.push(`  • ${b}`);
    }
  }
  const answers = Object.entries(d.answers).filter(([, v]) => v);
  if (level.answers && answers.length) {
    out.push("Prepared answers:");
    for (const [q, a] of answers) out.push(`Q: ${q}\nA: ${a}`);
  }
  return out.join("\n");
}

/** Merge imported details into a UserProfile (details replace the basic fields). */
export function profileFromDetails(d: ProfileDetails, now = new Date()): UserProfile {
  const nonEmpty = (s: string | undefined): string | null => (s && s.trim() !== "" ? s.trim() : null);
  return {
    fullName: nonEmpty(fullNameOf(d)),
    email: nonEmpty(d.personal["email"]),
    phone: nonEmpty(d.personal["phone"]),
    headline: nonEmpty(d.headline) ?? nonEmpty(d.experience[0]?.title),
    summary: nonEmpty(d.summary),
    resume: nonEmpty(renderResumeText(d, now)),
    details: d,
    updatedAt: now.getTime(),
  };
}

// ── export ───────────────────────────────────────────────────────────────

/** Best-effort details for a profile that was typed in by hand. */
export function detailsFromProfile(profile: UserProfile | null): ProfileDetails {
  if (profile?.details) return profile.details;
  const d = emptyDetails();
  const parts = (profile?.fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts[0]) d.personal["first_name"] = parts[0];
  if (parts.length > 2) d.personal["middle_name"] = parts.slice(1, -1).join(" ");
  if (parts.length > 1) d.personal["last_name"] = parts[parts.length - 1] ?? "";
  if (profile?.email) d.personal["email"] = profile.email;
  if (profile?.phone) d.personal["phone"] = profile.phone;
  d.headline = profile?.headline ?? "";
  d.summary = profile?.summary ?? "";
  if (profile?.resume) d.answers["Notes"] = profile.resume;
  return d;
}

export function profileToMarkdown(d: ProfileDetails): string {
  const L: string[] = ["# RBG Candidate Profile", "", "## Personal", ""];
  const known = new Set(PERSONAL_LABELS.map(([k]) => k).concat(["location"]));
  for (const [k, label] of PERSONAL_LABELS) L.push(`- ${label}: ${d.personal[k] ?? ""}`);
  for (const [k, v] of Object.entries(d.personal)) {
    if (!known.has(k)) L.push(`- ${k.replace(/_/g, " ")}: ${v}`);
  }
  L.push("", "## Headline", "", d.headline, "", "## Summary", "", d.summary, "", "## Experience", "");
  for (const j of d.experience) {
    L.push(`### ${j.company || j.title}`, "", `- Company: ${j.company}`, `- Title: ${j.title}`,
      `- Location: ${j.location}`, `- Employment type: ${j.employmentType}`,
      `- Start: ${j.start}`, `- End: ${j.end}`, "");
    for (const b of j.bullets) L.push(`- ${b}`);
    L.push("");
  }
  L.push("## Education", "");
  for (const e of d.education) {
    L.push(`### ${e.school}`, "", `- School: ${e.school}`, `- Degree: ${e.degree}`,
      `- Field of study: ${e.field}`, `- Start: ${e.start}`, `- End: ${e.end}`, `- Grade: ${e.grade}`, "");
    for (const n of e.notes) L.push(`- ${n}`);
    L.push("");
  }
  L.push("## Skills", "");
  for (const [k, v] of orderedSkillEntries(d)) L.push(`- ${k}: ${v.join(", ")}`);
  L.push("", "## Languages", "");
  for (const l of d.languages) L.push(`- ${l.language}: ${l.level}`);
  L.push("", "## Certifications", "");
  for (const c of d.certifications) L.push(`- ${c}`);
  L.push("", "## Projects", "");
  for (const p of d.projects) {
    L.push(`### ${p.name}`, "", `- Name: ${p.name}`, `- Link: ${p.link}`, "");
    for (const b of p.bullets) L.push(`- ${b}`);
    L.push("");
  }
  const qa = Object.entries(d.answers).filter(([q]) => q.endsWith("?"));
  const other = Object.entries(d.answers).filter(([q]) => !q.endsWith("?"));
  L.push("## Answers", "");
  for (const [q, a] of qa) L.push(`- ${q}: ${a}`);
  for (const [title, body] of other) {
    L.push("", `## ${title}`, "", ...body.split("\n"));
  }
  return `${L.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

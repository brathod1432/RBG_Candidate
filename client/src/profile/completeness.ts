// client/src/profile/completeness.ts
// Real-time profile completeness: the share of critical fields filled.
// Critical fields are the ones the defaults can answer but the user should own:
// name/contact, work authorization, visa sponsorship, relocation, work mode,
// notice period, availability and salary. The popup shows the percentage and
// the missing list; the defaults chain covers gaps at fill time.

export interface CompletenessField {
  key: string;
  label: string;
  filled: boolean;
}

const CRITICAL_KEYS: Array<[string, string]> = [
  ["full_name", "Name"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["location", "Location"],
  ["work_authorization", "Work authorization"],
  ["visa_sponsorship", "Visa sponsorship"],
  ["willing_to_relocate", "Relocation"],
  ["work_mode", "Work mode"],
  ["notice_period", "Notice period"],
  ["available_from", "Availability"],
  ["desired_salary", "Salary"],
];

export function profileCompleteness(personal: Record<string, string>): {
  percent: number;
  filled: number;
  total: number;
  fields: CompletenessField[];
  missingCritical: string[];
} {
  const fields: CompletenessField[] = CRITICAL_KEYS.map(([key, label]) => ({
    key,
    label,
    filled: (personal[key] ?? "").trim() !== "",
  }));
  const filledCount = fields.filter((f) => f.filled).length;
  return {
    percent: Math.round((filledCount / CRITICAL_KEYS.length) * 100),
    filled: filledCount,
    total: CRITICAL_KEYS.length,
    fields,
    missingCritical: fields.filter((f) => !f.filled).map((f) => f.label),
  };
}

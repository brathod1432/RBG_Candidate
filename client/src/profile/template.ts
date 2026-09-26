// client/src/profile/template.ts
// The Markdown CV template users download, fill in and import.
// Keep in sync with docs/profile-template.md (a unit test enforces it).

export const PROFILE_TEMPLATE_FILENAME = "rbg-candidate-profile.md";

export const PROFILE_TEMPLATE = `# RBG Candidate Profile

<!--
How to use:
1. Fill in the values after the colons. Leave a value empty if it does not apply.
2. Keep the "##" section headings. Copy a "###" block to add more jobs, schools or projects.
3. Dates: YYYY-MM (e.g. 2021-03), "Mar 2021", or just a year. Use "present" for a current job.
4. Import it in the extension: Settings → Profile from Markdown → Import .md
Everything stays on your device. Only fields a job form actually asks about are sent to the AI.
-->

## Personal

- First name:
- Middle name:
- Last name:
- Preferred name:
- Email:
- Phone:
- City:
- Country:
- Address:
- Postal code:
- LinkedIn:
- GitHub:
- Website:
- Work authorization:
- Requires visa sponsorship:
- Willing to relocate:
- Preferred work mode:
- Notice period:
- Available from:
- Desired salary:
- Gender: <!-- optional - male/female; pre-fills gender fields on forms -->

## Headline

<!-- One line, e.g. Senior Software Engineer — Python, AI/LLM integration -->

## Summary

<!-- 3–6 sentences about you. -->

## Experience

### Job 1

- Company:
- Title:
- Location:
- Employment type:
- Start:
- End:

<!-- Achievements, one per bullet: -->
-
-

### Job 2

- Company:
- Title:
- Location:
- Employment type:
- Start:
- End:

-

## Education

### School 1

- School:
- Degree:
- Field of study:
- Start:
- End:
- Grade:

## Skills

<!-- One category per line, comma-separated. Rename or add categories freely.
Put your most important skills first. When a form limits space ("Skill 1..5", a 255-character box),
the extension ranks your skills against the job description and uses this order to break ties. -->
- Programming languages:
- Frameworks:
- Tools & platforms:
- Other:

## Languages

<!-- e.g. - English: Fluent -->
-

## Certifications

-

## Projects

### Project 1

- Name:
- Link:

-

## Answers

<!-- Ready-made answers for common questions. The AI reuses them when a form asks something similar. -->
- Why are you looking for a new role?:
- What are you most proud of?:
- Anything else we should know?:

## Not in my experience

<!-- Optional. Tools, domains or certificates you do NOT have. The AI will never claim them. -->
-
`;

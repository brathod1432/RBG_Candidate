# Manual QA Checklist

This checklist covers manual testing procedures for the job application autofill content script across LinkedIn, Indeed, and local test fixtures.

---

## Prerequisites

- [ ] Chrome/Chromium browser with Developer Tools access
- [ ] Extension loaded in developer mode (`chrome://extensions` → Developer mode → Load unpacked)
- [ ] Test user profile data available in extension popup/storage
- [ ] Network tab open to monitor `/analyze` requests (if backend running)

---

## 1. Local Fixture Testing

### 1.1 Stage 1 Contact Form (`tests/fixtures/stage-1-contact.html`)

**Setup:** Open file directly in browser (`file:///path/to/stage-1-contact.html`)

| Test Case | Steps | Expected Result | Pass/Fail |
|-----------|-------|-----------------|-----------|
| **Stage detection via `data-stage`** | 1. Open fixture<br>2. Run content script detection (via extension popup or console) | Stage = "1", confidence = 1.0, reason = "data-stage" | ☐ |
| **Full name detection (explicit label)** | 1. Inspect `#fullName` field<br>2. Verify field map contains `fullName` → `#fullName` | Field classified as `fullName`, selector `#fullName` | ☐ |
| **Email detection (type=email)** | 1. Inspect `#email` field<br>2. Verify field map contains `email` → `#email` | Field classified as `email`, selector `#email` | ☐ |
| **Phone detection (type=tel + label)** | 1. Inspect `#phone` field<br>2. Verify field map contains `phone` → `#phone` | Field classified as `phone`, selector `#phone` | ☐ |
| **Aria-label only field** | 1. Inspect `#mobile` field (no visible label)<br>2. Verify detection via `aria-label` | Field classified as `phone`, selector `#mobile` | ☐ |
| **Duplicate key handling** | 1. Check `#emailConfirm` (also email)<br>2. Verify only first email in field map | Only one `email` key in field map (first wins) | ☐ |
| **First/Last name split** | 1. Check `#firstName` and `#lastName`<br>2. Verify only one `fullName` detected | One `fullName` detected (first match wins) | ☐ |
| **Hidden field skipped** | 1. Verify `csrf_token` hidden input not in field map | Hidden input absent from field map | ☐ |
| **Password field excluded** | 1. Verify `#password` not in field map | Password input absent (SKIPPED_INPUT_TYPES) | ☐ |

### 1.2 Stage 2 Experience Form (`tests/fixtures/stage-2-experience.html`)

**Setup:** Open file directly in browser

| Test Case | Steps | Expected Result | Pass/Fail |
|-----------|-------|-----------------|-----------|
| **Stage detection via `data-stage`** | 1. Open fixture<br>2. Run detection | Stage = "2", confidence = 1.0, reason = "data-stage" | ☐ |
| **Headline via "Desired Job Title" label** | 1. Check `#desiredTitle`<br>2. Verify classified as `headline` | Field classified as `headline` | ☐ |
| **Headline via aria-label only** | 1. Check `#headlineAria` (no visible label)<br>2. Verify detection via `aria-label` | Field classified as `headline` | ☐ |
| **Headline via wrapping label** | 1. Check `#wrappingHeadline`<br>2. Verify detection via wrapping `<label>` | Field classified as `headline` | ☐ |
| **Headline via "Current Position" (contains "position")** | 1. Check `#currentPosition`<br>2. Verify classified as `headline` | Field classified as `headline` | ☐ |
| **Summary via textarea name="summary"** | 1. Check `#summary`<br>2. Verify classified as `summary` | Field classified as `summary` | ☐ |
| **Cover letter (duplicate summary)** | 1. Check `#coverLetter`<br>2. Verify skipped (duplicate key) | Only first `summary` in field map | ☐ |
| **About You → summary** | 1. Check `#aboutYou`<br>2. Verify classified as `summary` | Field classified as `summary` (if first not present) | ☐ |
| **Select dropdown skipped** | 1. Check `#experienceLevel`<br>2. Verify not in field map (not classified) | Select not mapped (no classification match) | ☐ |
| **Objective → summary** | 1. Check `#objective`<br>2. Verify classified as `summary` | Field classified as `summary` | ☐ |
| **Description → summary** | 1. Check `#description`<br>2. Verify classified as `summary` | Field classified as `summary` | ☐ |
| **Hidden field skipped** | 1. Verify `application_id` not in field map | Hidden input absent | ☐ |
| **Password field excluded** | 1. Verify `#confirmPassword` not in field map | Password input absent | ☐ |

### 1.3 Edge Cases (`tests/fixtures/edge-cases.html`)

**Setup:** Open file directly in browser (try with `?stage=3` URL param)

| Test Case | Steps | Expected Result | Pass/Fail |
|-----------|-------|-----------------|-----------|
| **Stage fallback to URL** | 1. Open with `?stage=3`<br>2. Run detection (no data-stage) | Stage = "3", confidence = 0.7, reason = "url" | ☐ |
| **Stage fallback to heading** | 1. Open without URL stage param<br>2. Run detection | Stage from heading text, confidence = 0.5, reason = "heading" | ☐ |
| **Stage default** | 1. Open minimal page (no stage signals)<br>2. Run detection | Stage = "1", confidence = 0.2, reason = "default" | ☐ |
| **Aria-label email** | 1. Check `#ariaEmail`<br>2. Verify detected via `aria-label` | Classified as `email` | ☐ |
| **Aria-labelledby phone** | 1. Check `#ariaPhone` referencing `#phoneLabel`<br>2. Verify detected via `aria-labelledby` | Classified as `phone` | ☐ |
| **Aria-label full name** | 1. Check `#ariaName`<br>2. Verify detected via `aria-label` | Classified as `fullName` | ☐ |
| **CSS hidden field skipped** | 1. Check `#hiddenByCss` (display:none)<br>2. Verify not in field map | Skipped (not visible) | ☐ |
| **Hidden attribute field skipped** | 1. Check `#hiddenAttr` (hidden attr)<br>2. Verify not in field map | Skipped | ☐ |
| **Disabled field skipped** | 1. Check `#disabledField`<br>2. Verify not in field map | Skipped (el.disabled = true) | ☐ |
| **Password fields excluded** | 1. Check `#pwd1`, `#pwd2`, `#currentPwd`<br>2. Verify none in field map | All excluded (SKIPPED_INPUT_TYPES) | ☐ |
| **Company field excluded** | 1. Check `#companyName`<br>2. Verify not in field map | Excluded (EXCLUDED_SUBSTRINGS: "company") | ☐ |
| **City field excluded** | 1. Check `#cityInput`<br>2. Verify not in field map | Excluded ("city") | ☐ |
| **State field excluded** | 1. Check `#stateInput`<br>2. Verify not in field map | Excluded ("state") | ☐ |
| **ZIP field excluded** | 1. Check `#zipInput`<br>2. Verify not in field map | Excluded ("zip") | ☐ |
| **Country field excluded** | 1. Check `#countryInput`<br>2. Verify not in field map | Excluded ("country") | ☐ |
| **Username field excluded** | 1. Check `#usernameInput`<br>2. Verify not in field map | Excluded ("username") | ☐ |
| **Checkbox excluded** | 1. Check `#agree`<br>2. Verify not in field map | Excluded (SKIPPED_INPUT_TYPES) | ☐ |
| **Radio excluded** | 1. Check `#opt1`, `#opt2`<br>2. Verify not in field map | Excluded | ☐ |
| **File input excluded** | 1. Check `#fileUpload`<br>2. Verify not in field map | Excluded | ☐ |
| **Date input excluded** | 1. Check `#dateInput`<br>2. Verify not in field map | Excluded | ☐ |
| **Color input excluded** | 1. Check `#colorInput`<br>2. Verify not in field map | Excluded | ☐ |
| **Range input excluded** | 1. Check `#rangeInput`<br>2. Verify not in field map | Excluded | ☐ |
| **Submit button excluded** | 1. Check `#submitBtn`<br>2. Verify not in field map | Excluded | ☐ |
| **Valid email detected** | 1. Check `#validEmail`<br>2. Verify classified as `email` | Classified as `email` | ☐ |
| **Valid mobile detected (wrapping label)** | 1. Check `#validMobile`<br>2. Verify classified as `phone` | Classified as `phone` | ☐ |
| **Placeholder-only detection** | 1. Check `#placeholderOnly` (placeholder="Full Name")<br>2. Verify classified as `fullName` | Classified as `fullName` | ☐ |
| **Name attribute only** | 1. Check input with `name="applicantName"`<br>2. Verify classified as `fullName` | Classified as `fullName` | ☐ |
| **Valid summary detected** | 1. Check `#validSummary`<br>2. Verify classified as `summary` | Classified as `summary` | ☐ |
| **Placeholder headline detected** | 1. Check `#placeholderHeadline`<br>2. Verify classified as `headline` | Classified as `headline` | ☐ |

---

## 2. LinkedIn Easy Apply Testing

### 2.1 Prerequisites
- [ ] LinkedIn account with Easy Apply access
- [ ] Navigate to a job posting with "Easy Apply" button
- [ ] Extension loaded and active

### 2.2 Test Cases

| Test Case | Steps | Expected Result | Pass/Fail |
|-----------|-------|-----------------|-----------|
| **Stage 1: Contact Info** | 1. Click "Easy Apply"<br>2. Wait for modal step 1<br>3. Trigger detection | Stage detected (data-stage or URL), contact fields mapped | ☐ |
| **Full name auto-fill** | 1. Verify `fullName` field populated | Correct name inserted | ☐ |
| **Email auto-fill** | 1. Verify `email` field populated | Correct email inserted | ☐ |
| **Phone auto-fill** | 1. Verify `phone` field populated | Correct phone inserted | ☐ |
| **Next → Stage 2** | 1. Click "Next"<br>2. Wait for step 2<br>3. Trigger detection | Stage advances, experience fields mapped | ☐ |
| **Headline auto-fill** | 1. Verify `headline` field populated | Current/desired title inserted | ☐ |
| **Summary auto-fill** | 1. Verify `summary` textarea populated | Professional summary inserted | ☐ |
| **Review step** | 1. Click "Next" to review<br>2. Verify no duplicate fills | Fields not double-filled | ☐ |
| **Submit application** | 1. Click "Submit"<br>2. Verify success | Application submitted | ☐ |
| **Iframe handling** | 1. Check if Easy Apply uses iframe<br>2. Verify content script runs in correct context | Detection works in iframe (if same-origin) or main doc | ☐ |

### 2.3 LinkedIn Selectors to Verify
- [ ] `data-stage` attribute on step container
- [ ] Input `name` attributes (e.g., `text-entity-list-form-component-...`)
- [ ] Aria labels on fields
- [ ] Shadow DOM usage (LinkedIn uses Lit/web components)

---

## 3. Indeed Apply Testing

### 3.1 Prerequisites
- [ ] Indeed account
- [ ] Job posting with "Apply now" (Indeed-hosted application)
- [ ] Extension loaded

### 3.2 Test Cases

| Test Case | Steps | Expected Result | Pass/Fail |
|-----------|-------|-----------------|-----------|
| **Stage detection** | 1. Click "Apply now"<br>2. Wait for form<br>3. Trigger detection | Stage detected via URL or heading | ☐ |
| **Contact fields** | 1. Verify name, email, phone mapped | Fields detected and fillable | ☐ |
| **Experience fields** | 1. Navigate to experience step<br>2. Verify headline, summary mapped | Fields detected | ☐ |
| **Multi-page navigation** | 1. Complete all steps<br>2. Verify detection on each page | Stage updates correctly per page | ☐ |
| **Indeed-specific selectors** | 1. Check field `name` attributes (often `applicant.*`)<br>2. Verify classification works | Fields classified despite Indeed naming | ☐ |

### 3.3 Indeed Selectors to Verify
- [ ] Form structure (often multi-step wizard)
- [ ] Input naming patterns
- [ ] Any iframe embeddings

---

## 4. Cross-Browser / Edge Case Testing

| Test Case | Steps | Expected Result | Pass/Fail |
|-----------|-------|-----------------|-----------|
| **Chrome incognito** | 1. Open fixture in incognito<br>2. Load extension<br>3. Run detection | Works identically | ☐ |
| **Firefox (if supported)** | 1. Load extension in Firefox<br>2. Test fixtures | Works (WebExtensions compatible) | ☐ |
| **Dynamic form (React/Vue)** | 1. Test on SPA with client-side routing<br>2. Navigate between steps without reload | Detection re-runs on navigation | ☐ |
| **Late-mounted fields** | 1. Form fields added after initial load<br>2. Trigger detection after mount | New fields detected | ☐ |
| **Rapid navigation** | 1. Click Next/Back quickly<br>2. Verify no duplicate detection | Debounced/guarded correctly | ☐ |
| **Large form (>4000 char snippet)** | 1. Create form with many fields<br>2. Verify prompt snippet truncated | Snippet ≤ 4000 chars, trailing fields dropped | ☐ |

---

## 5. Regression Checks

| Area | Check | Pass/Fail |
|------|-------|-----------|
| **No console errors** | Open DevTools Console, verify no red errors during detection | ☐ |
| **No memory leaks** | Repeatedly trigger detection, check memory profile | ☐ |
| **Storage persistence** | Reload page, verify profile data persists | ☐ |
| **CSP compliance** | Check no inline script violations | ☐ |
| **Permission scope** | Extension only requests `activeTab`, `storage`, `scripting` | ☐ |

---

## 6. Sign-Off

| Role | Name | Date | Signature |
|------|------|------|-----------|
| QA Engineer | | | |
| Developer | | | |
| Product Owner | | | |

---

## Notes

- Record any deviations or bugs found during testing in the project issue tracker
- Update this checklist when new field types or site patterns are discovered
- Prioritize fixes for: LinkedIn Easy Apply → Indeed → Generic sites
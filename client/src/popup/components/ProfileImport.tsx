// client/src/popup/components/ProfileImport.tsx
import { useRef, useState } from "react";
import type { UserProfile } from "../../types/index";
import {
  detailsFromProfile,
  parseProfileMarkdown,
  profileFromDetails,
  profileToMarkdown,
} from "../../profile/markdown";
import { PROFILE_TEMPLATE, PROFILE_TEMPLATE_FILENAME } from "../../profile/template";
import { saveProfile } from "../../utils/storage";
import { downloadText, toMessage } from "../chrome";
import { usePopupStore } from "../store";
import Icon, { plural } from "./Icon";

const MAX_BYTES = 256 * 1024;

interface ImportReport {
  fileName: string;
  warnings: string[];
}

/** Merge imported values over the current profile (imported wins when non-empty). */
function mergeProfiles(prev: UserProfile | null, next: UserProfile): UserProfile {
  return {
    fullName: next.fullName ?? prev?.fullName ?? null,
    email: next.email ?? prev?.email ?? null,
    phone: next.phone ?? prev?.phone ?? null,
    headline: next.headline ?? prev?.headline ?? null,
    summary: next.summary ?? prev?.summary ?? null,
    resume: next.resume ?? prev?.resume ?? null,
    ...(next.details !== undefined ? { details: next.details } : {}),
    updatedAt: next.updatedAt,
  };
}

export default function ProfileImport({ onImported }: { onImported: (p: UserProfile) => void }): JSX.Element {
  const profile = usePopupStore((s) => s.profile);
  const setProfile = usePopupStore((s) => s.setProfile);
  const setError = usePopupStore((s) => s.setError);
  const setNotice = usePopupStore((s) => s.setNotice);
  const [over, setOver] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const input = useRef<HTMLInputElement>(null);

  async function importFile(file: File): Promise<void> {
    setError(null);
    setNotice(null);
    if (file.size > MAX_BYTES) {
      setError("That file is larger than 256 KB — is it the profile Markdown?");
      return;
    }
    try {
      const text = await file.text();
      const { details, warnings } = parseProfileMarkdown(text);
      const merged = mergeProfiles(profile, profileFromDetails(details));
      await saveProfile(merged);
      setProfile(merged);
      onImported(merged);
      setReport({ fileName: file.name, warnings });
      setNotice(`Imported ${file.name} — profile saved on this device.`);
    } catch (err: unknown) {
      setError(`Couldn't import: ${toMessage(err)}`);
    }
  }

  function onFiles(files: FileList | null): void {
    const file = files?.[0];
    if (file !== undefined) {
      void importFile(file);
    }
  }

  const d = profile?.details;
  const skillCount = d ? Object.values(d.skills).reduce((n, v) => n + v.length, 0) : 0;

  return (
    <div className="stack">
      <label
        className={`drop${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onFiles(e.dataTransfer.files);
        }}
      >
        <span className="ic" aria-hidden="true"><Icon name="upload" size={18} /></span>
        <span>
          <b>Import profile from Markdown</b>
          <span className="muted">Drop your .md here or click to browse</span>
        </span>
        <input
          ref={input}
          type="file"
          accept=".md,.markdown,.txt,text/markdown,text/plain"
          aria-label="Import profile Markdown file"
          onChange={(e) => {
            onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </label>

      <div className="row wrap">
        <button
          type="button"
          className="btn secondary sm"
          onClick={() => downloadText(PROFILE_TEMPLATE_FILENAME, PROFILE_TEMPLATE)}
        >
          <Icon name="download" size={14} /> Download template
        </button>
        <button
          type="button"
          className="btn ghost sm"
          disabled={profile === null}
          onClick={() => downloadText(PROFILE_TEMPLATE_FILENAME, profileToMarkdown(detailsFromProfile(profile)))}
        >
          <Icon name="file" size={14} /> Export my profile
        </button>
      </div>

      {d !== undefined && (
        <div className="chips" data-testid="import-summary" aria-label="Imported profile summary">
          <span className="chip">{plural(d.experience.length, "job")}</span>
          <span className="chip">{d.totalYears} yrs experience</span>
          <span className="chip">{plural(skillCount, "skill")}</span>
          <span className="chip">{plural(d.education.length, "school")}</span>
          {d.languages.length > 0 && <span className="chip">{plural(d.languages.length, "language")}</span>}
          {Object.keys(d.answers).length > 0 && (
            <span className="chip">{plural(Object.keys(d.answers).length, "prepared answer")}</span>
          )}
        </div>
      )}

      {report !== null && report.warnings.length > 0 && (
        <div className="alert info">
          <b>Check {report.fileName}:</b>
          <ul>
            {report.warnings.slice(0, 6).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

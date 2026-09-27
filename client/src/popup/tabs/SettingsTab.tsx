// client/src/popup/tabs/SettingsTab.tsx  — step 1 "Profile"
import { useEffect, useState } from "react";
import type { UserProfile } from "../../types/index";
import {
  clearApiKey,
  getApiKey,
  getServerUrl,
  hasLegacyPassphraseKey,
  saveApiKey,
  saveProfile,
  saveServerUrl,
} from "../../utils/storage";
import { runHealthCheck } from "../usePrepareHealth";
import { toMessage } from "../chrome";
import { PROFILE_FIELDS, usePopupStore } from "../store";
import { profileCompleteness } from "../../profile/completeness";
import AgentSettings from "../components/AgentSettings";
import Icon from "../components/Icon";
import ProfileImport from "../components/ProfileImport";

interface ProfileForm {
  fullName: string;
  email: string;
  phone: string;
  headline: string;
  summary: string;
  resume: string;
}

function toForm(profile: UserProfile | null): ProfileForm {
  return {
    fullName: profile?.fullName ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    headline: profile?.headline ?? "",
    summary: profile?.summary ?? "",
    resume: profile?.resume ?? "",
  };
}

function nonEmpty(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function maskKey(key: string): string {
  const k = key.trim();
  return k.length > 12 ? `${k.slice(0, 6)}…${k.slice(-4)}` : "saved";
}

function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

export default function SettingsTab(): JSX.Element {
  const profile = usePopupStore((s) => s.profile);
  const setProfile = usePopupStore((s) => s.setProfile);
  const serverKey = usePopupStore((s) => s.prepareChecks.server && (s.prepareChecks.keySource === "server" || s.prepareChecks.keySource === "both"));
  const setError = usePopupStore((s) => s.setError);
  const setNotice = usePopupStore((s) => s.setNotice);
  const setTab = usePopupStore((s) => s.setTab);

  const [apiKey, setApiKey] = useState<string>("");
  /** "nvapi-…abcd" when the user saved their own key, else null. */
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [legacyKey, setLegacyKey] = useState<boolean>(false);
  const [serverUrl, setServerUrl] = useState<string>("");
  const [savedServerUrl, setSavedServerUrl] = useState<string | null>(null);
  const [form, setForm] = useState<ProfileForm>(() => toForm(profile));
  const [busy, setBusy] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState<boolean>(profile === null);

  // Profile loads asynchronously in App; mirror it into the form once it arrives.
  useEffect(() => {
    setForm(toForm(profile));
    if (profile === null) setEditOpen(true);
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const key = await getApiKey();
        if (!cancelled) setSavedKey(key === null ? null : maskKey(key));
        if (key === null && !cancelled) setLegacyKey(await hasLegacyPassphraseKey());
      } catch (_err: unknown) {
        if (!cancelled) setSavedKey(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = await getServerUrl();
        if (!cancelled) setSavedServerUrl(url);
      } catch (_err: unknown) {
        if (!cancelled) setSavedServerUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setField(key: keyof ProfileForm, value: string): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSaveApiKey(): Promise<void> {
    if (apiKey.trim() === "") {
      setError("Paste your NVIDIA API key first.");
      return;
    }
    setBusy("key");
    setError(null);
    setNotice(null);
    try {
      await saveApiKey(apiKey);
      setSavedKey(maskKey(apiKey.trim()));
      setLegacyKey(false);
      setApiKey("");
      setNotice("API key saved (encrypted on this device).");
      void runHealthCheck();
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRemoveApiKey(): Promise<void> {
    setBusy("key");
    setError(null);
    try {
      await clearApiKey();
      setSavedKey(null);
      setLegacyKey(false);
      setNotice("Your API key was removed from this device.");
      void runHealthCheck();
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveServerUrl(): Promise<void> {
    setBusy("server");
    setError(null);
    setNotice(null);
    try {
      await saveServerUrl(serverUrl);
      setSavedServerUrl(serverUrl.trim() === "" ? null : serverUrl.trim());
      setNotice(
        serverUrl.trim() === ""
          ? "Server URL removed — using the local default."
          : "Server URL saved.",
      );
      void runHealthCheck();
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveProfile(): Promise<void> {
    setBusy("profile");
    setError(null);
    setNotice(null);
    try {
      const next: UserProfile = {
        fullName: nonEmpty(form.fullName),
        email: nonEmpty(form.email),
        phone: nonEmpty(form.phone),
        headline: nonEmpty(form.headline),
        summary: nonEmpty(form.summary),
        resume: nonEmpty(form.resume),
        ...(profile?.details !== undefined ? { details: profile.details } : {}),
        updatedAt: Date.now(),
      };
      await saveProfile(next);
      setProfile(next);
      setNotice("Profile saved on this device.");
    } catch (err: unknown) {
      setError(toMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const hasProfile = profile !== null && (profile.fullName ?? "") !== "";

  return (
    <>
      <section className="card" aria-label="Your profile">
        <div className="card-h">
          <span className="av" style={{ background: "var(--ink)", color: "var(--ink-contrast)", width: 34, height: 34, fontSize: 13 }}>
            {initials(profile?.fullName)}
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 className="title">{hasProfile ? profile?.fullName : "Set up your profile"}</h2>
            <p className="lede">
              {hasProfile
                ? profile?.headline ?? profile?.email ?? "Profile saved"
                : "Import the Markdown template or type the basics below."}
            </p>
          </div>
        </div>
        <ProfileImport onImported={(p) => setForm(toForm(p))} />
        {hasProfile && (() => {
          const c = profileCompleteness(profile?.details?.personal ?? {});
          if (c.missingCritical.length === 0) return null;
          return (
            <div
              role="button"
              tabIndex={0}
              style={{ marginTop: 10, fontSize: 12, lineHeight: 1.45, opacity: 0.78, cursor: "pointer" }}
              onClick={() => setEditOpen(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setEditOpen(true);
              }}
            >
              <strong>Profile completeness: {c.percent}%</strong> — missing: {c.missingCritical.join(", ")}.{" "}
              Defaults cover these at fill time; click to fill them in yourself.
            </div>
          );
        })()}
        {hasProfile && (
          <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={() => setTab("fill")}>
            Next: scan a job page <Icon name="arrowRight" />
          </button>
        )}
      </section>

      <section className="card">
        <details className="more" open={editOpen} onToggle={(e) => setEditOpen((e.target as HTMLDetailsElement).open)}>
          <summary>Edit basics</summary>
          <div className="stack">
            {PROFILE_FIELDS.map((field) => (
              <label key={field.key} className="fld">
                <span>{field.label}</span>
                {field.key === "summary" || field.key === "resume" ? (
                  <textarea
                    className="inp"
                    value={form[field.key]}
                    onChange={(e) => setField(field.key, e.target.value)}
                    rows={field.key === "resume" ? 6 : 3}
                  />
                ) : (
                  <input
                    className="inp"
                    type={field.key === "email" ? "email" : "text"}
                    value={form[field.key]}
                    onChange={(e) => setField(field.key, e.target.value)}
                  />
                )}
              </label>
            ))}
            <button
              type="button"
              className="btn primary"
              onClick={() => void handleSaveProfile()}
              disabled={busy !== null}
            >
              {busy === "profile" ? "Saving…" : "Save profile"}
            </button>
          </div>
        </details>
      </section>

      <section className="card" aria-label="NVIDIA API key">
        <details className="more" open={savedKey === null && !serverKey}>
          <summary>
            NVIDIA API key
            <span className={`pill ${savedKey !== null || serverKey ? "ok" : "warn"}`} style={{ marginLeft: "auto" }} data-testid="key-status">
              {savedKey !== null ? "your key" : serverKey ? "using .env key" : "not set"}
            </span>
          </summary>
          <div className="stack">
            <p className={`status ${serverKey ? "done" : "running"}`} data-testid="server-key-status">
              <Icon name={serverKey ? "check" : "key"} size={14} />
              <span>
                {serverKey
                  ? "The server already has a key in .env, so this is optional. A key saved here takes priority."
                  : "The server has no key in .env. Paste yours here, or add NVIDIA_API_KEY to .env."}
              </span>
            </p>
            {legacyKey && (
              <p className="status running">
                <Icon name="alert" size={14} />
                <span>A key saved with the old passphrase can't be opened any more. Paste it again below.</span>
              </p>
            )}
            {savedKey !== null ? (
              <div className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <code className="mono">{savedKey}</code>
                  <span className="muted" style={{ fontSize: 11 }}> · encrypted on this device</span>
                </span>
                <button type="button" className="btn ghost sm" onClick={() => void handleRemoveApiKey()} disabled={busy !== null}>
                  Remove
                </button>
              </div>
            ) : null}
            <label className="fld">
              <span>{savedKey !== null ? "Replace key" : "API key"}</span>
              <div className="row">
                <input
                  className="inp"
                  type="password"
                  autoComplete="off"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="nvapi-…"
                  aria-label="NVIDIA API key"
                />
                <button type="button" className="btn primary" onClick={() => void handleSaveApiKey()} disabled={busy !== null || apiKey.trim() === ""}>
                  {busy === "key" ? "Saving…" : "Save"}
                </button>
              </div>
            </label>
          </div>
        </details>
      </section>

      <section className="card" aria-label="AI server">
        <details className="more">
          <summary>
            AI server
            <span className="pill" style={{ marginLeft: "auto" }} data-testid="server-url-pill">
              {savedServerUrl ?? "http://127.0.0.1:8000"}
            </span>
          </summary>
          <div className="stack">
            <p className="status running">
              <span>
                Deploying the backend to Railway or Fly? Paste the server URL here — it is used for AI
                answers and health checks. Leave it empty for the local default.
              </span>
            </p>
            <label className="fld">
              <span>Server URL</span>
              <div className="row">
                <input
                  className="inp"
                  type="url"
                  autoComplete="off"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://my-app.up.railway.app"
                  aria-label="AI server URL"
                />
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void handleSaveServerUrl()}
                  disabled={busy !== null}
                >
                  {busy === "server" ? "Saving…" : "Save"}
                </button>
              </div>
            </label>
          </div>
        </details>
      </section>

      <AgentSettings />
    </>
  );
}

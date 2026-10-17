import { ChevronLeft } from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { interpret, todoPageSchema } from "./api-client";
import { saveSettings, testConnection } from "./native";
import {
  DEFAULT_TIMEZONE,
  describeConnectionTest,
  type SavedSettings,
  type SettingsErrors,
  type SettingsForm,
  validateSettings,
} from "./settings";

/**
 * Settings (docs/desktop-app.md §7): API URL, Token and Owner timezone, in the window's own size.
 * Shown on a fresh install and from the tray's "Settings…". `onBack` is absent until Settings is
 * complete, since the list has nothing to show before then.
 */
export function SettingsView({
  saved,
  onSaved,
  onBack,
}: {
  saved: SavedSettings;
  onSaved: (saved: SavedSettings) => void;
  onBack?: () => void;
}) {
  const [form, setForm] = useState<SettingsForm>({
    apiUrl: saved.apiUrl ?? "",
    token: "",
    ownerTimezone: saved.ownerTimezone,
  });
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  const update = (name: keyof SettingsForm) => (value: string) => {
    setForm((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined }));
    setStatus(null);
  };

  async function test() {
    const found = validateSettings(form, saved.hasToken);
    const needed = { apiUrl: found.apiUrl, token: found.token };
    if (needed.apiUrl || needed.token) {
      setErrors(needed);
      return;
    }
    setBusy("test");
    setStatus(null);
    try {
      const outcome = await testConnection(form.apiUrl, form.token);
      setStatus(describeConnectionTest(interpret(outcome, todoPageSchema)));
    } catch (err) {
      setStatus({ ok: false, message: String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    const found = validateSettings(form, saved.hasToken);
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }
    setBusy("save");
    setStatus(null);
    try {
      onSaved(await saveSettings(form));
    } catch (err) {
      setStatus({ ok: false, message: String(err) });
      setBusy(null);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-10 flex-none items-center gap-1.5 border-b pr-2 pl-3.5">
        {onBack && (
          <button
            type="button"
            aria-label="Back"
            title="Back"
            onClick={onBack}
            className="-ml-1.5 grid size-[26px] place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft
              className="size-[15px]"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          </button>
        )}
        <h1 className="font-semibold">Settings</h1>
      </header>

      <form
        className="flex flex-1 flex-col gap-3.5 overflow-y-auto px-3.5 pt-3.5 pb-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        noValidate
      >
        <Field
          label="API URL"
          error={errors.apiUrl}
          hint="The Traccia server, such as https://traccia.tail1234.ts.net"
        >
          {(props) => (
            <input
              {...props}
              type="url"
              value={form.apiUrl}
              onChange={(event) => update("apiUrl")(event.target.value)}
              placeholder="https://"
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </Field>

        <Field
          label="Token"
          error={errors.token}
          hint={
            <>
              Kept in Windows Credential Manager. Create one with{" "}
              <code className="font-mono text-[10.5px] text-foreground/80 select-text">
                traccia token create --name desktop --actor you --scope todos
              </code>
            </>
          }
        >
          {(props) => (
            <input
              {...props}
              type="password"
              value={form.token}
              onChange={(event) => update("token")(event.target.value)}
              placeholder={
                saved.hasToken
                  ? "Saved in Credential Manager"
                  : "Paste the Token"
              }
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </Field>

        <Field
          label="Owner timezone"
          error={errors.ownerTimezone}
          hint="Decides what today is. Keep it the same as the server's OWNER_TIMEZONE."
        >
          {(props) => (
            <input
              {...props}
              value={form.ownerTimezone}
              onChange={(event) => update("ownerTimezone")(event.target.value)}
              placeholder={DEFAULT_TIMEZONE}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </Field>

        <span className="flex-1" />

        <p
          role="status"
          className={`min-h-[18px] text-[11.5px] ${status && !status.ok ? "text-destructive" : "text-muted-foreground"}`}
        >
          {busy === "test" ? "Testing…" : status?.message}
        </p>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void test()}
            disabled={busy !== null}
            className="h-8 rounded-md border bg-card px-3 text-[12.5px] hover:bg-accent disabled:opacity-60"
          >
            Test connection
          </button>
          <span className="flex-1" />
          <button
            type="submit"
            disabled={busy !== null}
            className="h-8 rounded-md bg-primary px-4 text-[12.5px] font-medium text-primary-foreground hover:brightness-105 disabled:opacity-60"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

type InputProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string;
  className: string;
};

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: ReactNode;
  error: string | undefined;
  children: (props: InputProps) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11.5px] font-medium">
        {label}
      </label>
      {children({
        id,
        "aria-invalid": error !== undefined,
        "aria-describedby": `${id}-note`,
        className:
          "h-8 rounded-md border border-input bg-card px-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-3 focus:ring-primary/20 aria-invalid:border-destructive",
      })}
      <p
        id={`${id}-note`}
        className={`text-[11px] leading-snug ${error ? "text-destructive" : "text-muted-foreground"}`}
      >
        {error ?? hint}
      </p>
    </div>
  );
}

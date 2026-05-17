import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

/**
 * Lightweight modal used for the "create group" / "rename group" prompts. Built in
 * place instead of pulling in a UI library because the existing project relies on
 * raw `var(--…)` tokens for theming and we want the dialog to inherit the same look
 * as the rest of the dataset editor without a wrapper component.
 */
export function DatasetPromptDialog({
  open,
  title,
  description,
  defaultValue,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  description?: string;
  defaultValue: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
      // Defer focus until the input has been mounted by the same render commit.
      const id = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
      return () => window.clearTimeout(id);
    }
  }, [open, defaultValue]);

  if (!open) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed || busy) return;
    onConfirm(trimmed);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "var(--bg-card, #1e1e1e)",
          border: "1px solid var(--border-dim)",
          borderRadius: "0.6rem",
          padding: "1.1rem 1.25rem",
          minWidth: "20rem",
          maxWidth: "min(90vw, 28rem)",
          boxShadow: "0 18px 40px rgba(0,0,0,0.5)",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            if (!busy) onCancel();
          }
        }}
      >
        <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{title}</div>
        {description ? (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
            {description}
          </div>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          className="form-input"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
          <button type="button" className="btn" onClick={() => onCancel()} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={submit}
            disabled={busy || !value.trim()}
          >
            {busy ? (
              <Loader2 size={14} className="lf-icon-spin" aria-hidden style={{ marginRight: "0.35rem" }} />
            ) : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

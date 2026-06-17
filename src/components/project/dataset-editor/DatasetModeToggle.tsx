import { ImageIcon, Wand2 } from "lucide-react";
import type { DatasetEditorMode } from "../../../lib/datasetEditorPersistence";
import { useI18n } from "../../../lib/i18n";

type Props = {
  mode: DatasetEditorMode;
  onChange: (mode: DatasetEditorMode) => void;
  disabled?: boolean;
};

/** Segmented control switching between normal single-image tagging and edit-pair tagging. */
export function DatasetModeToggle({ mode, onChange, disabled }: Props) {
  const { t } = useI18n();
  const options: { value: DatasetEditorMode; label: string; icon: typeof ImageIcon }[] = [
    { value: "normal", label: t("dataset.modeNormal"), icon: ImageIcon },
    { value: "edit", label: t("dataset.modeEdit"), icon: Wand2 },
  ];

  return (
    <div
      role="tablist"
      aria-label={t("dataset.modeSwitchLabel")}
      style={{
        display: "inline-flex",
        gap: "0.15rem",
        padding: "0.15rem",
        borderRadius: "6px",
        border: "1px solid var(--border-dim)",
        background: "color-mix(in srgb, var(--accent-acid) 6%, transparent)",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === mode;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => {
              if (!active) onChange(opt.value);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.15rem 0.5rem",
              fontSize: "0.72rem",
              borderRadius: "4px",
              border: "none",
              cursor: disabled ? "not-allowed" : "pointer",
              color: active ? "var(--bg-deep, #0b0b0b)" : "var(--text-muted)",
              background: active ? "var(--accent-acid)" : "transparent",
              fontFamily: "var(--font-mono)",
            }}
          >
            <Icon size={13} aria-hidden />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

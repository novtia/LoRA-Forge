import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronDown } from "lucide-react";
import type { DatasetEditorTriggerScope } from "../../../lib/datasetEditorPersistence";
import type { TranslateFn } from "../../../lib/i18n";
import type { TriggerScopeFolderOption } from "./TriggerPositionPicker";

export type ImageScopePickerConfig = {
  mode: DatasetEditorTriggerScope;
  onChangeMode: (next: DatasetEditorTriggerScope) => void;
  groupPath: string;
  onChangeGroupPath: (next: string) => void;
  folderOptions: TriggerScopeFolderOption[];
  targetCount: number;
  imageEntriesLength: number;
  /** i18n key for the block label, e.g. `dataset.batchTaggingScope.label`. */
  labelKey: string;
  /** i18n key for folder menu aria. */
  folderMenuAriaKey: string;
  /** i18n key for selection hint; omit to hide the hint row. */
  selectionHintKey?: string;
  /** i18n key for target count line. */
  targetCountKey: string;
};

function useDismissOnOutside<E extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  containerRef: RefObject<E | null>,
) {
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (ev: MouseEvent) => {
      const el = containerRef.current;
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open, onClose, containerRef]);
}

function ScopeMenuButton({
  ariaLabel,
  disabled,
  open,
  onOpenChange,
  triggerLabel,
  menuAlign,
  children,
}: {
  ariaLabel: string;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  triggerLabel: string;
  menuAlign: "trigger" | "wide";
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useDismissOnOutside(open, () => onOpenChange(false), wrapRef);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "relative",
        alignSelf: "stretch",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        flex: menuAlign === "wide" ? "1 1 11rem" : "0 1 auto",
        minWidth: menuAlign === "wide" ? "11rem" : "9rem",
        maxWidth: "100%",
      }}
    >
      <button
        type="button"
        className="lf-trigger-menu-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => !disabled && onOpenChange(!open)}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
            flex: 1,
          }}
        >
          {triggerLabel}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          style={{
            transition: "transform 120ms ease",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>
      {open ? (
        <div
          role="listbox"
          className="lf-trigger-menu-panel"
          style={{
            position: "absolute",
            zIndex: 40,
            left: 0,
            top: "calc(100% + 4px)",
            width: menuAlign === "trigger" ? "100%" : "max-content",
            minWidth: menuAlign === "trigger" ? "100%" : "14rem",
            maxWidth: "min(22rem, calc(100vw - 2rem))",
            maxHeight: "14rem",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function ScopeMenuOption({
  selected,
  disabled,
  onPick,
  paddingLeftRem,
  children,
}: {
  selected?: boolean;
  disabled?: boolean;
  onPick: () => void;
  paddingLeftRem?: number;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="option"
      className="lf-trigger-menu-option"
      aria-selected={selected}
      disabled={disabled}
      style={{
        padding: `0.4rem 0.6rem 0.4rem ${paddingLeftRem ?? 0.65}rem`,
      }}
      onClick={() => {
        if (!disabled) onPick();
      }}
    >
      {children}
    </button>
  );
}

/** Scope selector shared by bulk trigger-word actions and batch LLM tagging. */
export function ImageScopePicker({
  disabled,
  t,
  config,
}: {
  disabled: boolean;
  t: TranslateFn;
  config: ImageScopePickerConfig;
}) {
  const [scopeModeOpen, setScopeModeOpen] = useState(false);
  const [scopeFolderOpen, setScopeFolderOpen] = useState(false);

  const modeTriggerLabel = useMemo(() => {
    if (config.mode === "all") return t("dataset.triggerScope.all");
    if (config.mode === "group") return t("dataset.triggerScope.group");
    return t("dataset.triggerScope.selection");
  }, [config.mode, t]);

  const folderTriggerLabel = useMemo(() => {
    if (config.groupPath === "") return t("dataset.triggerScope.rootFolder");
    const hit = config.folderOptions.find((o) => o.value === config.groupPath);
    return hit?.label ?? config.groupPath;
  }, [config.folderOptions, config.groupPath, t]);

  return (
    <div className="lf-trigger-scope-block">
      <div className="lf-trigger-field-label">{t(config.labelKey)}</div>
      <div className="lf-trigger-scope-row">
        <ScopeMenuButton
          ariaLabel={t(config.labelKey)}
          disabled={disabled || config.imageEntriesLength === 0}
          open={scopeModeOpen}
          onOpenChange={(v) => {
            setScopeModeOpen(v);
            if (v) setScopeFolderOpen(false);
          }}
          triggerLabel={modeTriggerLabel}
          menuAlign="trigger"
        >
          <div className="lf-trigger-menu-panel-inner">
            <ScopeMenuOption
              selected={config.mode === "all"}
              onPick={() => {
                config.onChangeMode("all");
                setScopeModeOpen(false);
              }}
            >
              {t("dataset.triggerScope.all")}
            </ScopeMenuOption>
            <ScopeMenuOption
              selected={config.mode === "group"}
              onPick={() => {
                config.onChangeMode("group");
                setScopeModeOpen(false);
              }}
            >
              {t("dataset.triggerScope.group")}
            </ScopeMenuOption>
            <ScopeMenuOption
              selected={config.mode === "selection"}
              onPick={() => {
                config.onChangeMode("selection");
                setScopeModeOpen(false);
              }}
            >
              {t("dataset.triggerScope.selection")}
            </ScopeMenuOption>
          </div>
        </ScopeMenuButton>
        {config.mode === "group" ? (
          <ScopeMenuButton
            ariaLabel={t(config.folderMenuAriaKey)}
            disabled={disabled || config.imageEntriesLength === 0}
            open={scopeFolderOpen}
            onOpenChange={(v) => {
              setScopeFolderOpen(v);
              if (v) setScopeModeOpen(false);
            }}
            triggerLabel={folderTriggerLabel}
            menuAlign="wide"
          >
            <div className="lf-trigger-menu-panel-inner">
              <ScopeMenuOption
                selected={config.groupPath === ""}
                paddingLeftRem={0.65}
                onPick={() => {
                  config.onChangeGroupPath("");
                  setScopeFolderOpen(false);
                }}
              >
                {t("dataset.triggerScope.rootFolder")}
              </ScopeMenuOption>
              {config.folderOptions.map((opt) => (
                <ScopeMenuOption
                  key={opt.value}
                  selected={config.groupPath === opt.value}
                  paddingLeftRem={0.65 + Math.max(0, opt.depth) * 0.65}
                  onPick={() => {
                    config.onChangeGroupPath(opt.value);
                    setScopeFolderOpen(false);
                  }}
                >
                  {opt.label}
                </ScopeMenuOption>
              ))}
            </div>
          </ScopeMenuButton>
        ) : null}
      </div>
      {config.mode === "selection" && config.selectionHintKey ? (
        <div className="lf-trigger-hint">{t(config.selectionHintKey)}</div>
      ) : null}
      <div className="lf-trigger-hint">
        {t(config.targetCountKey, { count: config.targetCount })}
      </div>
    </div>
  );
}

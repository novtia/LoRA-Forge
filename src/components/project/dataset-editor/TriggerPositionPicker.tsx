import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, PlusCircle } from "lucide-react";
import type { TranslateFn } from "../../../lib/i18n";
import { resolveTriggerInsertSlot, splitCaptionTagsForPreview } from "./datasetEditorHelpers";

/**
 * Single insertion-point marker between (or at the ends of) the tag chain.
 * Renders either a thin vertical "dot+bar" target or, when active, a dashed
 * pill containing the ghost trigger label.
 */
function SlotMarker({
  active,
  disabled,
  onClick,
  label,
  ghostLabel,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
  ghostLabel: string | null;
}) {
  if (active && ghostLabel !== null) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed
        title={label}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.25rem",
          padding: "0.2rem 0.5rem",
          border: "1px dashed var(--accent-acid)",
          color: "var(--accent-acid)",
          borderRadius: "0.3rem",
          background: "var(--accent-acid-dim)",
          cursor: disabled ? "not-allowed" : "pointer",
          font: "inherit",
          maxWidth: "12rem",
        }}
      >
        <PlusCircle size={11} aria-hidden />
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {ghostLabel}
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        position: "relative",
        width: "0.85rem",
        height: "1.6rem",
        padding: 0,
        border: "none",
        background: "transparent",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.1rem",
        color: "var(--border-glow)",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.color = "var(--accent-acid)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--border-glow)";
      }}
    >
      <span
        aria-hidden
        style={{
          display: "block",
          width: "2px",
          height: "1.1rem",
          background: "currentColor",
          opacity: 0.6,
          borderRadius: "1px",
        }}
      />
      <span
        aria-hidden
        style={{
          display: "block",
          width: "5px",
          height: "5px",
          borderRadius: "50%",
          background: "currentColor",
        }}
      />
    </button>
  );
}

/**
 * Visual picker for the trigger-word insertion slot.
 *
 * Renders the current caption as a chain of pill-shaped tags interleaved with
 * clickable "slot" markers. Clicking a slot selects that 0..N insertion point,
 * and the chosen slot is replaced by a dashed "ghost" pill that previews where
 * the trigger word will land. Two shortcut buttons ("Front" / "End") plus a
 * numeric override input round out the affordances.
 *
 * The `rawPosition` value is the same persisted string used by the writer, so
 * the preview here is guaranteed to match what `buildCaptionWithTriggerAt`
 * would produce.
 */
export function TriggerPositionPicker({
  caption,
  triggerWord,
  rawPosition,
  onChangeRaw,
  disabled,
  t,
}: {
  caption: string;
  triggerWord: string;
  rawPosition: string;
  onChangeRaw: (next: string) => void;
  disabled: boolean;
  t: TranslateFn;
}) {
  // Collapsed by default to keep the form compact; expand only when the user
  // wants to fine-tune the slot via the visual chain.
  const [expanded, setExpanded] = useState(false);

  const tags = useMemo(() => splitCaptionTagsForPreview(caption), [caption]);
  const tagCount = tags.length;
  const selectedSlot = useMemo(
    () => resolveTriggerInsertSlot(rawPosition, tagCount),
    [rawPosition, tagCount],
  );
  const trimmedTrigger = triggerWord.trim();
  const ghostLabel = trimmedTrigger || t("dataset.triggerWord");

  // Persist `-1` for "end" so the writer keeps the legacy semantics; for any
  // middle slot we write the slot index verbatim. Front (0) is stored as the
  // empty string to preserve legacy default behaviour on first load.
  const writeSlot = useCallback(
    (slot: number) => {
      if (slot <= 0) onChangeRaw("");
      else if (slot >= tagCount) onChangeRaw("-1");
      else onChangeRaw(String(slot));
    },
    [onChangeRaw, tagCount],
  );

  const positionLabel = useMemo(() => {
    if (tagCount === 0) return t("dataset.triggerPosition.emptyCaption");
    if (selectedSlot <= 0) return t("dataset.triggerPosition.atFront");
    if (selectedSlot >= tagCount) return t("dataset.triggerPosition.atEnd");
    return t("dataset.triggerPosition.afterNth", { n: selectedSlot });
  }, [selectedSlot, tagCount, t]);

  const MAX_VISIBLE = 14;
  // Window-sliding around the selected slot keeps it visible in long captions
  // without making the picker scroll horizontally.
  const { visibleTags, startOffset, truncatedHead, truncatedTail } = useMemo(() => {
    if (tagCount <= MAX_VISIBLE) {
      return {
        visibleTags: tags,
        startOffset: 0,
        truncatedHead: 0,
        truncatedTail: 0,
      };
    }
    const half = Math.floor(MAX_VISIBLE / 2);
    let start = Math.max(0, Math.min(selectedSlot - half, tagCount - MAX_VISIBLE));
    const end = Math.min(tagCount, start + MAX_VISIBLE);
    start = Math.max(0, end - MAX_VISIBLE);
    return {
      visibleTags: tags.slice(start, end),
      startOffset: start,
      truncatedHead: start,
      truncatedTail: tagCount - end,
    };
  }, [tags, tagCount, selectedSlot]);

  const handleSlotClick = useCallback(
    (slot: number) => {
      if (disabled) return;
      writeSlot(slot);
    },
    [disabled, writeSlot],
  );

  const summaryToggleTitle = expanded
    ? t("dataset.triggerPosition.collapse")
    : t("dataset.triggerPosition.expand");

  return (
    <div
      className="lf-trigger-pos-picker"
      style={{
        display: "flex",
        flexDirection: "column",
        border: "1px solid var(--border-dim)",
        borderRadius: "0.4rem",
        background: "var(--bg-surface)",
        opacity: disabled ? 0.6 : 1,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        disabled={disabled}
        aria-expanded={expanded}
        title={summaryToggleTitle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          padding: "0.4rem 0.6rem",
          background: "transparent",
          border: "none",
          borderBottom: expanded ? "1px solid var(--border-dim)" : "none",
          color: "var(--text-muted)",
          fontSize: "0.72rem",
          cursor: disabled ? "not-allowed" : "pointer",
          font: "inherit",
          textAlign: "left",
          width: "100%",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.4rem",
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <span
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              flexShrink: 0,
            }}
          >
            {t("dataset.triggerPosition.label")}
          </span>
          <span
            style={{
              color: "var(--accent-acid)",
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {positionLabel}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          style={{
            flexShrink: 0,
            transition: "transform 120ms ease",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {expanded ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.4rem",
            padding: "0.5rem 0.6rem",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              className="btn"
              style={{
                padding: "0.2rem 0.55rem",
                fontSize: "0.7rem",
                borderColor:
                  selectedSlot <= 0 ? "var(--accent-acid)" : "var(--border-dim)",
                color: selectedSlot <= 0 ? "var(--accent-acid)" : undefined,
              }}
              disabled={disabled}
              onClick={() => handleSlotClick(0)}
              title={t("dataset.triggerPosition.front")}
              aria-pressed={selectedSlot <= 0}
            >
              <ChevronsLeft size={12} aria-hidden style={{ marginRight: "0.2rem" }} />
              {t("dataset.triggerPosition.front")}
            </button>
            <button
              type="button"
              className="btn"
              style={{
                padding: "0.2rem 0.55rem",
                fontSize: "0.7rem",
                borderColor:
                  tagCount > 0 && selectedSlot >= tagCount
                    ? "var(--accent-acid)"
                    : "var(--border-dim)",
                color:
                  tagCount > 0 && selectedSlot >= tagCount ? "var(--accent-acid)" : undefined,
              }}
              disabled={disabled || tagCount === 0}
              onClick={() => handleSlotClick(tagCount)}
              title={t("dataset.triggerPosition.end")}
              aria-pressed={tagCount > 0 && selectedSlot >= tagCount}
            >
              {t("dataset.triggerPosition.end")}
              <ChevronsRight size={12} aria-hidden style={{ marginLeft: "0.2rem" }} />
            </button>
            <input
              type="number"
              className="form-input"
              style={{
                width: "3.6rem",
                padding: "0.2rem 0.35rem",
                fontSize: "0.72rem",
                textAlign: "center",
              }}
              placeholder="0"
              title={t("dataset.triggerPosition.numericHint")}
              aria-label={t("dataset.triggerPosition.numericLabel")}
              value={rawPosition}
              disabled={disabled}
              onChange={(e) => onChangeRaw(e.target.value)}
              min={-1}
              step={1}
              autoComplete="off"
            />
          </div>

          <div
            role="radiogroup"
            aria-label={t("dataset.triggerPosition.label")}
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "0.15rem",
              padding: "0.25rem 0",
              minHeight: "2.1rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.72rem",
              lineHeight: 1.1,
            }}
          >
            {tagCount === 0 ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.25rem 0.55rem",
                  border: "1px dashed var(--accent-acid)",
                  color: "var(--accent-acid)",
                  borderRadius: "0.3rem",
                  background: "var(--accent-acid-dim)",
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                <PlusCircle size={11} aria-hidden />
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: "12rem",
                  }}
                >
                  {ghostLabel}
                </span>
              </div>
            ) : (
              <>
                <SlotMarker
                  active={selectedSlot === 0 && truncatedHead === 0}
                  disabled={disabled}
                  onClick={() => handleSlotClick(0)}
                  label={t("dataset.triggerPosition.slotAriaFront")}
                  ghostLabel={selectedSlot === 0 && truncatedHead === 0 ? ghostLabel : null}
                />
                {truncatedHead > 0 ? (
                  <span
                    style={{
                      color: "var(--text-muted)",
                      padding: "0 0.25rem",
                      fontSize: "0.68rem",
                    }}
                    aria-hidden
                  >
                    … +{truncatedHead}
                  </span>
                ) : null}
                {visibleTags.map((tag, vIdx) => {
                  const tagAbsIdx = startOffset + vIdx;
                  const slotAfter = tagAbsIdx + 1;
                  const isLastVisibleTag = vIdx === visibleTags.length - 1;
                  return (
                    <span
                      key={`${tagAbsIdx}-${tag}`}
                      style={{ display: "inline-flex", alignItems: "center", gap: "0.15rem" }}
                    >
                      <span
                        style={{
                          padding: "0.2rem 0.5rem",
                          border: "1px solid var(--border-dim)",
                          borderRadius: "0.3rem",
                          background: "var(--bg-surface-alt)",
                          color: "var(--text-muted)",
                          maxWidth: "10rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={tag}
                      >
                        {tag}
                      </span>
                      {isLastVisibleTag && truncatedTail > 0 ? (
                        <span
                          style={{
                            color: "var(--text-muted)",
                            padding: "0 0.25rem",
                            fontSize: "0.68rem",
                          }}
                          aria-hidden
                        >
                          … +{truncatedTail}
                        </span>
                      ) : null}
                      <SlotMarker
                        active={
                          selectedSlot === slotAfter &&
                          // Only the right edge slot of the last visible tag can stand in
                          // for the "end" slot when the tail is truncated.
                          (truncatedTail === 0 || (isLastVisibleTag && slotAfter === tagCount))
                        }
                        disabled={disabled}
                        onClick={() => handleSlotClick(slotAfter)}
                        label={
                          slotAfter >= tagCount
                            ? t("dataset.triggerPosition.slotAriaEnd")
                            : t("dataset.triggerPosition.slotAriaAfter", { n: slotAfter })
                        }
                        ghostLabel={
                          selectedSlot === slotAfter &&
                          (truncatedTail === 0 || (isLastVisibleTag && slotAfter === tagCount))
                            ? ghostLabel
                            : null
                        }
                      />
                    </span>
                  );
                })}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

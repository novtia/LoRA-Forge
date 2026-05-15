import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

/** 扁平文本中选区的字符区间（与译文 caption 字符串索引一致）。 */
export type TranslatedCaptionEditorHighlight = { start: number; end: number } | null;

export type TranslatedCaptionEditorHandle = {
  /** 当前选区在纯文本中的起止（含 end），collapse 时 start===end；失焦或无选区可为 null。 */
  getPlainSelection(): { start: number; end: number } | null;
  focus(): void;
};

type Props = {
  value: string;
  onChange: (next: string) => void;
  highlight: TranslatedCaptionEditorHighlight;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** 鼠标抬起或 Shift+方向键调整选区后触发（用于映射逗号分区高亮）。 */
  onPlainSelectionGesture?: () => void;
};

function normalizeInnerText(raw: string): string {
  let t = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (t === "\n") {
    t = "";
  }
  return t;
}

function plainTextUnderRoot(root: HTMLElement): string {
  return normalizeInnerText(root.innerText);
}

function fillHighlighted(root: HTMLDivElement, text: string, hl: TranslatedCaptionEditorHighlight) {
  root.replaceChildren();

  if (!text) {
    root.appendChild(document.createElement("br"));
    return;
  }

  const badHl =
    !hl || hl.start < 0 || hl.end > text.length || hl.start >= hl.end;

  if (badHl) {
    root.appendChild(document.createTextNode(text));
    return;
  }

  root.appendChild(document.createTextNode(text.slice(0, hl.start)));
  const span = document.createElement("span");
  span.className = "lf-dataset-caption-editor-partition";
  span.appendChild(document.createTextNode(text.slice(hl.start, hl.end)));
  root.appendChild(span);
  root.appendChild(document.createTextNode(text.slice(hl.end)));
}

function plainOffset(root: HTMLElement, node: Node, offsetInNode: number): number {
  let total = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if (n === node) {
      const len = (n.textContent || "").length;
      return total + Math.min(Math.max(0, offsetInNode), len);
    }
    total += (n.textContent || "").length;
  }
  return total;
}

function plainSelection(root: HTMLElement): { start: number; end: number; collapsed: boolean } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    return null;
  }
  const a = plainOffset(root, sel.anchorNode!, sel.anchorOffset);
  const b = plainOffset(root, sel.focusNode!, sel.focusOffset);
  return {
    start: Math.min(a, b),
    end: Math.max(a, b),
    collapsed: sel.isCollapsed,
  };
}

function resolvePlainBoundary(root: HTMLElement, plainOffset: number): [Node, number] | null {
  let pos = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  let last: Text | null = null;
  while ((n = walker.nextNode())) {
    const tn = n as Text;
    const len = tn.length;
    last = tn;
    if (plainOffset < pos + len) {
      return [tn, plainOffset - pos];
    }
    if (plainOffset === pos + len) {
      return [tn, len];
    }
    pos += len;
  }
  if (last && plainOffset >= pos) {
    return [last, last.length];
  }
  return null;
}

function setPlainSelection(root: HTMLElement, anchorPlain: number, focusPlain: number) {
  const sel = window.getSelection();
  if (!sel) {
    return;
  }
  const lo = Math.min(anchorPlain, focusPlain);
  const hi = Math.max(anchorPlain, focusPlain);
  const startR = resolvePlainBoundary(root, lo);
  const endR = anchorPlain === focusPlain ? startR : resolvePlainBoundary(root, hi);
  if (!startR) {
    return;
  }
  const range = document.createRange();
  if (!endR || lo === hi) {
    range.setStart(startR[0], Math.min(startR[1], (startR[0].textContent || "").length));
    range.collapse(true);
  } else {
    range.setStart(startR[0], Math.min(startR[1], (startR[0].textContent || "").length));
    range.setEnd(endR[0], Math.min(endR[1], (endR[0].textContent || "").length));
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * 译文区：单一 contenteditable，高亮分区与编辑共用同一排版，避免 textarea 叠层错位。
 */
const TranslatedCaptionEditor = forwardRef<TranslatedCaptionEditorHandle, Props>(
  function TranslatedCaptionEditor(
    { value, onChange, highlight, disabled, placeholder, className, onPlainSelectionGesture },
    ref,
  ) {
    const rootRef = useRef<HTMLDivElement>(null);
    const composingRef = useRef(false);
    /** 最近一次在编辑器内的非折叠选区；用于在点击工具栏按钮失焦后仍能覆盖分区。 */
    const lastNonCollapsedSelRef = useRef<{ start: number; end: number } | null>(null);
    const valueRef = useRef(value);
    valueRef.current = value;
    const gestureRef = useRef(onPlainSelectionGesture);
    gestureRef.current = onPlainSelectionGesture;

    const captureSelectionSnapshot = useCallback(() => {
      const root = rootRef.current;
      if (!root || disabled || composingRef.current) {
        return;
      }
      const sel = window.getSelection();
      if (!sel?.anchorNode || !root.contains(sel.anchorNode)) {
        return;
      }
      const s = plainSelection(root);
      if (!s) {
        return;
      }
      if (s.collapsed || s.start === s.end) {
        return;
      }
      lastNonCollapsedSelRef.current = { start: s.start, end: s.end };
      gestureRef.current?.();    }, [disabled]);

    useEffect(() => {
      const onDocSelectionChange = () => {
        queueMicrotask(() => captureSelectionSnapshot());
      };
      document.addEventListener("selectionchange", onDocSelectionChange);
      return () => document.removeEventListener("selectionchange", onDocSelectionChange);
    }, [captureSelectionSnapshot]);

    useLayoutEffect(() => {
      lastNonCollapsedSelRef.current = null;
    }, [value]);

    useImperativeHandle(ref, () => ({
      getPlainSelection() {
        const root = rootRef.current;
        if (!root || disabled) {
          return null;
        }
        const len = valueRef.current.length;
        const clampSel = (x: { start: number; end: number } | null) => {
          if (!x || x.start < 0 || x.end > len || x.start >= x.end) {
            return null;
          }
          return { start: x.start, end: x.end };
        };

        const live = plainSelection(root);
        if (live && !live.collapsed && live.start !== live.end) {
          const boxed = clampSel({ start: live.start, end: live.end });
          if (boxed) {
            lastNonCollapsedSelRef.current = boxed;
          }
          return boxed;
        }

        return clampSel(lastNonCollapsedSelRef.current);
      },
      focus() {
        rootRef.current?.focus({ preventScroll: true });
      },
    }));

    const applyDomFromProps = useCallback(() => {
      const root = rootRef.current;
      if (!root || composingRef.current) {
        return;
      }

      const active = document.activeElement === root && !disabled;
      let restoreLo = 0;
      let restoreHi = 0;
      let collapsed = true;
      if (active) {
        const ps = plainSelection(root);
        if (ps) {
          restoreLo = ps.collapsed ? ps.start : ps.start;
          restoreHi = ps.collapsed ? ps.start : ps.end;
          collapsed = ps.collapsed;
        }
      }

      fillHighlighted(root, value, highlight);

      if (active) {
        const len = value.length;
        const clamp = (n: number) => Math.max(0, Math.min(n, len));
        const a = clamp(restoreLo);
        const b = clamp(restoreHi);
        if (collapsed) {
          setPlainSelection(root, a, a);
        } else {
          setPlainSelection(root, a, b);
        }
      }
    }, [value, highlight, disabled]);

    useLayoutEffect(() => {
      if (composingRef.current) {
        return;
      }
      applyDomFromProps();
    }, [applyDomFromProps]);

    const emitChange = useCallback(() => {
      const root = rootRef.current;
      if (!root || disabled) {
        return;
      }
      let next = plainTextUnderRoot(root);
      if (next === "\n") {
        next = "";
      }
      if (next !== value) {
        onChange(next);
      }
    }, [disabled, onChange, value]);

    const handleInput = () => {
      emitChange();
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (disabled) {
        return;
      }
      e.preventDefault();
      const text = e.clipboardData.getData("text/plain").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      const sel = window.getSelection();
      if (!sel?.rangeCount || !rootRef.current?.contains(sel.anchorNode)) {
        return;
      }
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const tn = document.createTextNode(text);
      range.insertNode(tn);
      range.setStartAfter(tn);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      emitChange();
    };

    const showPlaceholder = Boolean(placeholder) && !value && !disabled;

    const bumpPlainSelection = () => {
      queueMicrotask(() => captureSelectionSnapshot());
    };

    return (
      <div className="lf-dataset-caption-editor-wrap">
        {showPlaceholder ? (
          <div className="lf-dataset-caption-editor-placeholder" aria-hidden>
            {placeholder}
          </div>
        ) : null}
        <div
          ref={rootRef}
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder || undefined}
          spellCheck={false}
          contentEditable={!disabled}
          suppressContentEditableWarning
          className={`lf-dataset-caption-editor form-input ${showPlaceholder ? "lf-dataset-caption-editor--behind-placeholder" : ""} ${className ?? ""}`.trim()}
          onInput={handleInput}
          onPaste={handlePaste}
          onMouseUp={bumpPlainSelection}
          onKeyUp={(e) => {
            if (
              e.shiftKey &&
              (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")
            ) {
              bumpPlainSelection();
            }
          }}
          onCompositionStart={() => {
            composingRef.current = true;
          }}
          onCompositionEnd={() => {
            composingRef.current = false;
            emitChange();
          }}
        />
      </div>
    );
  },
);

export default TranslatedCaptionEditor;

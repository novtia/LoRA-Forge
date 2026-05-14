import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

const GROUP_LABEL_STYLE: CSSProperties = {
  padding: "0.35rem 0.75rem 0.15rem",
  fontSize: "0.62rem",
  fontFamily: "var(--font-mono)",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--accent-acid, #d4ff00)",
  userSelect: "none",
  pointerEvents: "none",
};

function DropdownItem({
  onClick,
  active,
  children,
}: {
  onClick: () => void;
  active: boolean;
  children: ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  const bg = active || hovered ? "rgba(255,255,255,0.07)" : "transparent";
  return (
    <div
      role="option"
      aria-selected={active}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "0.38rem 0.75rem 0.38rem 1.25rem",
        fontSize: "0.78rem",
        color: active ? "var(--accent-acid, #d4ff00)" : "var(--text-primary, #e8e8e8)",
        background: bg,
        cursor: "pointer",
        transition: "background 0.1s",
        userSelect: "none",
      }}
    >
      {children}
    </div>
  );
}

export type PresetMenuItem = { id: string; label: string };

export type PresetMenuGroup = { label?: string; items: PresetMenuItem[] };

/** Custom preset dropdown (Portal + themed panel). Same UX as training config presets; avoids native select styling issues in WebView2. */
export function PresetDropdownMenu({
  value,
  onChange,
  placeholder,
  groups,
  allowEmptyValue = false,
  disabled = false,
  /** When true, fill parent width (e.g. LLM form). When false, flex:1 for toolbar rows. */
  block = false,
}: {
  value: string;
  onChange: (id: string) => void;
  placeholder: string;
  groups: PresetMenuGroup[];
  allowEmptyValue?: boolean;
  disabled?: boolean;
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleOpen = () => {
    if (disabled) return;
    if (!open && triggerRef.current) {
      setRect(triggerRef.current.getBoundingClientRect());
    }
    setOpen((o) => !o);
  };

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  const flatItems = groups.flatMap((g) => g.items);
  const selected = flatItems.find((p) => p.id === value);
  const displayLabel = selected ? selected.label : placeholder;

  const panel =
    open && rect
      ? createPortal(
          <div
            ref={panelRef}
            className="preset-dropdown-panel"
            role="listbox"
            style={{
              position: "fixed",
              top: rect.bottom + 3,
              left: rect.left,
              width: rect.width,
              zIndex: 9999,
              background: "var(--bg-card, #18181b)",
              border: "1px solid var(--border-dim, #333)",
              borderRadius: "5px",
              boxShadow: "0 12px 32px rgba(0,0,0,0.75)",
              maxHeight: "340px",
              overflowY: "auto",
              padding: "0.2rem 0",
            }}
          >
            {allowEmptyValue ? (
              <DropdownItem active={!value} onClick={() => select("")}>
                <span style={{ color: "var(--text-muted)" }}>{placeholder}</span>
              </DropdownItem>
            ) : null}
            {groups.map((group, gi) => (
              <div key={gi}>
                {group.label ? <div style={GROUP_LABEL_STYLE}>{group.label}</div> : null}
                {group.items.map((p) => (
                  <DropdownItem key={p.id} active={p.id === value} onClick={() => select(p.id)}>
                    {p.label}
                  </DropdownItem>
                ))}
              </div>
            ))}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      style={
        block
          ? { position: "relative", width: "100%", minWidth: 0 }
          : { position: "relative", flex: 1, minWidth: 0 }
      }
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.4rem",
          height: "1.85rem",
          padding: "0 0.6rem",
          fontSize: "0.78rem",
          background: "var(--bg-input, var(--bg-surface))",
          border: "1px solid var(--border-dim)",
          borderRadius: "var(--radius-sm, 4px)",
          color: selected ? "var(--text-primary)" : "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          textAlign: "left",
          whiteSpace: "nowrap",
          overflow: "hidden",
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{displayLabel}</span>
        <ChevronDown
          size={12}
          style={{
            flexShrink: 0,
            opacity: 0.55,
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 0.15s",
          }}
        />
      </button>
      {panel}
    </div>
  );
}

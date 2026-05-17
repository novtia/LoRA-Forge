import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Single floating popup of context-menu actions, positioned at the supplied viewport
 * coordinates. Items are simple `<button>` rows so the keyboard / focus story is
 * predictable; closing happens through outside-click + Escape, owned by the parent.
 */
export type DatasetContextMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export function DatasetContextMenu({
  open,
  x,
  y,
  items,
  onClose,
}: {
  open: boolean;
  x: number;
  y: number;
  items: DatasetContextMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (ev: MouseEvent) => {
      if (ref.current && ev.target instanceof Node && !ref.current.contains(ev.target)) {
        onClose();
      }
    };
    const escHandler = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", escHandler);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", escHandler);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Clamp the menu inside the viewport so right-clicking near the bottom/right edge
  // doesn't render half of it off-screen.
  const MAX_W = 240;
  const MAX_H = 320;
  const left = Math.min(x, Math.max(0, window.innerWidth - MAX_W - 8));
  const top = Math.min(y, Math.max(0, window.innerHeight - MAX_H - 8));

  return (
    <div
      ref={ref}
      role="menu"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 1100,
        minWidth: 200,
        maxWidth: MAX_W,
        background: "var(--bg-card, #1e1e1e)",
        border: "1px solid var(--border-dim)",
        borderRadius: "0.4rem",
        padding: "0.3rem",
        boxShadow: "0 14px 30px rgba(0,0,0,0.55)",
        display: "flex",
        flexDirection: "column",
        gap: "0.1rem",
      }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            onClose();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.4rem 0.55rem",
            background: "transparent",
            border: "none",
            color: item.danger ? "var(--accent-orange)" : "var(--text-main)",
            fontSize: "0.78rem",
            textAlign: "left",
            cursor: item.disabled ? "not-allowed" : "pointer",
            opacity: item.disabled ? 0.55 : 1,
            borderRadius: "0.3rem",
            font: "inherit",
          }}
          onMouseEnter={(e) => {
            if (!item.disabled) {
              e.currentTarget.style.background =
                "color-mix(in srgb, var(--accent-acid) 18%, transparent)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {item.icon ? (
            <span style={{ display: "inline-flex", alignItems: "center" }}>{item.icon}</span>
          ) : null}
          <span style={{ flex: 1 }}>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

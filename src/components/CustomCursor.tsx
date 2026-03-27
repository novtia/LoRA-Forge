import { useEffect, useRef } from "react";

export function CustomCursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dot = dotRef.current;
    const outline = outlineRef.current;
    if (!dot || !outline) return;

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let outlineX = mouseX;
    let outlineY = mouseY;
    let rafId: number;

    const onMouseMove = (e: MouseEvent) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      dot.style.transform = `translate(${mouseX}px, ${mouseY}px) translate(-50%, -50%)`;
    };

    const animate = () => {
      outlineX += (mouseX - outlineX) * 0.15;
      outlineY += (mouseY - outlineY) * 0.15;
      outline.style.transform = `translate(${outlineX}px, ${outlineY}px) translate(-50%, -50%)`;
      rafId = requestAnimationFrame(animate);
    };

    const onEnter = () => {
      outline.style.width = "60px";
      outline.style.height = "60px";
      outline.style.backgroundColor = "rgba(212, 255, 0, 0.05)";
      outline.style.borderColor = "var(--accent-acid)";
    };

    const onLeave = () => {
      outline.style.width = "40px";
      outline.style.height = "40px";
      outline.style.backgroundColor = "transparent";
      outline.style.borderColor = "rgba(212, 255, 0, 0.4)";
    };

    const attachHover = () => {
      document
        .querySelectorAll<HTMLElement>(
          "button, a, .card.clickable-card, .action-btn, .data-img, .form-input, .form-select, .switch-wrapper, .project-card-link"
        )
        .forEach((el) => {
          if (el.dataset.cursorBound) return;
          el.dataset.cursorBound = "1";
          el.style.cursor = "none";
          el.addEventListener("mouseenter", onEnter);
          el.addEventListener("mouseleave", onLeave);
        });
    };

    window.addEventListener("mousemove", onMouseMove);
    rafId = requestAnimationFrame(animate);

    attachHover();
    const observer = new MutationObserver(attachHover);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <>
      <div ref={dotRef} className="cursor-dot" />
      <div ref={outlineRef} className="cursor-outline" />
    </>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

function InfoGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

type InfoAsideProps = {
  children: ReactNode;
  /** Screen reader label for the toggle */
  ariaLabel?: string;
};

/**
 * Compact “ⓘ” control: click to show extra copy; click outside or Escape to dismiss.
 */
export function InfoAside({ children, ariaLabel = "More information" }: InfoAsideProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="relative inline-flex align-middle" ref={rootRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={panelId}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--eg-border)] text-[var(--eg-muted)] hover:bg-[var(--eg-surface)] hover:text-[var(--eg-fg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--eg-accent)]"
        onClick={() => setOpen((v) => !v)}
      >
        <InfoGlyph />
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          className="absolute end-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-2rem))] max-h-64 overflow-y-auto rounded-xl border border-[var(--eg-border)] bg-[var(--eg-surface)] p-3 text-left text-xs leading-relaxed text-[var(--eg-muted)] shadow-lg"
        >
          <div className="space-y-2 [&_p+p]:mt-2">{children}</div>
        </div>
      )}
    </div>
  );
}

export function PageHeading({
  title,
  info,
  className,
}: {
  title: string;
  info: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <InfoAside ariaLabel={`About: ${title}`}>{info}</InfoAside>
    </div>
  );
}

export function SectionHeading({ title, info }: { title: string; info: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <InfoAside ariaLabel={`About: ${title}`}>{info}</InfoAside>
    </div>
  );
}

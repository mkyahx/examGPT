"use client";

/* eslint-disable @next/next/no-html-link-for-pages */
import { usePathname } from "next/navigation";
import { InfoAside } from "@/components/InfoAside";
import { useExamGPT } from "@/components/providers/ExamGPTProvider";
import { CREDITS } from "@/lib/constants";

const nav = [
  { href: "/", label: "Overview" },
  { href: "/generate", label: "Mock exam" },
  { href: "/history", label: "History" },
  { href: "/contribute", label: "Contribute" },
  { href: "/bank", label: "Bank" },
  { href: "/settings", label: "Credits" },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { credits, byok, hydrated } = useExamGPT();

  return (
    <div className="flex min-h-full flex-col bg-[var(--eg-bg)] text-[var(--eg-fg)]">
      <header className="sticky top-0 z-40 border-b border-[var(--eg-border)] bg-[var(--eg-header)]/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:gap-4 sm:px-4 sm:py-3">
          <a href="/" className="group flex items-baseline gap-1.5 sm:gap-2">
            <span className="text-base font-semibold tracking-tight text-[var(--eg-accent-strong)] sm:text-lg">
              ExamGPT
            </span>
            <span className="hidden text-xs font-medium uppercase tracking-widest text-[var(--eg-muted)] sm:inline">
              HKU Edition
            </span>
          </a>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <div className="flex items-center gap-1 rounded-full border border-[var(--eg-border)] bg-[var(--eg-surface)] px-1.5 py-1 text-xs font-medium text-[var(--eg-muted)] sm:gap-1 sm:px-2">
              <span className="hidden px-1 sm:inline sm:px-2">Credits</span>
              <span className="rounded-full bg-[var(--eg-accent)]/15 px-1.5 py-0.5 text-[var(--eg-accent-strong)] sm:px-2 sm:py-0.5">
                {!hydrated ? "…" : byok ? "BYOK (0)" : credits}
              </span>
              {!byok && (
                <span className="hidden px-1 text-[10px] text-[var(--eg-muted)] lg:inline lg:px-2">
                  Gen {CREDITS.generateMock} · Re {CREDITS.regenerateQuestions} · Ask{" "}
                  {CREDITS.answerInquiry}
                </span>
              )}
            </div>
            <InfoAside ariaLabel="About credits">
              <p>Demo balance in this browser. BYOK skips credit charges for generate and partial regen.</p>
            </InfoAside>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl flex-wrap gap-1 px-3 pb-2 sm:gap-1 sm:px-4">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                className={`rounded-full px-2 py-1 text-xs transition sm:px-3 sm:py-1.5 sm:text-sm ${
                  active
                    ? "bg-[var(--eg-accent)] text-[var(--eg-on-accent)]"
                    : "text-[var(--eg-muted)] hover:bg-[var(--eg-surface)] hover:text-[var(--eg-fg)]"
                }`}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-0 py-4 sm:px-4 sm:py-6">
        {children}
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-2 border-t border-[var(--eg-border)] px-3 py-4 text-xs text-[var(--eg-muted)] sm:py-5">
        <span>ExamGPT v1.1 · demo</span>
        <InfoAside ariaLabel="About this build">
          <p>HKU Edition MVP. RAG, payments, and vault encryption are not wired — local demo only.</p>
        </InfoAside>
      </footer>
    </div>
  );
}

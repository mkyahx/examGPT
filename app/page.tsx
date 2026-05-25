"use client";

import { CREDITS } from "@/lib/constants";
import { PageHeading } from "@/components/InfoAside";

export default function HomePage() {
  return (
    <div className="mx-auto w-full max-w-xl space-y-6 px-4 py-4 sm:px-0 sm:py-6">
      <section className="eg-card text-center">
        <div className="flex justify-center">
          <PageHeading
            className="justify-center"
            title="ExamGPT · HKU"
            info={
              <>
                <p>
                  Mock exams, per-question review, partial rewrites, history, and feedback that
                  promotes papers into a demo repository — all stored in your browser for this MVP.
                </p>
                <p>
                  Credits: mock {CREDITS.generateMock}, regen {CREDITS.regenerateQuestions}, ask{" "}
                  {CREDITS.answerInquiry}, feedback +{CREDITS.realExamFeedback}, question +
                  {CREDITS.questionContribution}; BYOK uses 0 credits for generation.
                </p>
              </>
            }
          />
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:justify-center">
          <a className="eg-btn w-full sm:w-auto" href="/generate">
            Generate
          </a>
          <a className="eg-btn-ghost w-full sm:w-auto" href="/settings">
            Credits / BYOK
          </a>
        </div>
      </section>

      <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 px-2 text-sm text-[var(--eg-accent-strong)]">
        <a className="underline-offset-4 hover:underline" href="/history">
          History
        </a>
        <a className="underline-offset-4 hover:underline" href="/contribute">
          Contribute
        </a>
        <a className="underline-offset-4 hover:underline" href="/bank">
          Bank
        </a>
      </nav>
    </div>
  );
}

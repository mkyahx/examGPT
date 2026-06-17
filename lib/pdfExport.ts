import type { MockExam } from "@/lib/types";

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN_X = 50;
const TOP_Y = 792;
const LINE_HEIGHT = 14;
const BODY_SIZE = 10;
const TITLE_SIZE = 16;
const MAX_BODY_CHARS = 88;
const MAX_TITLE_CHARS = 56;

function cleanText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function escapePdfText(value: string) {
  return cleanText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapLine(value: string, maxChars: number) {
  const text = cleanText(value).trimEnd();
  if (!text.trim()) return [""];

  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function addWrapped(lines: string[], value: string, maxChars = MAX_BODY_CHARS) {
  for (const rawLine of cleanText(value).split("\n")) {
    lines.push(...wrapLine(rawLine, maxChars));
  }
}

type PdfExportOptions = {
  includeSources?: boolean;
};

function buildExamLines(exam: MockExam, options: PdfExportOptions = {}) {
  const lines: string[] = [];
  addWrapped(lines, `${exam.courseCode} Mock Exam`, MAX_TITLE_CHARS);
  lines.push("");
  lines.push(`Generated: ${new Date(exam.createdAt).toLocaleString()}`);
  lines.push(`Mode: ${exam.generationMode ?? "unknown"}`);
  lines.push(`Questions: ${exam.questions.length}`);
  lines.push(`Total marks: ${exam.questions.reduce((sum, question) => sum + question.marks, 0)}`);
  if (options.includeSources) {
    lines.push("");
    addWrapped(lines, `Source: ${exam.sourceSummary}`);
  }
  if (exam.focusHints && exam.focusHints !== "(none)") {
    lines.push("");
    addWrapped(lines, `Focus: ${exam.focusHints}`);
  }
  lines.push("");

  exam.questions.forEach((question, index) => {
    if (index > 0) lines.push("", "");
    lines.push(`Q${index + 1}. ${question.marks} marks`);
    if (options.includeSources) {
      addWrapped(lines, question.section);
    }
    if (options.includeSources && question.sourceQuestionId) {
      addWrapped(
        lines,
        `Source question: ${question.sourceQuestionId}${
          question.sourcePdfPath ? ` | ${question.sourcePdfPath}` : ""
        }`,
      );
    }
    lines.push("");
    addWrapped(lines, question.prompt);
    lines.push("", "");
  });

  return lines;
}

function paginate(lines: string[]) {
  const maxLinesPerPage = Math.floor((TOP_Y - 50) / LINE_HEIGHT);
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += maxLinesPerPage) {
    pages.push(lines.slice(index, index + maxLinesPerPage));
  }
  return pages.length > 0 ? pages : [[""]];
}

function pageStream(lines: string[], isFirstPage: boolean) {
  const commands = [
    "BT",
    `/F1 ${isFirstPage ? TITLE_SIZE : BODY_SIZE} Tf`,
    `${LINE_HEIGHT} TL`,
    `${MARGIN_X} ${TOP_Y} Td`,
  ];

  lines.forEach((line, index) => {
    if (index === 1 && isFirstPage) commands.push(`/F1 ${BODY_SIZE} Tf`);
    commands.push(`(${escapePdfText(line)}) Tj`);
    if (index < lines.length - 1) commands.push("T*");
  });

  commands.push("ET");
  return commands.join("\n");
}

function buildPdf(lines: string[]) {
  const pages = paginate(lines);
  const objects: string[] = [];

  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${
      pages.length
    } >>`,
  );

  pages.forEach((pageLines, index) => {
    const pageObjectId = 3 + index * 2;
    const streamObjectId = pageObjectId + 1;
    const stream = pageStream(pageLines, index === 0);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${
        3 + pages.length * 2
      } 0 R >> >> /Contents ${streamObjectId} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return pdf;
}

function safeFileName(value: string) {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "mock-exam";
}

export type PdfDownload = {
  fileName: string;
  url: string;
};

function pdfDataUrl(pdf: string) {
  return `data:application/pdf;base64,${btoa(pdf)}`;
}

export function createMockExamPdfDownload(
  exam: MockExam,
  options: PdfExportOptions = {},
): PdfDownload {
  const pdf = buildPdf(buildExamLines(exam, options));
  return {
    fileName: `${safeFileName(`${exam.courseCode}-${exam.id}`)}.pdf`,
    url: pdfDataUrl(pdf),
  };
}

export function triggerPdfDownload(download: PdfDownload) {
  const link = document.createElement("a");
  link.href = download.url;
  link.download = download.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function exportMockExamPdf(exam: MockExam, options: PdfExportOptions = {}) {
  const download = createMockExamPdfDownload(exam, options);
  triggerPdfDownload(download);
}

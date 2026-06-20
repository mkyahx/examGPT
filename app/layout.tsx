import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { AuthProvider } from "@/components/providers/AuthProvider";
import { ExamGPTProvider } from "@/components/providers/ExamGPTProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ExamGPT · HKU Edition",
  description:
    "AI-driven mock exams for HKU STEM undergraduates — syllabi, past papers, and professor hints, with a credit economy and verified question bank.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full font-sans">
        <AuthProvider>
          <ExamGPTProvider>
            <Shell>{children}</Shell>
          </ExamGPTProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

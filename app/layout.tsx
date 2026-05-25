import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Shell } from "@/components/Shell";
import { ExamGPTProvider } from "@/components/providers/ExamGPTProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans">
        <ExamGPTProvider>
          <Shell>{children}</Shell>
        </ExamGPTProvider>
      </body>
    </html>
  );
}

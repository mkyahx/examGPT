import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  outputFileTracingExcludes: {
    "/api/review-uploads": [
      "./app/**/*",
      "./components/**/*",
      "./db/**/*",
      "./docs/**/*",
      "./downloads/**/*",
      "./extracted/**/*",
      "./review-uploads/**/*",
      "./scripts/**/*",
      "./*.mjs",
      "./*.ts",
      "./*.json",
      "./*.md",
    ],
  },
  outputFileTracingIncludes: {
    "/api/review-uploads": [
      "./scripts/extract-questions.mjs",
      "./node_modules/pdfjs-dist/**/*",
    ],
  },
};

export default nextConfig;

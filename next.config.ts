import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    "/api/review-uploads": ["./scripts/extract-questions.mjs"],
  },
};

export default nextConfig;

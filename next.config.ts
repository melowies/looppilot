import type { NextConfig } from "next";

const config: NextConfig = {
  // Browser regressions must not interrupt an already running local workspace.
  distDir: process.env.LOOPPILOT_TEST_BUILD_DIR || ".next",
  // Keep Next's development badge from covering mobile navigation.
  devIndicators: false,
};

export default config;

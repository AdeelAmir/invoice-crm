import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // Entry points go straight to the invoices list (no page renders a redirect).
  async redirects() {
    return [
      { source: "/", destination: "/dashboard/invoices", permanent: false },
      { source: "/dashboard", destination: "/dashboard/invoices", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

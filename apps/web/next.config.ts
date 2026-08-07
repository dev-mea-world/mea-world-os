import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: [
    "@meaworld/approvals",
    "@meaworld/db",
    "@meaworld/domain",
    "@meaworld/observability",
    "@meaworld/security"
  ]
};

export default nextConfig;

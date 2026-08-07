import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@meaworld/approvals": fileURLToPath(new URL("./packages/approvals/src/index.ts", import.meta.url)),
      "@meaworld/codex": fileURLToPath(new URL("./packages/codex/src/index.ts", import.meta.url)),
      "@meaworld/db/migrate": fileURLToPath(new URL("./packages/db/src/migrate.ts", import.meta.url)),
      "@meaworld/db": fileURLToPath(new URL("./packages/db/src/index.ts", import.meta.url)),
      "@meaworld/domain": fileURLToPath(new URL("./packages/domain/src/index.ts", import.meta.url)),
      "@meaworld/git": fileURLToPath(new URL("./packages/git/src/index.ts", import.meta.url)),
      "@meaworld/notion": fileURLToPath(new URL("./packages/notion/src/index.ts", import.meta.url)),
      "@meaworld/observability": fileURLToPath(new URL("./packages/observability/src/index.ts", import.meta.url)),
      "@meaworld/orchestration": fileURLToPath(new URL("./packages/orchestration/src/index.ts", import.meta.url)),
      "@meaworld/security": fileURLToPath(new URL("./packages/security/src/index.ts", import.meta.url))
    }
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"]
    }
  }
});

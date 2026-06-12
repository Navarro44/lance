import { defineConfig } from "vitest/config";

export default defineConfig({
  // Do not let Vite's optimizer scan these large chain-layer packages.
  // zodiac-roles-sdk and @safe-global/protocol-kit are only used in
  // tests/chain.test.ts; scanning them during collection would add 10+ minutes.
  // Marking them external means Node.js loads them directly via require/import.
  optimizeDeps: {
    exclude: ["zodiac-roles-sdk", "@safe-global/protocol-kit", "ethers"],
  },
  test: {
    globals: true,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    server: {
      deps: {
        external: ["zodiac-roles-sdk", "@safe-global/protocol-kit", "ethers"],
      },
    },
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
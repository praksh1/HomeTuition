import { defineConfig } from "drizzle-kit";
import path from "path";

// Replit injected DATABASE_URL into the environment automatically. Running anywhere else,
// it comes from the .env file at the repo root instead.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(path.join(__dirname, "../../.env"));
  } catch {
    // No .env file — fall through to the error below.
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Create a .env file at the repo root containing DATABASE_URL=...",
  );
}

export default defineConfig({
  // Forward slashes, always: drizzle-kit glob-matches this path, and on Windows the
  // backslashes from path.join() are read as escape characters, matching nothing.
  schema: path.join(__dirname, "./src/schema/index.ts").replace(/\\/g, "/"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});

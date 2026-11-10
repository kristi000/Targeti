import { config } from "dotenv";

// Same files and precedence as Next.js: earlier files win, and real
// environment variables always win over files.
const mode = process.env.NODE_ENV === "production" ? "production" : "development";
config({ path: [`.env.${mode}.local`, ".env.local", `.env.${mode}`, ".env"] });

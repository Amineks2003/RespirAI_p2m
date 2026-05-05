import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "./app.js";
import { connectDatabase } from "./config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const port = Number(process.env.PORT || 4000);

const start = async () => {
  await connectDatabase(process.env.MONGODB_URI);

  app.listen(port, () => {
    console.log(`✅ Backend API running on http://localhost:${port}`);
  });
};

start().catch((error) => {
  console.error("❌ Failed to start server", error);
  process.exit(1);
});

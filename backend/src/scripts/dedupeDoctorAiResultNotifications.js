import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { connectDatabase } from "../config/db.js";
import { Notification } from "../models/Notification.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const normalizeMessage = (value) => String(value || "")
  .replace(/\(\d+%\s*global\s*risk\)/gi, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const buildKey = (notification) => {
  const metadata = notification.metadata || {};
  const user = String(notification.user || "");
  const eventType = String(metadata.type || "");
  const patientCode = String(metadata.patientCode || "");
  const score = metadata.score ?? "na";
  const confidence = metadata.confidence ?? "na";
  const message = normalizeMessage(notification.message || notification.title);

  return `${user}|${eventType}|${patientCode}|${score}|${confidence}|${message}`;
};

const run = async () => {
  const apply = process.argv.includes("--apply");

  await connectDatabase(process.env.MONGODB_URI);

  const notifications = await Notification.find({ "metadata.type": "doctor-ai-results" })
    .sort({ createdAt: -1, _id: -1 })
    .select("_id user title message metadata createdAt")
    .lean();

  const seen = new Set();
  const duplicateIds = [];

  for (const notification of notifications) {
    const key = buildKey(notification);
    if (seen.has(key)) {
      duplicateIds.push(notification._id);
      continue;
    }
    seen.add(key);
  }

  console.log(`doctor-ai-results scanned: ${notifications.length}`);
  console.log(`duplicates found: ${duplicateIds.length}`);

  if (!apply) {
    console.log("Dry-run mode. Re-run with --apply to delete duplicates.");
    return;
  }

  if (duplicateIds.length === 0) {
    console.log("No duplicates to delete.");
    return;
  }

  const result = await Notification.deleteMany({ _id: { $in: duplicateIds } });
  console.log(`duplicates deleted: ${result.deletedCount || 0}`);
};

run()
  .catch((error) => {
    console.error("Failed to dedupe notifications", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });

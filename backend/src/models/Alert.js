import mongoose from "mongoose";

const alertSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    type: { type: String, enum: ["critical", "warning", "info"], default: "info", index: true },
    message: { type: String, required: true },
    source: { type: String, default: "ai-risk-engine" },
    status: { type: String, enum: ["open", "acknowledged", "dismissed", "resolved"], default: "open", index: true },
    resolvedAt: { type: Date },
  },
  { timestamps: true },
);

alertSchema.index({ doctor: 1, createdAt: -1 });

export const Alert = mongoose.model("Alert", alertSchema);

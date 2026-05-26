import mongoose from "mongoose";

const reportSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    title: { type: String, required: true },
    type: { type: String, enum: ["Daily", "Weekly", "Patient", "Audit", "Technical"], required: true },
    status: { type: String, enum: ["draft", "ready"], default: "ready" },
    summary: { type: String, default: "" },
    fileUrl: { type: String, default: "" },
    periodStart: { type: Date },
    periodEnd: { type: Date },
    includeVitals: { type: Boolean, default: true },
    includeAlerts: { type: Boolean, default: true },
    includeConsultations: { type: Boolean, default: true },
    notes: { type: String, default: "" },
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

reportSchema.index({ generatedAt: -1 });

export const Report = mongoose.model("Report", reportSchema);

import mongoose from "mongoose";

const factorSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    value: { type: String, required: true },
    severity: { type: String, enum: ["low", "moderate", "high", "critical"], default: "moderate" },
  },
  { _id: false },
);

const riskAssessmentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    score: { type: Number, required: true },
    confidence: { type: Number, required: true },
    predictedWindowMinutes: { type: Number, default: 120 },
    factors: { type: [factorSchema], default: [] },
    guidelines: { type: [String], default: [] },
    status: { type: String, enum: ["active", "validated", "dismissed"], default: "active", index: true },
    validatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    validatedAt: { type: Date },
    dismissedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    dismissedAt: { type: Date },
  },
  { timestamps: true },
);

riskAssessmentSchema.index({ patient: 1, createdAt: -1 });

export const RiskAssessment = mongoose.model("RiskAssessment", riskAssessmentSchema);

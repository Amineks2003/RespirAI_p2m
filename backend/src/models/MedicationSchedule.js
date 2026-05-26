import mongoose from "mongoose";

const medicationScheduleSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true },
    dose: { type: String, required: true },
    time: { type: String, required: true },
    frequency: { type: String, default: "daily" },
    icon: { type: String, default: "💊" },
    takenToday: { type: Boolean, default: false },
  },
  { timestamps: true },
);

medicationScheduleSchema.index({ patient: 1, createdAt: -1 });

export const MedicationSchedule = mongoose.model("MedicationSchedule", medicationScheduleSchema);

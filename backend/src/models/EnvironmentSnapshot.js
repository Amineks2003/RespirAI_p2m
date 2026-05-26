import mongoose from "mongoose";

const environmentSnapshotSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    aqi: { type: Number, required: true },
    temperature: { type: Number, required: true },
    humidity: { type: Number, required: true },
    pollen: { type: String, default: "" },
    weather: { type: String, default: "" },
    source: { type: String, default: "room-sensor" },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);

environmentSnapshotSchema.index({ patient: 1, timestamp: -1 });

export const EnvironmentSnapshot = mongoose.model("EnvironmentSnapshot", environmentSnapshotSchema);

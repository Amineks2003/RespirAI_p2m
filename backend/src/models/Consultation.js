import mongoose from "mongoose";

const noteSchema = new mongoose.Schema(
  {
    from: { type: String, enum: ["doctor", "patient", "ai"], required: true },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const consultationSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    scheduledFor: { type: Date, required: true, index: true },
    type: { type: String, default: "Follow-up" },
    status: {
      type: String,
      enum: ["urgent", "scheduled", "pending", "completed", "cancelled"],
      default: "scheduled",
      index: true,
    },
    channel: { type: String, enum: ["video", "message", "in-person"], default: "video" },
    notes: { type: [noteSchema], default: [] },
  },
  { timestamps: true },
);

export const Consultation = mongoose.model("Consultation", consultationSchema);

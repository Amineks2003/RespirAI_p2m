import mongoose from "mongoose";

const chatMessageSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["user", "ai", "doctor"], required: true },
    text: { type: String, required: true },
    source: { type: String, default: "respir-ai" },
  },
  { timestamps: true },
);

chatMessageSchema.index({ patient: 1, createdAt: 1 });

export const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

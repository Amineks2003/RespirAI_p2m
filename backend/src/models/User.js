import mongoose from "mongoose";

const preferencesSchema = new mongoose.Schema(
  {
    notifications: { type: Boolean, default: true },
    dataSharing: { type: Boolean, default: true },
    biometric: { type: Boolean, default: false },
    darkMode: { type: Boolean, default: false },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: "" },
    role: { type: String, enum: ["patient", "doctor"], required: true },
    passwordHash: { type: String, required: true, select: false },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    preferences: { type: preferencesSchema, default: () => ({}) },
  },
  { timestamps: true },
);

userSchema.virtual("fullName").get(function fullName() {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export const User = mongoose.model("User", userSchema);

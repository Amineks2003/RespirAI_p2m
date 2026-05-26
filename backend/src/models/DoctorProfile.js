import mongoose from "mongoose";

const doctorProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    licenseNo: { type: String, required: true, trim: true },
    hospital: { type: String, default: "" },
    specialty: { type: String, default: "" },
    department: { type: String, default: "Pulmonology" },
  },
  { timestamps: true },
);

export const DoctorProfile = mongoose.model("DoctorProfile", doctorProfileSchema);

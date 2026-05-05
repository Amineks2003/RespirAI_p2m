import { PatientProfile } from "../models/PatientProfile.js";
import { DoctorProfile } from "../models/DoctorProfile.js";

export const generatePatientCode = async () => {
  let patientCode;
  let exists = true;

  while (exists) {
    patientCode = `#P-${Math.floor(1000 + Math.random() * 9000)}`;
    exists = await PatientProfile.exists({ patientCode });
  }

  return patientCode;
};

export const getRoleProfile = async (user) => {
  if (user.role === "doctor") {
    return DoctorProfile.findOne({ user: user._id });
  }

  return PatientProfile.findOne({ user: user._id }).populate("doctor", "firstName lastName email");
};

import mongoose from "mongoose";
import { PatientProfile } from "../models/PatientProfile.js";
import { User } from "../models/User.js";
import { HttpError } from "../utils/httpError.js";

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

export const resolvePatientByIdentifier = async (identifier) => {
  let profile;

  if (identifier?.startsWith("#") || identifier?.startsWith("P-")) {
    profile = await PatientProfile.findOne({ patientCode: identifier.startsWith("#") ? identifier : `#${identifier}` })
      .populate("user")
      .populate("doctor", "firstName lastName email role");
  } else if (isObjectId(identifier)) {
    profile = await PatientProfile.findOne({ user: identifier })
      .populate("user")
      .populate("doctor", "firstName lastName email role");
  }

  if (!profile) {
    throw new HttpError(404, "Patient not found");
  }

  return profile;
};

export const requirePatientUser = async (userId) => {
  const user = await User.findById(userId);
  if (!user || user.role !== "patient") {
    throw new HttpError(404, "Patient user not found");
  }
  return user;
};

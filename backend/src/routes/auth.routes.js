import express from "express";
import bcrypt from "bcryptjs";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { signAccessToken } from "../utils/jwt.js";
import { authenticate } from "../middlewares/auth.js";
import { User } from "../models/User.js";
import { PatientProfile } from "../models/PatientProfile.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { generatePatientCode, getRoleProfile } from "../services/identity.js";

export const authRouter = express.Router();

const validateEmail = (email) => typeof email === "string" && email.includes("@");

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const {
      role,
      firstName,
      lastName,
      email,
      phone,
      password,
      licenseNo,
      hospital,
      specialty,
      dob,
      gender,
      condition,
    } = req.body;

    if (!["patient", "doctor"].includes(role)) {
      throw new HttpError(400, "Invalid role. Must be patient or doctor.");
    }

    if (!firstName || !lastName || !validateEmail(email) || !password || password.length < 8) {
      throw new HttpError(400, "Missing or invalid registration fields.");
    }

    if (role === "doctor" && !licenseNo) {
      throw new HttpError(400, "Medical license number is required for doctor accounts.");
    }

    const exists = await User.exists({ email: email.toLowerCase() });
    if (exists) {
      throw new HttpError(409, "Email is already in use.");
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName,
      lastName,
      email,
      phone,
      role,
      passwordHash,
    });

    if (role === "doctor") {
      await DoctorProfile.create({
        user: user._id,
        licenseNo,
        hospital: hospital || "",
        specialty: specialty || "Pulmonology",
      });
    } else {
      await PatientProfile.create({
        user: user._id,
        patientCode: await generatePatientCode(),
        dob: dob || null,
        gender: gender || "",
        condition: condition || "",
        status: "stable",
      });
    }

    const token = signAccessToken({ userId: user._id, role: user.role, email: user.email });
    const profile = await getRoleProfile(user);

    return res.status(201).json({
      success: true,
      token,
      user,
      profile,
    });
  }),
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password, role } = req.body;

    if (!validateEmail(email) || !password) {
      throw new HttpError(400, "Email and password are required.");
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select("+passwordHash");
    if (!user) {
      throw new HttpError(401, "Invalid credentials.");
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new HttpError(401, "Invalid credentials.");
    }

    if (role && role !== user.role) {
      throw new HttpError(403, `This account is not a ${role} account.`);
    }

    user.lastLoginAt = new Date();
    await user.save();

    const token = signAccessToken({ userId: user._id, role: user.role, email: user.email });
    const safeUser = await User.findById(user._id);
    const profile = await getRoleProfile(safeUser);

    return res.json({
      success: true,
      token,
      user: safeUser,
      profile,
    });
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    const profile = await getRoleProfile(user);

    return res.json({
      success: true,
      user,
      profile,
    });
  }),
);

authRouter.post("/logout", authenticate, (_req, res) => {
  res.json({ success: true, message: "Logged out." });
});

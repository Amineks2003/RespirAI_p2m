import express from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { User } from "../models/User.js";
import { PatientProfile } from "../models/PatientProfile.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { VitalRecord } from "../models/VitalRecord.js";
import { EnvironmentSnapshot } from "../models/EnvironmentSnapshot.js";
import { RiskAssessment } from "../models/RiskAssessment.js";
import { MedicationSchedule } from "../models/MedicationSchedule.js";
import { Notification } from "../models/Notification.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Consultation } from "../models/Consultation.js";
import { buildAiInsight } from "../services/aiEngine.js";
import { validatePatientFormPayload } from "../services/patientFormSchema.js";
import { ensurePatientClinicalData } from "../services/patientDataBootstrap.js";

export const patientRouter = express.Router();

patientRouter.use(authenticate, requireRole("patient"));

const getPatientContext = async (userId) => {
  const [user, profile] = await Promise.all([
    User.findById(userId),
    PatientProfile.findOne({ user: userId }).populate("doctor", "firstName lastName email"),
  ]);

  if (!user || !profile) {
    throw new HttpError(404, "Patient profile not found.");
  }

  await ensurePatientClinicalData(profile);

  return { user, profile };
};

const ensureCurrentPatientData = async (userId) => {
  const profile = await PatientProfile.findOne({ user: userId });
  if (!profile) {
    throw new HttpError(404, "Patient profile not found.");
  }

  await ensurePatientClinicalData(profile);
  return profile;
};

patientRouter.get(
  "/me/home",
  asyncHandler(async (req, res) => {
    const { profile } = await getPatientContext(req.user.userId);

    const [latestVital, latestEnvironment, latestRisk, medications, unreadNotifications, recentVitals] = await Promise.all([
      VitalRecord.findOne({ patient: req.user.userId }).sort({ timestamp: -1 }),
      EnvironmentSnapshot.findOne({ patient: req.user.userId }).sort({ timestamp: -1 }),
      RiskAssessment.findOne({ patient: req.user.userId }).sort({ createdAt: -1 }),
      MedicationSchedule.find({ patient: req.user.userId }).sort({ createdAt: 1 }),
      Notification.countDocuments({ user: req.user.userId, read: false }),
      VitalRecord.find({ patient: req.user.userId }).sort({ timestamp: -1 }).limit(48),
    ]);

    const computedInsight = await buildAiInsight({
      patientId: profile.patientCode,
      latestVital,
      historyVitals: [...recentVitals].reverse(),
      latestEnvironment,
      patientCondition: profile.condition,
      intakeForm: profile.latestIntakeForm || null,
    });

    return res.json({
      success: true,
      home: {
        profile,
        latestVital,
        latestEnvironment,
        latestRisk,
        latestDoctorSentResult: profile.latestDoctorSentResult || null,
        medications,
        unreadNotifications,
        aiInsight: computedInsight,
      },
    });
  }),
);

patientRouter.get(
  "/me/intake-form",
  asyncHandler(async (req, res) => {
    const profile = await ensureCurrentPatientData(req.user.userId);
    return res.json({ success: true, form: profile.latestIntakeForm || null });
  }),
);

patientRouter.patch(
  "/me/intake-form",
  asyncHandler(async (req, res) => {
    const profile = await ensureCurrentPatientData(req.user.userId);

    const validation = validatePatientFormPayload(req.body || {}, { requireAll: true });
    if (!validation.isValid) {
      throw new HttpError(400, "Invalid intake form payload.", validation.errors);
    }

    const updatedAt = new Date().toISOString();
    profile.latestIntakeForm = {
      ...validation.data,
      updatedAt,
    };
    profile.latestUploadAt = new Date(updatedAt);
    profile.latestUploadName = "Patient health form";
    await profile.save();

    if (profile.doctor) {
      await Notification.create({
        user: profile.doctor,
        type: "info",
        title: "Patient form updated",
        message: `${profile.patientCode} updated their health form data.`,
        metadata: { patientCode: profile.patientCode, type: "patient-form" },
      });
    }

    return res.json({ success: true, form: profile.latestIntakeForm });
  }),
);

patientRouter.get(
  "/me/history",
  asyncHandler(async (req, res) => {
    await ensureCurrentPatientData(req.user.userId);

    const metric = String(req.query.metric || "spo2");
    const limit = Math.min(300, Number(req.query.limit || 50));
    const allowedMetrics = ["spo2", "hr", "rr", "apneaLevel", "coughEvents"];
    if (!allowedMetrics.includes(metric)) {
      throw new HttpError(400, `metric must be one of: ${allowedMetrics.join(", ")}`);
    }

    const records = await VitalRecord.find({ patient: req.user.userId }).sort({ timestamp: -1 }).limit(limit);

    const trend = [...records].reverse().map((record) => ({
      timestamp: record.timestamp,
      value: record[metric],
      spo2: record.spo2,
      hr: record.hr,
      rr: record.rr,
      apneaLevel: record.apneaLevel,
      coughEvents: record.coughEvents,
    }));

    return res.json({ success: true, metric, records: trend });
  }),
);

patientRouter.get(
  "/me/medications",
  asyncHandler(async (req, res) => {
    await ensureCurrentPatientData(req.user.userId);

    const medications = await MedicationSchedule.find({ patient: req.user.userId }).sort({ createdAt: 1 });
    return res.json({ success: true, medications });
  }),
);

patientRouter.patch(
  "/me/medications/:medicationId/taken",
  asyncHandler(async (req, res) => {
    const takenToday = Boolean(req.body.takenToday);

    const medication = await MedicationSchedule.findOneAndUpdate(
      { _id: req.params.medicationId, patient: req.user.userId },
      { takenToday },
      { new: true },
    );

    if (!medication) {
      throw new HttpError(404, "Medication not found.");
    }

    return res.json({ success: true, medication });
  }),
);

patientRouter.get(
  "/me/notifications",
  asyncHandler(async (req, res) => {
    const notifications = await Notification.find({ user: req.user.userId })
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Number(req.query.limit || 50)));

    return res.json({
      success: true,
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read).length,
    });
  }),
);

patientRouter.patch(
  "/me/notifications/:notificationId/read",
  asyncHandler(async (req, res) => {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, user: req.user.userId },
      { read: true },
      { new: true },
    );

    if (!notification) {
      throw new HttpError(404, "Notification not found.");
    }

    return res.json({ success: true, notification });
  }),
);

patientRouter.get(
  "/me/settings",
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.userId);
    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    return res.json({ success: true, settings: user.preferences });
  }),
);

patientRouter.patch(
  "/me/settings",
  asyncHandler(async (req, res) => {
    const { notifications, dataSharing, biometric, darkMode } = req.body;
    const user = await User.findById(req.user.userId);

    if (!user) {
      throw new HttpError(404, "User not found.");
    }

    user.preferences = {
      ...user.preferences,
      ...(notifications !== undefined ? { notifications: Boolean(notifications) } : {}),
      ...(dataSharing !== undefined ? { dataSharing: Boolean(dataSharing) } : {}),
      ...(biometric !== undefined ? { biometric: Boolean(biometric) } : {}),
      ...(darkMode !== undefined ? { darkMode: Boolean(darkMode) } : {}),
    };

    await user.save();

    return res.json({ success: true, settings: user.preferences });
  }),
);

patientRouter.get(
  "/me/profile",
  asyncHandler(async (req, res) => {
    const { user, profile } = await getPatientContext(req.user.userId);

    return res.json({
      success: true,
      profile: {
        user,
        patient: profile,
      },
    });
  }),
);

patientRouter.patch(
  "/me/profile",
  asyncHandler(async (req, res) => {
    const { firstName, lastName, phone, condition, emergencyContact, gender, bloodType } = req.body;
    const { user, profile } = await getPatientContext(req.user.userId);

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (phone !== undefined) user.phone = phone;

    if (condition !== undefined) profile.condition = condition;
    if (gender !== undefined) profile.gender = gender;
    if (bloodType !== undefined) profile.bloodType = bloodType;
    if (emergencyContact !== undefined) {
      profile.emergencyContact = {
        ...profile.emergencyContact,
        ...emergencyContact,
      };
    }

    await Promise.all([user.save(), profile.save()]);

    return res.json({ success: true, profile: { user, patient: profile } });
  }),
);

patientRouter.get(
  "/me/chat",
  asyncHandler(async (req, res) => {
    const messages = await ChatMessage.find({ patient: req.user.userId })
      .sort({ createdAt: 1 })
      .limit(Math.min(300, Number(req.query.limit || 100)));

    return res.json({ success: true, messages });
  }),
);

patientRouter.post(
  "/me/chat",
  asyncHandler(async (req, res) => {
    const text = String(req.body.text || "").trim();
    if (!text) {
      throw new HttpError(400, "text is required.");
    }

    const profile = await ensureCurrentPatientData(req.user.userId);

    const [userMessage] = await ChatMessage.create([
      { patient: req.user.userId, role: "user", text, source: "doctor-chat" },
    ]);

    if (profile.doctor) {
      await Notification.create({
        user: profile.doctor,
        type: "info",
        title: "New patient message",
        message: `${profile.patientCode}: ${text.slice(0, 80)}`,
        metadata: { patientCode: profile.patientCode, type: "patient-chat" },
      });
    }

    return res.status(201).json({
      success: true,
      messages: [userMessage],
    });
  }),
);

patientRouter.get(
  "/me/doctor",
  asyncHandler(async (req, res) => {
    const { profile } = await getPatientContext(req.user.userId);

    if (!profile.doctor) {
      return res.json({ success: true, doctor: null, consultations: [] });
    }

    const [doctorUser, doctorProfile, consultations] = await Promise.all([
      User.findById(profile.doctor._id || profile.doctor),
      DoctorProfile.findOne({ user: profile.doctor._id || profile.doctor }),
      Consultation.find({ patient: req.user.userId, doctor: profile.doctor._id || profile.doctor })
        .sort({ scheduledFor: 1 })
        .limit(20),
    ]);

    return res.json({
      success: true,
      doctor: {
        user: doctorUser,
        profile: doctorProfile,
      },
      consultations,
    });
  }),
);

import express from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { User } from "../models/User.js";
import { PatientProfile } from "../models/PatientProfile.js";
import { DoctorProfile } from "../models/DoctorProfile.js";
import { VitalRecord } from "../models/VitalRecord.js";
import { RiskAssessment } from "../models/RiskAssessment.js";
import { MedicationSchedule } from "../models/MedicationSchedule.js";
import { Notification } from "../models/Notification.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { Consultation } from "../models/Consultation.js";
import { buildAiInsight } from "../services/aiEngine.js";
import { validatePatientFormPayload } from "../services/patientFormSchema.js";
import { ensurePatientClinicalData } from "../services/patientDataBootstrap.js";
import { streamAiInsightPdf } from "../services/aiReportPdf.js";

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

const formatDoctorAiData = ({ profile, latestVital, latestRisk, medications = [] }) => {
  const sentResult = profile.latestDoctorSentResult || null;
  const insights = sentResult?.insights || profile.latestAiInsights || null;
  const doctorInput = sentResult?.doctorInput || insights?.doctorInput || profile.latestDoctorAiInput || null;

  return {
    patientId: profile.patientCode,
    input: doctorInput,
    insights,
    sentResult,
    latestVital,
    latestRisk,
    medications,
    updatedAt: doctorInput?.usedAt || sentResult?.sentAt || profile.updatedAt || null,
  };
};

const toFiniteNumber = (...values) => {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim().replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
};

const normalizePercent = (...values) => {
  const value = toFiniteNumber(...values);
  if (value === null) return null;
  return value <= 1 ? Number((value * 100).toFixed(2)) : Number(value.toFixed(2));
};

const latestModel2 = (record) => record?.modelInputs?.model2Spo2 || {};
const latestModel1 = (record) => record?.modelInputs?.model1Apnea || {};

const getModel2Spo2Value = (record) => {
  const model2 = latestModel2(record);
  const features = model2?.features || {};
  return toFiniteNumber(features.spo2_pct, features.spo2, record?.spo2);
};

const getModel2RespiratoryRate = (record) => {
  const model2 = latestModel2(record);
  const features = model2?.features || {};
  return toFiniteNumber(features.respiratory_rate, record?.rr);
};

const getModel2HeartRate = (record) => {
  const model2 = latestModel2(record);
  const features = model2?.features || {};
  return toFiniteNumber(features.heart_rate, record?.hr);
};

const getModel2DeteriorationPercent = (record) => {
  const model2 = latestModel2(record);
  const output = model2?.modelOutput || {};
  return normalizePercent(
    output.probabilityDeterioration,
    output.probability_deterioration,
    output.riskScore,
    output.risk_score,
  );
};

const getModel1ApneaPercent = (record) => {
  const model1 = latestModel1(record);
  const output = model1?.modelOutput || {};
  return normalizePercent(
    output.riskScore,
    output.risk_score,
    output.probability,
    output.apneaProbability,
  );
};

const buildPatientModelVitals = ({ latestVital, latestModel1Vital, latestModel2Vital }) => {
  const model2Record = latestModel2Vital || latestVital;
  const model1Record = latestModel1Vital || latestVital;

  return {
    spo2: getModel2Spo2Value(model2Record),
    respiratoryRate: getModel2RespiratoryRate(model2Record),
    heartRate: getModel2HeartRate(model2Record),
    model2DeteriorationPercent: getModel2DeteriorationPercent(model2Record),
    apneaRiskPercent: getModel1ApneaPercent(model1Record),
    model1Timestamp: latestModel1Vital?.timestamp || null,
    model2Timestamp: latestModel2Vital?.timestamp || null,
  };
};

const valueForPatientHistoryMetric = (record, metric) => {
  if (metric === "spo2") return getModel2Spo2Value(record);
  if (metric === "hr") return getModel2HeartRate(record);
  if (metric === "rr") return getModel2RespiratoryRate(record);
  if (metric === "apneaLevel" || metric === "apneaRisk") return getModel1ApneaPercent(record);
  if (metric === "model2Deterioration") return getModel2DeteriorationPercent(record);
  return toFiniteNumber(record?.[metric]);
};


patientRouter.get(
  "/me/home",
  asyncHandler(async (req, res) => {
    const { profile } = await getPatientContext(req.user.userId);

    const [
      latestVital,
      latestModel1Vital,
      latestModel2Vital,
      latestRisk,
      medications,
      unreadNotifications,
      recentVitals,
    ] = await Promise.all([
      VitalRecord.findOne({ patient: req.user.userId }).sort({ timestamp: -1 }),
      VitalRecord.findOne({
        patient: req.user.userId,
        "modelInputs.model1Apnea.enabled": true,
      }).sort({ timestamp: -1 }),
      VitalRecord.findOne({
        patient: req.user.userId,
        "modelInputs.model2Spo2.enabled": true,
      }).sort({ timestamp: -1 }),
      RiskAssessment.findOne({ patient: req.user.userId }).sort({ createdAt: -1 }),
      MedicationSchedule.find({ patient: req.user.userId }).sort({ createdAt: 1 }),
      Notification.countDocuments({ user: req.user.userId, read: false }),
      VitalRecord.find({ patient: req.user.userId }).sort({ timestamp: -1 }).limit(48),
    ]);

    const computedInsight = await buildAiInsight({
      patientId: profile.patientCode,
      latestVital,
      historyVitals: [...recentVitals].reverse(),
      patientCondition: profile.condition,
      intakeForm: profile.latestIntakeForm || null,
    });

    return res.json({
      success: true,
      home: {
        profile,
        latestVital,
        latestRisk,
        modelVitals: buildPatientModelVitals({
          latestVital,
          latestModel1Vital,
          latestModel2Vital,
        }),
        latestDoctorSentResult: profile.latestDoctorSentResult || null,
        doctorAiData: formatDoctorAiData({ profile, latestVital, latestRisk, medications }),
        medications,
        unreadNotifications,
        aiInsight: computedInsight,
      },
    });
  }),
);

patientRouter.get(
  "/me/doctor-ai-data",
  asyncHandler(async (req, res) => {
    const profile = await ensureCurrentPatientData(req.user.userId);

    const [latestVital, latestRisk, medications] = await Promise.all([
      VitalRecord.findOne({ patient: req.user.userId }).sort({ timestamp: -1 }),
      RiskAssessment.findOne({ patient: req.user.userId }).sort({ createdAt: -1 }),
      MedicationSchedule.find({ patient: req.user.userId }).sort({ createdAt: 1 }),
    ]);

    return res.json({
      success: true,
      doctorAiData: formatDoctorAiData({
        profile,
        latestVital,
        latestRisk,
        medications,
      }),
    });
  }),
);

patientRouter.get(
  "/me/doctor-ai-report/pdf",
  asyncHandler(async (req, res) => {
    const profile = await ensureCurrentPatientData(req.user.userId);
    const sentResult = profile.latestDoctorSentResult || null;
    const insight = sentResult?.insights || null;

    if (!insight) {
      throw new HttpError(404, "No doctor AI report has been shared yet.");
    }

    streamAiInsightPdf({
      res,
      profile,
      insight,
      doctorInput: sentResult?.doctorInput || insight?.doctorInput || profile.latestDoctorAiInput || null,
      sentResult,
      fileNameSuffix: "doctor-ai-report",
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
    const allowedMetrics = ["spo2", "hr", "rr", "apneaLevel", "apneaRisk", "model2Deterioration"];
    if (!allowedMetrics.includes(metric)) {
      throw new HttpError(400, `metric must be one of: ${allowedMetrics.join(", ")}`);
    }

    const records = await VitalRecord.find({ patient: req.user.userId }).sort({ timestamp: -1 }).limit(limit);

    const trend = [...records].reverse().map((record) => {
      const modelSpo2 = getModel2Spo2Value(record);
      const modelHeartRate = getModel2HeartRate(record);
      const modelRespiratoryRate = getModel2RespiratoryRate(record);
      const apneaRiskPercent = getModel1ApneaPercent(record);
      const model2DeteriorationPercent = getModel2DeteriorationPercent(record);

      return {
        timestamp: record.timestamp,
        value: valueForPatientHistoryMetric(record, metric),
        spo2: modelSpo2 ?? record.spo2,
        hr: modelHeartRate ?? record.hr,
        rr: modelRespiratoryRate ?? record.rr,
        apneaLevel: apneaRiskPercent ?? record.apneaLevel,
        modelSpo2,
        modelHeartRate,
        modelRespiratoryRate,
        apneaRiskPercent,
        model2DeteriorationPercent,
      };
    });

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

import express from "express";
import bcrypt from "bcryptjs";
import PDFDocument from "pdfkit";
import multer from "multer";
import { asyncHandler } from "../utils/asyncHandler.js";
import { HttpError } from "../utils/httpError.js";
import { authenticate, requireRole } from "../middlewares/auth.js";
import { User } from "../models/User.js";
import { PatientProfile } from "../models/PatientProfile.js";
import { VitalRecord } from "../models/VitalRecord.js";
import { RiskAssessment } from "../models/RiskAssessment.js";
import { EnvironmentSnapshot } from "../models/EnvironmentSnapshot.js";
import { Alert } from "../models/Alert.js";
import { Consultation } from "../models/Consultation.js";
import { Report } from "../models/Report.js";
import { Notification } from "../models/Notification.js";
import { MedicationSchedule } from "../models/MedicationSchedule.js";
import { ChatMessage } from "../models/ChatMessage.js";
import { resolvePatientByIdentifier } from "../services/patientResolver.js";
import { ensurePatientClinicalData } from "../services/patientDataBootstrap.js";
import { buildCompositeAiInsight, buildManualAiInsights, generateExplainableInsight } from "../services/aiEngine.js";
import { fetchGuidelinesFromAiService, runManualAiFromAiService, runSpo2CsvFromAiService } from "../services/aiGateway.js";
import { generatePatientCode } from "../services/identity.js";
import { getDefaultPatientFormData, validatePatientFormPayload } from "../services/patientFormSchema.js";

export const doctorRouter = express.Router();

doctorRouter.use(authenticate, requireRole("doctor"));

const toPatientName = (user) => `${user.firstName} ${user.lastName}`;

const toProfileStatus = (score = 0) => {
  if (score >= 75) return "critical";
  if (score >= 50) return "warning";
  if (score >= 30) return "moderate";
  return "stable";
};

const normalizeFactorSeverity = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "stable") return "low";
  if (["low", "moderate", "high", "critical"].includes(normalized)) return normalized;
  return "moderate";
};

const sanitizeRiskFactors = (factors) => {
  if (!Array.isArray(factors)) return [];
  return factors
    .filter((factor) => factor && typeof factor === "object")
    .map((factor) => ({
      key: String(factor.key || "factor").trim() || "factor",
      label: String(factor.label || factor.key || "Factor").trim() || "Factor",
      value: String(factor.value ?? "n/a"),
      severity: normalizeFactorSeverity(factor.severity),
    }));
};

const fetchLatestRisk = async (patientId) =>
  RiskAssessment.findOne({ patient: patientId }).sort({ createdAt: -1 });

const fetchLatestVital = async (patientId) =>
  VitalRecord.findOne({ patient: patientId }).sort({ timestamp: -1 });

const doctorScopedFilter = async (doctorId) => {
  const hasAssignments = await PatientProfile.exists({ doctor: doctorId });
  return hasAssignments ? { doctor: doctorId } : {};
};

const ensureAccess = (reqUserId, profile) => {
  if (profile.doctor && String(profile.doctor._id || profile.doctor) !== String(reqUserId)) {
    throw new HttpError(403, "You are not assigned to this patient.");
  }
};

const sanitizeFileName = (value) =>
  String(value || "report")
    .replace(/[^a-z0-9\-_. ]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

const MANUAL_MODEL_KEYS = {
  apnea: "cnn_bilstm_model.keras",
  spo2: "lstm_SPO2_model.keras",
  all: "all_models",
};

const manualUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 75 * 1024 * 1024,
    files: 16,
  },
});

const manualUploadMiddleware = (req, _res, next) => {
  if (!req.is("multipart/form-data")) return next();

  return manualUpload.fields([
    { name: "apn_file", maxCount: 1 },
    { name: "dat_file", maxCount: 1 },
    { name: "hea_file", maxCount: 1 },
    { name: "csv_file", maxCount: 1 },
  ])(req, _res, (error) => {
    if (error) {
      return next(new HttpError(400, error.message));
    }
    return next();
  });
};

const getUploadedFile = (req, field) => {
  const files = req.files?.[field];
  if (!Array.isArray(files) || files.length === 0) return null;
  return files[0];
};



const fileHasExtension = (file, extension) =>
  Boolean(file?.originalname && String(file.originalname).toLowerCase().endsWith(extension));

const fileSummary = (file) => {
  if (!file) return null;
  return {
    name: file.originalname || "file",
    mimetype: file.mimetype || "application/octet-stream",
    sizeBytes: Number(file.size || file.buffer?.length || 0),
  };
};

const buildDoctorAiInputSnapshot = ({
  profile,
  modelKey,
  manualInput,
  uploadedFilesForAi,
  latestVitalPayload,
  latestEnvironmentPayload,
}) => ({
  patientId: profile.patientCode,
  model: modelKey || MANUAL_MODEL_KEYS.all,
  usedAt: new Date().toISOString(),
  input: manualInput || {},
  vitalsUsed: latestVitalPayload || {},
  environmentUsed: latestEnvironmentPayload || {},
  filesUsed: {
    apn: fileSummary(uploadedFilesForAi?.apnFile),
    dat: fileSummary(uploadedFilesForAi?.datFile),
    hea: fileSummary(uploadedFilesForAi?.heaFile),
    csv: fileSummary(uploadedFilesForAi?.csvFile),
    wav: Array.isArray(uploadedFilesForAi?.wavFiles)
      ? uploadedFilesForAi.wavFiles.map((file) => fileSummary(file)).filter(Boolean)
      : [],
  },
});

const normalizeCsvColumnName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/﻿/g, "")
    .replace(/%/g, "")
    .replace(/[()]/g, "")
    .replace(/[\/\-\s]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");

const SPO2_CSV_ALIASES = {
  patient_id: "patient_id",
  patientid: "patient_id",
  patient: "patient_id",
  hour_from_admission: "hour_from_admission",
  hours_from_admission: "hour_from_admission",
  age: "age",
  gender: "gender",
  sex: "gender",
  comorbidity_index: "comorbidity_index",
  heart_rate: "heart_rate",
  heart_rate_bpm: "heart_rate",
  respiratory_rate: "respiratory_rate",
  respiratory_rate_br_min: "respiratory_rate",
  spo2: "spo2",
  spo2_pct: "spo2",
  sp_o2: "spo2",
  systolic_bp: "systolic_bp",
  systolic_bp_mmhg: "systolic_bp",
  diastolic_bp: "diastolic_bp",
  diastolic_bp_mmhg: "diastolic_bp",
  mobility_score: "mobility_score",
  lactate: "lactate",
  lactate_mmol_l: "lactate",
  hemoglobin: "hemoglobin",
  hemoglobin_g_dl: "hemoglobin",
};

const splitCsvLine = (line, delimiter) => {
  const values = [];
  let current = "";
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];

    if (char === '"' && insideQuotes && nextChar === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      insideQuotes = !insideQuotes;
    } else if (char === delimiter && !insideQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
};

const detectCsvDelimiter = (headerLine) => {
  const candidates = [",", ";", "\t"];
  return candidates
    .map((delimiter) => ({ delimiter, count: splitCsvLine(headerLine, delimiter).length }))
    .sort((a, b) => b.count - a.count)[0]?.delimiter || ",";
};

const csvNumber = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(String(value).trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const csvGenderToSex = (value, fallback = "other") => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["m", "male", "homme", "1"].includes(normalized)) return "male";
  if (["f", "female", "femme", "0"].includes(normalized)) return "female";
  return fallback || "other";
};

const buildManualInputFromSpo2Csv = (csvFile, fallback = {}) => {
  const manualInput = {
    ...fallback,
    spo2_csv_file: csvFile?.originalname || "spo2_history.csv",
  };

  try {
    const text = csvFile.buffer.toString("utf8").replace(/^﻿/, "");
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    if (lines.length < 2) return manualInput;

    const delimiter = detectCsvDelimiter(lines[0]);
    const headers = splitCsvLine(lines[0], delimiter).map((header) => {
      const normalized = normalizeCsvColumnName(header);
      return SPO2_CSV_ALIASES[normalized] || normalized;
    });

    let lastRow = null;
    for (let index = lines.length - 1; index >= 1; index -= 1) {
      const values = splitCsvLine(lines[index], delimiter);
      if (values.length > 1) {
        lastRow = {};
        headers.forEach((header, columnIndex) => {
          lastRow[header] = values[columnIndex];
        });
        break;
      }
    }

    if (!lastRow) return manualInput;

    const numericFields = [
      "hour_from_admission",
      "age",
      "comorbidity_index",
      "heart_rate",
      "respiratory_rate",
      "spo2",
      "systolic_bp",
      "diastolic_bp",
      "mobility_score",
      "lactate",
      "hemoglobin",
    ];

    numericFields.forEach((field) => {
      const value = csvNumber(lastRow[field]);
      if (value !== null) {
        if (field === "spo2") {
          manualInput.spo2 = value;
          manualInput.spo2_pct = value;
        } else {
          manualInput[field] = value;
        }
      }
    });

    if (lastRow.patient_id) manualInput.patient_id = String(lastRow.patient_id).trim();
    if (lastRow.gender) {
      manualInput.sex = csvGenderToSex(lastRow.gender, manualInput.sex);
      manualInput.gender = manualInput.sex;
    }
  } catch {
    return manualInput;
  }

  return manualInput;
};

const buildFallbackManualInput = ({ profile, latestVital, latestEnvironment }) => {
  const fallback = {
    ...getDefaultPatientFormData(),
    ...(profile?.latestIntakeForm || {}),
  };

  if (latestVital) {
    fallback.spo2 = latestVital.spo2 ?? fallback.spo2;
    fallback.heart_rate = latestVital.hr ?? fallback.heart_rate;
    fallback.respiratory_rate = latestVital.rr ?? fallback.respiratory_rate;
  }

  if (latestEnvironment) {
    fallback.air_quality_index = latestEnvironment.aqi ?? fallback.air_quality_index;
    fallback.environment_temperature = latestEnvironment.temperature ?? fallback.environment_temperature;
    fallback.humidity = latestEnvironment.humidity ?? fallback.humidity;
  }

  return fallback;
};

const keepTwoDecimals = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : value;
};

const asPlainObject = (value) => (value && typeof value.toObject === "function" ? value.toObject() : value);

const formatRiskSnapshot = (risk) => {
  if (!risk) return null;

  const plainRisk = asPlainObject(risk);
  return {
    ...plainRisk,
    score: keepTwoDecimals(plainRisk.score ?? 0),
    confidence: keepTwoDecimals(plainRisk.confidence ?? 0),
  };
};

const formatRiskCollection = (risks = []) => risks.map((risk) => formatRiskSnapshot(risk));

const formatAiInsight = (insight) => {
  if (!insight || typeof insight !== "object") return insight;

  return {
    ...insight,
    score: keepTwoDecimals(insight.score ?? 0),
    confidence: keepTwoDecimals(insight.confidence ?? 0),
  };
};

const buildFallbackInsightFromRisk = (risk) => {
  if (!risk) return null;

  const plainRisk = asPlainObject(risk);
  return formatAiInsight({
    score: plainRisk.score,
    confidence: plainRisk.confidence,
    predictedWindowMinutes: plainRisk.predictedWindowMinutes,
    factors: Array.isArray(plainRisk.factors) ? plainRisk.factors : [],
    guidelines: Array.isArray(plainRisk.guidelines) ? plainRisk.guidelines : [],
    modelOutputs: {},
    rag: {
      explanation: "No manual AI+RAG insight payload was found. Showing latest computed risk snapshot.",
      sources: [],
    },
  });
};

const resolveUploadMeta = (profile) => {
  const intakeUpdatedAt = profile?.latestIntakeForm?.updatedAt || null;
  const uploadAt = profile.latestUploadAt || intakeUpdatedAt || null;
  const uploadName = profile.latestUploadName || (uploadAt ? "Patient health form" : "");
  return { uploadAt, uploadName };
};

const summarizeReportData = ({ latestVital, alerts = [], consultations = [] }) => {
  const parts = [];

  if (latestVital) {
    parts.push(`Latest vitals: SpO₂ ${latestVital.spo2}%, HR ${latestVital.hr} bpm, RR ${latestVital.rr} br/min.`);
  }

  if (alerts.length) {
    const criticalAlerts = alerts.filter((alert) => alert.type === "critical").length;
    parts.push(`Alerts in period: ${alerts.length} total (${criticalAlerts} critical).`);
  }

  if (consultations.length) {
    parts.push(`Consultations in period: ${consultations.length}.`);
  }

  return parts.length
    ? parts.join(" ")
    : "Auto-generated report from available clinical data.";
};

doctorRouter.get(
  "/dashboard/summary",
  asyncHandler(async (req, res) => {
    const filter = await doctorScopedFilter(req.user.userId);
    const profiles = await PatientProfile.find(filter).populate("user", "firstName lastName email");
    const patientIds = profiles.map((p) => p.user._id);

    const [openAlerts, unreadNotifications, topRisks] = await Promise.all([
      Alert.countDocuments({ doctor: req.user.userId, status: { $in: ["open", "acknowledged"] } }),
      Notification.countDocuments({ user: req.user.userId, read: false }),
      RiskAssessment.find({ patient: { $in: patientIds } }).sort({ score: -1, createdAt: -1 }).limit(5),
    ]);

    const criticalPatients = profiles.filter((p) => p.status === "critical").length;

    const enrichedTopRisks = await Promise.all(
      topRisks.map(async (risk) => {
        const profile = profiles.find((p) => String(p.user._id) === String(risk.patient));
        const latestVital = await fetchLatestVital(risk.patient);

        return {
          patientId: profile?.patientCode,
          patientName: profile ? toPatientName(profile.user) : "Unknown patient",
          score: keepTwoDecimals(risk.score),
          status: risk.status,
          confidence: keepTwoDecimals(risk.confidence),
          spo2: latestVital?.spo2 ?? null,
          hr: latestVital?.hr ?? null,
        };
      }),
    );

    return res.json({
      success: true,
      summary: {
        totalPatients: profiles.length,
        criticalPatients,
        openAlerts,
        unreadNotifications,
      },
      topRisks: enrichedTopRisks,
    });
  }),
);

doctorRouter.get(
  "/patients",
  asyncHandler(async (req, res) => {
    const { search = "", status = "all" } = req.query;

    const filter = await doctorScopedFilter(req.user.userId);
    if (status !== "all") {
      filter.status = status;
    }

    const profiles = await PatientProfile.find(filter)
      .populate("user", "firstName lastName email")
      .sort({ updatedAt: -1 });

    const normalizedSearch = String(search).trim().toLowerCase();
    const filteredProfiles = !normalizedSearch
      ? profiles
      : profiles.filter((profile) => {
          const fullName = toPatientName(profile.user).toLowerCase();
          return fullName.includes(normalizedSearch) || profile.patientCode.toLowerCase().includes(normalizedSearch);
        });

    const patients = await Promise.all(
      filteredProfiles.map(async (profile) => {
        await ensurePatientClinicalData(profile);

        const { uploadAt, uploadName } = resolveUploadMeta(profile);

        const [latestVital, latestRisk] = await Promise.all([
          fetchLatestVital(profile.user._id),
          fetchLatestRisk(profile.user._id),
        ]);

        return {
          id: profile.patientCode,
          userId: profile.user._id,
          name: toPatientName(profile.user),
          email: profile.user.email,
          condition: profile.condition,
          status: profile.status,
          admittedAt: profile.admittedAt,
          latestUploadAt: uploadAt,
          latestUploadName: uploadName,
          vitals: latestVital,
          risk: formatRiskSnapshot(latestRisk),
        };
      }),
    );

    return res.json({ success: true, patients });
  }),
);

doctorRouter.post(
  "/patients",
  asyncHandler(async (req, res) => {
    const {
      firstName,
      lastName,
      email,
      phone,
      password,
      condition,
      gender,
      dob,
      status,
    } = req.body;

    if (!firstName || !lastName || !email || !email.includes("@")) {
      throw new HttpError(400, "firstName, lastName and valid email are required.");
    }

    const exists = await User.exists({ email: email.toLowerCase() });
    if (exists) {
      throw new HttpError(409, "A user with this email already exists.");
    }

    const passwordHash = await bcrypt.hash(password || "ChangeMe123!", 10);
    const user = await User.create({
      firstName,
      lastName,
      email,
      phone: phone || "",
      role: "patient",
      passwordHash,
    });

    const profile = await PatientProfile.create({
      user: user._id,
      patientCode: await generatePatientCode(),
      condition: condition || "",
      gender: gender || "",
      dob: dob || null,
      status: status || "stable",
      doctor: req.user.userId,
      admittedAt: new Date(),
    });

    await ensurePatientClinicalData(profile);

    return res.status(201).json({
      success: true,
      patient: {
        id: profile.patientCode,
        userId: user._id,
        name: `${user.firstName} ${user.lastName}`,
        email: user.email,
      },
    });
  }),
);

doctorRouter.get(
  "/patients/:patientIdentifier",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);
    await ensurePatientClinicalData(profile);

    const { uploadAt, uploadName } = resolveUploadMeta(profile);

    const [latestVital, latestEnvironment, latestRisk, medications, recentAlerts] = await Promise.all([
      fetchLatestVital(profile.user._id),
      EnvironmentSnapshot.findOne({ patient: profile.user._id }).sort({ timestamp: -1 }),
      fetchLatestRisk(profile.user._id),
      MedicationSchedule.find({ patient: profile.user._id }).sort({ createdAt: 1 }),
      Alert.find({ patient: profile.user._id }).sort({ createdAt: -1 }).limit(10),
    ]);

    return res.json({
      success: true,
      patient: {
        id: profile.patientCode,
        userId: profile.user._id,
        name: toPatientName(profile.user),
        email: profile.user.email,
        age: profile.dob ? Math.max(0, new Date().getFullYear() - new Date(profile.dob).getFullYear()) : null,
        profile,
        latestVital,
        latestEnvironment,
        latestRisk: formatRiskSnapshot(latestRisk),
        latestUploadAt: uploadAt,
        latestUploadName: uploadName,
        latestAiInsights: profile.latestAiInsights
          ? formatAiInsight(profile.latestAiInsights)
          : buildFallbackInsightFromRisk(latestRisk),
        medications,
        recentAlerts,
      },
    });
  }),
);

doctorRouter.post(
  "/patients/:patientIdentifier/upload",
  asyncHandler(async (req, res) => {
    const { fileName = "dataset.json", content = "" } = req.body;

    if (!String(content).trim()) {
      throw new HttpError(400, "content is required.");
    }

    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);
    await ensurePatientClinicalData(profile);

    let parsedUpload = null;
    try {
      parsedUpload = JSON.parse(content);
    } catch {
      parsedUpload = { rawText: String(content).slice(0, 8000) };
    }

    profile.latestUploadAt = new Date();
    profile.latestUploadName = String(fileName || "dataset.json");
    profile.latestUploadData = parsedUpload;
    await profile.save();

    return res.json({
      success: true,
      upload: {
        fileName: profile.latestUploadName,
        uploadedAt: profile.latestUploadAt,
      },
    });
  }),
);

doctorRouter.get(
  "/patients/:patientIdentifier/ai-insights",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);
    await ensurePatientClinicalData(profile);

    const { uploadAt, uploadName } = resolveUploadMeta(profile);
    const latestRisk = await fetchLatestRisk(profile.user._id);

    const insights = profile.latestAiInsights
      ? formatAiInsight(profile.latestAiInsights)
      : buildFallbackInsightFromRisk(latestRisk);

    return res.json({
      success: true,
      patient: {
        id: profile.patientCode,
        latestUploadAt: uploadAt,
        latestUploadName: uploadName,
      },
      insights,
    });
  }),
);

doctorRouter.get(
  "/patients/:patientIdentifier/vitals",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);
    await ensurePatientClinicalData(profile);

    const limit = Math.min(200, Number(req.query.limit || 24));
    const records = await VitalRecord.find({ patient: profile.user._id }).sort({ timestamp: -1 }).limit(limit);

    return res.json({
      success: true,
      records,
      trend: [...records].reverse(),
    });
  }),
);

doctorRouter.get(
  "/patients/:patientIdentifier/environment",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);
    await ensurePatientClinicalData(profile);

    const snapshots = await EnvironmentSnapshot.find({ patient: profile.user._id })
      .sort({ timestamp: -1 })
      .limit(Math.min(200, Number(req.query.limit || 24)));

    return res.json({ success: true, snapshots, trend: [...snapshots].reverse() });
  }),
);

doctorRouter.get(
  "/patients/:patientIdentifier/risk-history",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);
    await ensurePatientClinicalData(profile);

    const history = await RiskAssessment.find({ patient: profile.user._id })
      .sort({ createdAt: -1 })
      .limit(Math.min(200, Number(req.query.limit || 24)));

    const formattedHistory = formatRiskCollection(history);

    return res.json({ success: true, history: formattedHistory, trend: [...formattedHistory].reverse() });
  }),
);

doctorRouter.post(
  "/patients/:patientIdentifier/risk/validate",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);

    let latestRisk = await fetchLatestRisk(profile.user._id);
    const intakeForm = profile.latestIntakeForm || null;

    if (!latestRisk) {
      const [latestVital, latestEnvironment] = await Promise.all([
        fetchLatestVital(profile.user._id),
        EnvironmentSnapshot.findOne({ patient: profile.user._id }).sort({ timestamp: -1 }),
      ]);
      const historyVitals = await VitalRecord.find({ patient: profile.user._id }).sort({ timestamp: -1 }).limit(48);
      const ragInsight = await generateExplainableInsight({
        patientId: profile.patientCode,
        latestVital,
        historyVitals: [...historyVitals].reverse(),
        latestEnvironment,
        intakeForm,
      });

      const insight = await buildCompositeAiInsight({
        patientId: profile.patientCode,
        latestVital,
        historyVitals: [...historyVitals].reverse(),
        latestEnvironment,
        patientCondition: profile.condition,
        ragInsight,
        intakeForm,
      });

      latestRisk = await RiskAssessment.create({
        patient: profile.user._id,
        score: keepTwoDecimals(insight.score),
        confidence: keepTwoDecimals(insight.confidence),
        predictedWindowMinutes: insight.predictedWindowMinutes,
        factors: insight.factors,
        guidelines: insight.guidelines,
      });
    }

    latestRisk.status = "validated";
    latestRisk.validatedBy = req.user.userId;
    latestRisk.validatedAt = new Date();
    await latestRisk.save();

    await Notification.create({
      user: profile.user._id,
      type: "warning",
      title: "Clinical intervention validated",
      message: "Your care team validated an intervention protocol based on current risk signals.",
      metadata: { riskId: latestRisk._id },
    });

    return res.json({ success: true, risk: formatRiskSnapshot(latestRisk) });
  }),
);

doctorRouter.post(
  "/patients/:patientIdentifier/risk/dismiss",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);

    let latestRisk = await fetchLatestRisk(profile.user._id);

    if (!latestRisk) {
      throw new HttpError(404, "No risk alert found for this patient.");
    }

    latestRisk.status = "dismissed";
    latestRisk.dismissedBy = req.user.userId;
    latestRisk.dismissedAt = new Date();
    await latestRisk.save();

    return res.json({ success: true, risk: formatRiskSnapshot(latestRisk) });
  }),
);

doctorRouter.get(
  "/patient-chats",
  asyncHandler(async (req, res) => {
    const filter = await doctorScopedFilter(req.user.userId);
    const profiles = await PatientProfile.find(filter).populate("user", "firstName lastName");

    const chats = await Promise.all(profiles.map(async (profile) => {
      const [lastMessage, unread] = await Promise.all([
        ChatMessage.findOne({ patient: profile.user._id }).sort({ createdAt: -1 }),
        Notification.countDocuments({
          user: req.user.userId,
          read: false,
          "metadata.patientCode": profile.patientCode,
          "metadata.type": "patient-chat",
        }),
      ]);

      return {
        patientId: profile.patientCode,
        patientName: toPatientName(profile.user),
        unread,
        lastMessage: lastMessage
          ? {
              text: lastMessage.text,
              from: lastMessage.role,
              createdAt: lastMessage.createdAt,
            }
          : null,
      };
    }));

    return res.json({ success: true, chats });
  }),
);

doctorRouter.get(
  "/patient-chats/:patientIdentifier/messages",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);

    const messages = await ChatMessage.find({ patient: profile.user._id })
      .sort({ createdAt: 1 })
      .limit(Math.min(500, Number(req.query.limit || 150)));

    return res.json({ success: true, messages });
  }),
);

doctorRouter.post(
  "/patient-chats/:patientIdentifier/messages",
  asyncHandler(async (req, res) => {
    const text = String(req.body.text || "").trim();
    if (!text) {
      throw new HttpError(400, "text is required.");
    }

    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);

    const [message] = await ChatMessage.create([
      { patient: profile.user._id, role: "doctor", text, source: "doctor-chat" },
    ]);

    await Notification.create({
      user: profile.user._id,
      type: "info",
      title: "New message from your doctor",
      message: text.slice(0, 120),
      metadata: { type: "doctor-chat", patientCode: profile.patientCode },
    });

    return res.status(201).json({ success: true, message });
  }),
);

doctorRouter.post(
  "/patients/:patientIdentifier/ai-insights/manual",
  manualUploadMiddleware,
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);

    const requestedModel = String(req.query.model || req.body?.model || "").trim();
    const supportedModels = Object.values(MANUAL_MODEL_KEYS);
    const modelKey = supportedModels.includes(requestedModel) ? requestedModel : "";

    let manualInput = null;
    let uploadedFilesForAi = { wavFiles: [] };

    if (!modelKey) {
      const validation = validatePatientFormPayload(req.body || {}, { requireAll: true });
      if (!validation.isValid) {
        throw new HttpError(400, "Invalid manual AI input payload.", validation.errors);
      }
      manualInput = validation.data;
    } else {
      const [latestVital, latestEnvironment] = await Promise.all([
        fetchLatestVital(profile.user._id),
        EnvironmentSnapshot.findOne({ patient: profile.user._id }).sort({ timestamp: -1 }),
      ]);
      const fallbackManualInput = buildFallbackManualInput({ profile, latestVital, latestEnvironment });

      if (modelKey === MANUAL_MODEL_KEYS.spo2) {
        const csvFile = getUploadedFile(req, "csv_file");
        const errors = {};

        if (!csvFile) errors.csv_file = "Missing .csv file.";
        else if (!fileHasExtension(csvFile, ".csv")) errors.csv_file = "Expected .csv file.";

        if (Object.keys(errors).length > 0) {
          throw new HttpError(400, "Invalid LSTM SpO2 CSV file.", errors);
        }

        manualInput = buildManualInputFromSpo2Csv(csvFile, fallbackManualInput);
        uploadedFilesForAi = { csvFile, wavFiles: [] };
      } else if (modelKey === MANUAL_MODEL_KEYS.apnea) {
        const apnFile = getUploadedFile(req, "apn_file");
        const datFile = getUploadedFile(req, "dat_file");
        const heaFile = getUploadedFile(req, "hea_file");
        const errors = {};

        if (!apnFile) errors.apn_file = "Missing .apn file.";
        else if (!fileHasExtension(apnFile, ".apn")) errors.apn_file = "Expected .apn file.";

        if (!datFile) errors.dat_file = "Missing .dat file.";
        else if (!fileHasExtension(datFile, ".dat")) errors.dat_file = "Expected .dat file.";

        if (!heaFile) errors.hea_file = "Missing .hea file.";
        else if (!fileHasExtension(heaFile, ".hea")) errors.hea_file = "Expected .hea file.";

        if (Object.keys(errors).length > 0) {
          throw new HttpError(400, "Invalid apnea model files.", errors);
        }

        manualInput = {
          ...fallbackManualInput,
          apnea_files: {
            apn: apnFile.originalname,
            dat: datFile.originalname,
            hea: heaFile.originalname,
          },
        };
        uploadedFilesForAi = { apnFile, datFile, heaFile, wavFiles: [] };
      } else if (modelKey === MANUAL_MODEL_KEYS.all) {
        const apnFile = getUploadedFile(req, "apn_file");
        const datFile = getUploadedFile(req, "dat_file");
        const heaFile = getUploadedFile(req, "hea_file");
        const csvFile = getUploadedFile(req, "csv_file");
        const errors = {};

        if (!apnFile) errors.apn_file = "Missing .apn file.";
        else if (!fileHasExtension(apnFile, ".apn")) errors.apn_file = "Expected .apn file.";

        if (!datFile) errors.dat_file = "Missing .dat file.";
        else if (!fileHasExtension(datFile, ".dat")) errors.dat_file = "Expected .dat file.";

        if (!heaFile) errors.hea_file = "Missing .hea file.";
        else if (!fileHasExtension(heaFile, ".hea")) errors.hea_file = "Expected .hea file.";

        if (!csvFile) errors.csv_file = "Missing .csv file.";
        else if (!fileHasExtension(csvFile, ".csv")) errors.csv_file = "Expected .csv file.";

        if (Object.keys(errors).length > 0) {
          throw new HttpError(400, "Invalid multi-model payload.", errors);
        }

        manualInput = {
          ...buildManualInputFromSpo2Csv(csvFile, fallbackManualInput),
          apnea_files: {
            apn: apnFile.originalname,
            dat: datFile.originalname,
            hea: heaFile.originalname,
          },
        };
        uploadedFilesForAi = { apnFile, datFile, heaFile, csvFile, wavFiles: [] };
      }
    }

    const symptomScore = [
      manualInput.cough,
      manualInput.shortness_of_breath,
      manualInput.wheezing,
      manualInput.chest_pain,
      manualInput.fatigue,
    ].filter(Boolean).length;
    const estimatedApneaLevel = Math.min(10, symptomScore * 2 + (manualInput.shortness_of_breath ? 2 : 0));
    const estimatedCoughEvents = manualInput.cough ? 8 : 0;

    const latestVitalPayload = {
      spo2: Number(manualInput.spo2 ?? 98),
      rr: Number(manualInput.respiratory_rate ?? 16),
      hr: Number(manualInput.heart_rate ?? 72),
      coughEvents: estimatedCoughEvents,
      wheezeDetected: Boolean(manualInput.wheezing),
      apneaLevel: estimatedApneaLevel,
    };
    const latestEnvironmentPayload = {
      aqi: Number(manualInput.air_quality_index ?? 80),
      temperature: Number(manualInput.environment_temperature ?? 22),
      humidity: Number(manualInput.humidity ?? 60),
    };

    let ragInsight = null;
    try {
      if (modelKey === MANUAL_MODEL_KEYS.spo2) {
        ragInsight = await runSpo2CsvFromAiService({
          csvFile: uploadedFilesForAi.csvFile,
          topKGuidelines: 4,
        });
      } else {
        ragInsight = await runManualAiFromAiService({
          modelKey: modelKey || MANUAL_MODEL_KEYS.all,
          patientId: profile.patientCode,
          latestVital: latestVitalPayload,
          historyVitals: [],
          latestEnvironment: latestEnvironmentPayload,
          intakeForm: manualInput,
          uploadedFiles: uploadedFilesForAi,
        });
      }
    } catch {
      ragInsight = await generateExplainableInsight({
        patientId: profile.patientCode,
        latestVital: latestVitalPayload,
        historyVitals: [],
        latestEnvironment: latestEnvironmentPayload,
        intakeForm: manualInput,
      });
    }

    if (!ragInsight?.models || !ragInsight?.fusion) {
      throw new HttpError(
        503,
        "AI service unavailable or incomplete response. Start ai-service and retry Run AI + RAG.",
      );
    }

    const doctorAiInputSnapshot = buildDoctorAiInputSnapshot({
      profile,
      modelKey,
      manualInput,
      uploadedFilesForAi,
      latestVitalPayload,
      latestEnvironmentPayload,
    });

    const insights = formatAiInsight({
      ...buildManualAiInsights({ input: manualInput, ragInsight }),
      doctorInput: doctorAiInputSnapshot,
    });
    const safeScore = Math.max(0, Math.min(100, Number(insights?.score ?? 0)));
    const safeConfidence = Math.max(0, Math.min(100, Number(insights?.confidence ?? 0)));
    const safeFactors = sanitizeRiskFactors(insights?.factors);

    const riskRecord = await RiskAssessment.create({
      patient: profile.user._id,
      score: safeScore,
      confidence: safeConfidence,
      predictedWindowMinutes: Number(insights?.predictedWindowMinutes ?? 240),
      factors: safeFactors,
      guidelines: Array.isArray(insights?.guidelines) ? insights.guidelines : [],
      status: "active",
    });

    profile.latestAiInsights = insights;
    profile.latestDoctorAiInput = doctorAiInputSnapshot;
    profile.status = toProfileStatus(safeScore);
    await profile.save();

    return res.json({ success: true, insights, risk: formatRiskSnapshot(riskRecord) });
  }),
);

doctorRouter.post(
  "/patients/:patientIdentifier/ai-insights/send-to-patient",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);

    const latestRisk = await fetchLatestRisk(profile.user._id);
    const insightsPayload = profile.latestAiInsights
      ? formatAiInsight(profile.latestAiInsights)
      : buildFallbackInsightFromRisk(latestRisk);

    if (!insightsPayload) {
      throw new HttpError(400, "No AI insights available to send. Please run AI + RAG first.");
    }

    const normalizedInsightsPayload = formatAiInsight(insightsPayload);

    const sentAt = new Date();
    const sentScore = Math.max(0, Math.min(100, Number(normalizedInsightsPayload?.score ?? latestRisk?.score ?? 0)));
    const sentConfidence = Math.max(0, Math.min(100, Number(normalizedInsightsPayload?.confidence ?? latestRisk?.confidence ?? 0)));

    profile.latestDoctorSentResult = {
      score: sentScore,
      confidence: sentConfidence,
      sentAt,
      patientCode: profile.patientCode,
      source: "doctor-ai-results",
      insights: normalizedInsightsPayload,
      doctorInput: profile.latestDoctorAiInput || normalizedInsightsPayload?.doctorInput || null,
    };

    profile.doctorRiskHistory = [
      {
        score: sentScore,
        confidence: sentConfidence,
        sentAt,
        source: "doctor-ai-results",
      },
      ...(Array.isArray(profile.doctorRiskHistory) ? profile.doctorRiskHistory : []),
    ].slice(0, 100);

    await profile.save();

    const duplicateWindowStart = new Date(Date.now() - 15 * 60 * 1000);
    const existingPatientResultNotification = await Notification.findOne({
      user: profile.user._id,
      "metadata.type": "doctor-ai-results",
      "metadata.patientCode": profile.patientCode,
      "metadata.score": sentScore,
      "metadata.confidence": sentConfidence,
      createdAt: { $gte: duplicateWindowStart },
    }).sort({ createdAt: -1 });

    if (!existingPatientResultNotification) {
      await Notification.create({
        user: profile.user._id,
        type: "info",
        title: "New AI results from your doctor",
        message: `Your doctor shared updated AI insights for ${profile.patientCode} (${sentScore}% global risk).`,
        metadata: {
          type: "doctor-ai-results",
          patientCode: profile.patientCode,
          score: sentScore,
          confidence: sentConfidence,
          sentAt,
          insights: normalizedInsightsPayload,
          doctorInput: profile.latestDoctorAiInput || normalizedInsightsPayload?.doctorInput || null,
        },
      });
    }

    await Notification.create({
      user: req.user.userId,
      type: "success",
      title: "AI results sent",
      message: `AI insights sent to ${profile.patientCode}.`,
      metadata: { type: "doctor-ai-results-sent", patientCode: profile.patientCode },
    });

    return res.json({
      success: true,
      sent: {
        score: sentScore,
        confidence: sentConfidence,
        sentAt,
      },
    });
  }),
);

doctorRouter.get(
  "/patients/:patientIdentifier/intake-form/pdf",
  asyncHandler(async (req, res) => {
    const profile = await resolvePatientByIdentifier(req.params.patientIdentifier);
    ensureAccess(req.user.userId, profile);

    const intake = profile.latestIntakeForm;
    if (!intake) {
      throw new HttpError(404, "No patient form found yet.");
    }

    const doc = new PDFDocument({ margin: 50 });
    const fileName = `${sanitizeFileName(`${profile.patientCode}-patient-form`)}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);

    doc.pipe(res);
    doc.fontSize(18).text(`Patient Form — ${profile.patientCode}`);
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#333");

    const pairs = Object.entries(intake).filter(([key]) => key !== "updatedAt");
    for (const [key, value] of pairs) {
      const valueText = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
      doc.text(`${key}: ${valueText}`);
    }

    if (intake.updatedAt) {
      doc.moveDown();
      doc.text(`Updated At: ${new Date(intake.updatedAt).toLocaleString("en-GB")}`);
    }

    doc.end();
  }),
);

doctorRouter.get(
  "/consultations",
  asyncHandler(async (req, res) => {
    const filter = { doctor: req.user.userId };
    if (req.query.status) {
      filter.status = req.query.status;
    }

    const consultations = await Consultation.find(filter)
      .populate("patient", "firstName lastName")
      .sort({ scheduledFor: 1 });

    return res.json({ success: true, consultations });
  }),
);

doctorRouter.post(
  "/consultations",
  asyncHandler(async (req, res) => {
    const { patientIdentifier, scheduledFor, type, status, channel } = req.body;

    if (!patientIdentifier || !scheduledFor) {
      throw new HttpError(400, "patientIdentifier and scheduledFor are required.");
    }

    const profile = await resolvePatientByIdentifier(patientIdentifier);
    ensureAccess(req.user.userId, profile);

    const consultation = await Consultation.create({
      patient: profile.user._id,
      doctor: req.user.userId,
      scheduledFor,
      type: type || "Follow-up",
      status: status || "scheduled",
      channel: channel || "video",
      notes: [{ from: "ai", text: "Ready to assist with consultations. Select a patient to begin." }],
    });

    return res.status(201).json({ success: true, consultation });
  }),
);

doctorRouter.post(
  "/consultations/:consultationId/notes",
  asyncHandler(async (req, res) => {
    const { text } = req.body;
    if (!text?.trim()) {
      throw new HttpError(400, "text is required.");
    }

    const consultation = await Consultation.findOne({
      _id: req.params.consultationId,
      doctor: req.user.userId,
    });

    if (!consultation) {
      throw new HttpError(404, "Consultation not found.");
    }

    consultation.notes.push({ from: "doctor", text: text.trim() });
    await consultation.save();

    return res.json({ success: true, consultation });
  }),
);

doctorRouter.get(
  "/reports",
  asyncHandler(async (req, res) => {
    const reports = await Report.find({ doctor: req.user.userId })
      .populate("patient", "firstName lastName")
      .sort({ generatedAt: -1 });

    return res.json({
      success: true,
      reports: reports.map((report) => ({
        _id: report._id,
        title: report.title,
        type: report.type,
        status: report.status,
        summary: report.summary,
        fileUrl: report.fileUrl,
        generatedAt: report.generatedAt,
        patient: report.patient,
      })),
    });
  }),
);

doctorRouter.post(
  "/reports/generate",
  asyncHandler(async (req, res) => {
    const {
      type = "Daily",
      title,
      patientIdentifier,
      summary,
      periodStart,
      periodEnd,
      includeVitals = true,
      includeAlerts = true,
      includeConsultations = true,
      notes = "",
    } = req.body;

    let patientId;
    let profile;
    if (patientIdentifier) {
      profile = await resolvePatientByIdentifier(patientIdentifier);
      ensureAccess(req.user.userId, profile);
      patientId = profile.user._id;
    }

    const dateStart = periodStart ? new Date(periodStart) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dateEnd = periodEnd ? new Date(periodEnd) : new Date();

    const [latestVital, alerts, consultations] = await Promise.all([
      includeVitals && patientId ? fetchLatestVital(patientId) : Promise.resolve(null),
      includeAlerts
        ? Alert.find({
            doctor: req.user.userId,
            ...(patientId ? { patient: patientId } : {}),
            createdAt: { $gte: dateStart, $lte: dateEnd },
          })
        : Promise.resolve([]),
      includeConsultations
        ? Consultation.find({
            doctor: req.user.userId,
            ...(patientId ? { patient: patientId } : {}),
            scheduledFor: { $gte: dateStart, $lte: dateEnd },
          })
        : Promise.resolve([]),
    ]);

    const autoSummary = summarizeReportData({ latestVital, alerts, consultations });
    const finalSummary = summary?.trim() ? summary.trim() : autoSummary;
    const defaultTitle = patientIdentifier && profile
      ? `${type} Report — ${toPatientName(profile.user)}`
      : `${type} Clinical Report — ${new Date().toLocaleDateString("en-GB")}`;

    const report = await Report.create({
      doctor: req.user.userId,
      patient: patientId,
      type,
      title: title || defaultTitle,
      summary: finalSummary,
      status: "ready",
      periodStart: dateStart,
      periodEnd: dateEnd,
      includeVitals: Boolean(includeVitals),
      includeAlerts: Boolean(includeAlerts),
      includeConsultations: Boolean(includeConsultations),
      notes,
      generatedAt: new Date(),
    });

    return res.status(201).json({ success: true, report });
  }),
);

doctorRouter.get(
  "/reports/:reportId",
  asyncHandler(async (req, res) => {
    const report = await Report.findOne({ _id: req.params.reportId, doctor: req.user.userId })
      .populate("patient", "firstName lastName email");

    if (!report) {
      throw new HttpError(404, "Report not found.");
    }

    let latestVital = null;
    let alertItems = [];
    let consultationItems = [];

    if (report.patient) {
      const periodFilter = {
        $gte: report.periodStart || new Date(Date.now() - 24 * 60 * 60 * 1000),
        $lte: report.periodEnd || new Date(),
      };

      [latestVital, alertItems, consultationItems] = await Promise.all([
        report.includeVitals ? fetchLatestVital(report.patient._id) : Promise.resolve(null),
        report.includeAlerts
          ? Alert.find({
              doctor: req.user.userId,
              patient: report.patient._id,
              createdAt: periodFilter,
            }).sort({ createdAt: -1 }).limit(12)
          : Promise.resolve([]),
        report.includeConsultations
          ? Consultation.find({
              doctor: req.user.userId,
              patient: report.patient._id,
              scheduledFor: periodFilter,
            }).sort({ scheduledFor: -1 }).limit(12)
          : Promise.resolve([]),
      ]);
    }

    return res.json({
      success: true,
      report: {
        _id: report._id,
        title: report.title,
        type: report.type,
        status: report.status,
        summary: report.summary,
        notes: report.notes,
        generatedAt: report.generatedAt,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
        includeVitals: report.includeVitals,
        includeAlerts: report.includeAlerts,
        includeConsultations: report.includeConsultations,
        patient: report.patient,
        latestVital,
        alerts: alertItems,
        consultations: consultationItems,
      },
    });
  }),
);

doctorRouter.get(
  "/reports/:reportId/pdf",
  asyncHandler(async (req, res) => {
    const report = await Report.findOne({ _id: req.params.reportId, doctor: req.user.userId })
      .populate("patient", "firstName lastName email");

    if (!report) {
      throw new HttpError(404, "Report not found.");
    }

    let latestVital = null;
    let alertItems = [];
    let consultationItems = [];

    if (report.patient) {
      const periodFilter = {
        $gte: report.periodStart || new Date(Date.now() - 24 * 60 * 60 * 1000),
        $lte: report.periodEnd || new Date(),
      };

      [latestVital, alertItems, consultationItems] = await Promise.all([
        report.includeVitals ? fetchLatestVital(report.patient._id) : Promise.resolve(null),
        report.includeAlerts
          ? Alert.find({ doctor: req.user.userId, patient: report.patient._id, createdAt: periodFilter }).sort({ createdAt: -1 }).limit(12)
          : Promise.resolve([]),
        report.includeConsultations
          ? Consultation.find({ doctor: req.user.userId, patient: report.patient._id, scheduledFor: periodFilter }).sort({ scheduledFor: -1 }).limit(12)
          : Promise.resolve([]),
      ]);
    }

    const doc = new PDFDocument({ margin: 50 });
    const fileName = `${sanitizeFileName(report.title || "report")}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);

    doc.pipe(res);

    doc.fontSize(18).text(report.title, { align: "left" });
    doc.moveDown(0.5);
    doc.fontSize(11).fillColor("#555").text(`Type: ${report.type}`);
    doc.text(`Generated: ${new Date(report.generatedAt).toLocaleString("en-GB")}`);
    if (report.patient) {
      doc.text(`Patient: ${report.patient.firstName} ${report.patient.lastName}`);
    }
    if (report.periodStart || report.periodEnd) {
      doc.text(`Period: ${report.periodStart ? new Date(report.periodStart).toLocaleDateString("en-GB") : "--"} → ${report.periodEnd ? new Date(report.periodEnd).toLocaleDateString("en-GB") : "--"}`);
    }

    doc.moveDown();
    doc.fillColor("#111").fontSize(13).text("Summary");
    doc.fontSize(11).fillColor("#333").text(report.summary || "No summary.");

    if (report.notes) {
      doc.moveDown();
      doc.fillColor("#111").fontSize(13).text("Clinical Notes");
      doc.fontSize(11).fillColor("#333").text(report.notes);
    }

    if (latestVital) {
      doc.moveDown();
      doc.fillColor("#111").fontSize(13).text("Latest Vitals");
      doc.fontSize(11).fillColor("#333").text(`SpO₂: ${latestVital.spo2}%`);
      doc.text(`Heart Rate: ${latestVital.hr} bpm`);
      doc.text(`Respiratory Rate: ${latestVital.rr} br/min`);
      if (typeof latestVital.apneaLevel === "number") doc.text(`Apnea Level: ${latestVital.apneaLevel}/10`);
    }

    if (alertItems.length) {
      doc.moveDown();
      doc.fillColor("#111").fontSize(13).text("Alerts");
      doc.fontSize(11).fillColor("#333");
      alertItems.forEach((alert, index) => {
        doc.text(`${index + 1}. [${alert.type.toUpperCase()}] ${alert.message}`);
      });
    }

    if (consultationItems.length) {
      doc.moveDown();
      doc.fillColor("#111").fontSize(13).text("Consultations");
      doc.fontSize(11).fillColor("#333");
      consultationItems.forEach((consultation, index) => {
        doc.text(`${index + 1}. ${consultation.type} — ${new Date(consultation.scheduledFor).toLocaleString("en-GB")} (${consultation.status})`);
      });
    }

    doc.end();
  }),
);

doctorRouter.get(
  "/notifications",
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

doctorRouter.patch(
  "/notifications/read-all",
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ user: req.user.userId, read: false }, { $set: { read: true } });
    return res.json({ success: true });
  }),
);

doctorRouter.patch(
  "/notifications/:notificationId/read",
  asyncHandler(async (req, res) => {
    const updated = await Notification.findOneAndUpdate(
      { _id: req.params.notificationId, user: req.user.userId },
      { read: true },
      { new: true },
    );

    if (!updated) {
      throw new HttpError(404, "Notification not found.");
    }

    return res.json({ success: true, notification: updated });
  }),
);

doctorRouter.get(
  "/analytics/weekly",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);

    const [alerts, resolvedAlerts, filter] = await Promise.all([
      Alert.find({ doctor: req.user.userId, createdAt: { $gte: startDate } }),
      Alert.countDocuments({ doctor: req.user.userId, status: "resolved", updatedAt: { $gte: startDate } }),
      doctorScopedFilter(req.user.userId),
    ]);

    const profiles = await PatientProfile.find(filter).populate("user", "firstName lastName");
    const riskDistribution = await Promise.all(
      profiles.map(async (profile) => {
        const risk = await fetchLatestRisk(profile.user._id);
        return {
          patientId: profile.patientCode,
          patientName: toPatientName(profile.user),
          status: profile.status,
          score: keepTwoDecimals(risk?.score ?? 0),
        };
      }),
    );

    const weekMap = new Map();
    for (let i = 0; i < 7; i += 1) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const key = date.toLocaleDateString("en-GB", { weekday: "short" });
      weekMap.set(key, { day: key, alerts: 0, resolved: 0 });
    }

    alerts.forEach((alert) => {
      const key = new Date(alert.createdAt).toLocaleDateString("en-GB", { weekday: "short" });
      if (weekMap.has(key)) {
        weekMap.get(key).alerts += 1;
      }
    });

    const weeklyOverview = Array.from(weekMap.values());
    if (weeklyOverview.length) {
      weeklyOverview[weeklyOverview.length - 1].resolved = resolvedAlerts;
    }

    return res.json({
      success: true,
      metrics: {
        totalAlerts: alerts.length,
        criticalEvents: alerts.filter((alert) => alert.type === "critical").length,
        resolved: resolvedAlerts,
      },
      weeklyOverview,
      riskDistribution,
    });
  }),
);

doctorRouter.get(
  "/knowledge-base",
  asyncHandler(async (_req, res) => {
    try {
      const sources = await fetchGuidelinesFromAiService({ limit: 24 });
      if (Array.isArray(sources) && sources.length > 0) {
        return res.json({
          success: true,
          sources: sources.map((item, index) => ({
            badge: item.source || `SRC-${index + 1}`,
            reference: item.reference || "Guideline",
            text: item.text || item.snippet || "",
            relevance: Math.max(0, Math.min(100, Math.round((item.relevance || 0.8) * 100))),
          })),
        });
      }
    } catch {
      // fallback below
    }

    return res.json({
      success: true,
      sources: [
        {
          badge: "WHO",
          reference: "WHO Respiratory Care",
          text: "Rapid triage and close oxygen/respiratory monitoring are recommended for acute respiratory deterioration.",
          relevance: 97,
        },
        {
          badge: "GINA",
          reference: "GINA 2024",
          text: "Declining SpO₂ with persistent cough/wheeze indicates elevated short-term exacerbation risk.",
          relevance: 94,
        },
        {
          badge: "GOLD",
          reference: "GOLD 2024",
          text: "Sustained desaturation and increased respiratory effort are key indicators of worsening COPD status.",
          relevance: 91,
        },
      ],
    });
  }),
);

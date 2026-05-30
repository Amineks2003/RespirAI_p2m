import { VitalRecord } from "../models/VitalRecord.js";
import { RiskAssessment } from "../models/RiskAssessment.js";
import { MedicationSchedule } from "../models/MedicationSchedule.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const hoursAgo = (hours) => new Date(Date.now() - hours * 60 * 60 * 1000);
const REFRESH_VITALS_MINUTES = 20;

const hashString = (value) => {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
};

const getStatusDefaults = (status) => {
  if (status === "critical") {
    return { spo2: 87, hr: 104, rr: 24, apneaLevel: 8, risk: 86 };
  }

  if (status === "warning") {
    return { spo2: 92, hr: 92, rr: 20, apneaLevel: 6, risk: 64 };
  }

  if (status === "moderate") {
    return { spo2: 95, hr: 80, rr: 17, apneaLevel: 3, risk: 43 };
  }

  return { spo2: 98, hr: 70, rr: 14, apneaLevel: 1, risk: 22 };
};

const getMedicationTemplate = (seed) => {
  const templates = [
    [
      { name: "Salbutamol Inhaler", dose: "2 puffs when needed", time: "As required", icon: "💨", takenToday: true },
      { name: "Fluticasone (ICS)", dose: "1 puff", time: "08:00", icon: "🫁", takenToday: true },
      { name: "Montelukast 10mg", dose: "1 tablet", time: "20:00", icon: "💊", takenToday: false },
    ],
    [
      { name: "Budesonide/Formoterol", dose: "2 inhalations", time: "07:00", icon: "🌬️", takenToday: true },
      { name: "Tiotropium", dose: "1 inhalation", time: "09:00", icon: "🫁", takenToday: true },
      { name: "Prednisone", dose: "10 mg", time: "21:00", icon: "💊", takenToday: false },
    ],
    [
      { name: "Albuterol", dose: "2 puffs PRN", time: "As required", icon: "💨", takenToday: true },
      { name: "Beclometasone", dose: "1 puff", time: "08:30", icon: "🫁", takenToday: true },
      { name: "Cetirizine", dose: "10 mg", time: "19:30", icon: "💊", takenToday: true },
    ],
  ];

  return templates[seed % templates.length];
};

const buildVitalRecords = (patientId, defaults, seed) => {
  return Array.from({ length: 24 }).map((_, index) => {
    const trend = defaults.risk >= 80
      ? -Math.floor(index / 8)
      : defaults.risk >= 55
        ? -Math.floor(index / 12)
        : Math.floor(index / 16);

    const variability = ((index + seed) % 3) - 1;
    const apneaShift = (((index + seed) % 4) - 1.5) * 0.5;

    return {
      patient: patientId,
      spo2: clamp(defaults.spo2 + trend + variability + ((seed % 5) - 2), 82, 100),
      hr: clamp(defaults.hr + ((index + seed) % 5) - 2 + ((seed % 9) - 4), 52, 145),
      rr: clamp(defaults.rr + ((index + seed) % 4) - 1 + ((seed % 5) - 2), 10, 40),
      apneaLevel: Number(clamp(defaults.apneaLevel + apneaShift + (defaults.risk >= 80 ? 1 : 0), 0, 10).toFixed(1)),
      source: "wearable",
      timestamp: hoursAgo(24 - index),
    };
  });
};

const buildRiskHistory = (patientId, defaults, seed) => {
  return Array.from({ length: 10 }).map((_, index) => {
    const trend = defaults.risk >= 80
      ? index * 1.1
      : defaults.risk >= 55
        ? index * 0.7
        : -index * 0.4;

    const score = clamp(defaults.risk - 6 + trend + ((index + seed) % 4), 5, 99);
    const spo2Estimate = clamp(Math.round(defaults.spo2 - (9 - index) * 0.4), 82, 100);
    const apneaEstimate = Number(clamp(defaults.apneaLevel + (index % 3) - 1, 0, 10).toFixed(1));

    return {
      patient: patientId,
      score,
      confidence: clamp(76 + index + (seed % 10), 65, 99),
      predictedWindowMinutes: defaults.risk >= 80 ? 120 : defaults.risk >= 55 ? 240 : 420,
      factors: [
        {
          key: "spo2",
          label: "SpO₂ Trend",
          value: `${spo2Estimate}%`,
          severity: score > 75 ? "critical" : score > 55 ? "high" : "moderate",
        },
        {
          key: "apnea",
          label: "Apnea Level",
          value: `${apneaEstimate}/10`,
          severity: score > 70 ? "high" : "moderate",
        },
      ],
      guidelines: ["GINA 2024", "WHO", "GOLD", "ATS"],
      status: index === 9 ? "active" : "validated",
      createdAt: hoursAgo(10 - index),
      updatedAt: hoursAgo(10 - index),
    };
  });
};

const buildLiveVitalRecord = ({ patientId, latestVital, defaults, seed, status }) => {
  const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
  const oscillation = ((bucket + seed) % 7) - 3;
  const statusBias = status === "critical" ? -1.2 : status === "warning" ? -0.6 : status === "stable" ? 0.4 : 0;

  const previousSpo2 = Number(latestVital?.spo2 ?? defaults.spo2);
  const previousHr = Number(latestVital?.hr ?? defaults.hr);
  const previousRr = Number(latestVital?.rr ?? defaults.rr);
  const previousApnea = Number(latestVital?.apneaLevel ?? defaults.apneaLevel);

  const spo2 = clamp(previousSpo2 + oscillation * 0.35 + statusBias, 82, 100);
  const hr = clamp(previousHr + oscillation * 1.1 + (status === "critical" ? 1.4 : 0.4), 52, 145);
  const rr = clamp(previousRr + oscillation * 0.5 + (status === "critical" ? 0.8 : 0.2), 10, 40);
  const apneaLevel = Number(clamp(previousApnea + oscillation * 0.12 + (status === "critical" ? 0.2 : 0), 0, 10).toFixed(1));

  return {
    patient: patientId,
    spo2,
    hr,
    rr,
    apneaLevel,
    coughEvents: Number(latestVital?.coughEvents ?? 0),
    wheezeDetected: Boolean(latestVital?.wheezeDetected ?? false),
    source: "simulation-live",
    timestamp: new Date(),
    // Keep the latest AI model input snapshot attached to the newest vital record.
    // Without this, the dashboard would lose Model 1 / Model 2 context after live refresh.
    modelInputs: latestVital?.modelInputs || {},
  };
};

export const ensurePatientClinicalData = async (profile) => {
  const patientId = profile?.user?._id || profile?.user;
  if (!patientId) {
    return { created: false, resources: [] };
  }

  const seed = hashString(`${profile.patientCode || patientId}|${profile.condition || ""}|${profile.status || "stable"}`);
  const defaults = getStatusDefaults(profile.status || "stable");

  const [vitalCount, riskCount, medicationCount] = await Promise.all([
    VitalRecord.countDocuments({ patient: patientId }),
    RiskAssessment.countDocuments({ patient: patientId }),
    MedicationSchedule.countDocuments({ patient: patientId }),
  ]);

  const writes = [];
  const createdResources = [];

  if (vitalCount === 0) {
    writes.push(VitalRecord.insertMany(buildVitalRecords(patientId, defaults, seed)));
    createdResources.push("vitals");
  }

  if (riskCount === 0) {
    writes.push(RiskAssessment.insertMany(buildRiskHistory(patientId, defaults, seed)));
    createdResources.push("risk-history");
  }

  if (medicationCount === 0) {
    writes.push(MedicationSchedule.insertMany(getMedicationTemplate(seed).map((medication) => ({ patient: patientId, ...medication }))));
    createdResources.push("medications");
  }

  if (writes.length) {
    await Promise.all(writes);
  }

  const latestVital = await VitalRecord.findOne({ patient: patientId }).sort({ timestamp: -1 });

  const refreshWrites = [];
  const now = Date.now();
  const latestVitalTime = latestVital?.timestamp ? new Date(latestVital.timestamp).getTime() : 0;
  if (!latestVital || now - latestVitalTime >= REFRESH_VITALS_MINUTES * 60 * 1000) {
    refreshWrites.push(
      VitalRecord.create(
        buildLiveVitalRecord({
          patientId,
          latestVital,
          defaults,
          seed,
          status: profile.status || "stable",
        }),
      ),
    );
    createdResources.push("vitals-refresh");
  }

  if (refreshWrites.length) {
    await Promise.all(refreshWrites);
  }

  return {
    created: writes.length > 0,
    resources: createdResources,
  };
};

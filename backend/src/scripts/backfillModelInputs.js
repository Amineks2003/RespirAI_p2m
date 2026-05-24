import "dotenv/config";
import mongoose from "mongoose";

import "../models/User.js";

import { PatientProfile } from "../models/PatientProfile.js";
import { VitalRecord } from "../models/VitalRecord.js";
import { RiskAssessment } from "../models/RiskAssessment.js";

const connectToMongo = async () => {
  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URI ||
    process.env.DATABASE_URL;

  if (!mongoUri) {
    throw new Error(
      "MongoDB URI missing. Please define MONGODB_URI or MONGO_URI in backend/.env",
    );
  }

  await mongoose.connect(mongoUri);
  console.log("MongoDB connected for model input backfill.");
};

const hashString = (value) => {
  let hash = 0;
  for (const char of String(value || "")) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const deterministicNumber = (seed, min, max, decimals = 1) => {
  const x = Math.sin(seed) * 10000;
  const ratio = x - Math.floor(x);
  return Number((min + ratio * (max - min)).toFixed(decimals));
};

const deterministicInt = (seed, min, max) => {
  return Math.floor(deterministicNumber(seed, min, max + 0.9999, 0));
};

const computeAgeFromDob = (dob) => {
  if (!dob) return null;

  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();

  const birthdayPassed =
    today.getMonth() > birthDate.getMonth() ||
    (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());

  if (!birthdayPassed) age -= 1;

  return Math.max(0, age);
};

const dateOfBirthFromAge = (age, seed) => {
  const year = new Date().getFullYear() - age;
  const month = deterministicInt(seed + 10, 0, 11);
  const day = deterministicInt(seed + 11, 1, 26);
  return new Date(year, month, day);
};

const normalizeGender = (value, seed) => {
  const normalized = String(value || "").trim().toLowerCase();

  if (["m", "male", "homme", "1"].includes(normalized)) return "male";
  if (["f", "female", "femme", "0"].includes(normalized)) return "female";

  return seed % 2 === 0 ? "male" : "female";
};

const toCsvGender = (value) => {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "male") return "M";
  if (normalized === "female") return "F";
  return "Other";
};

const riskLabelFromScore = (score) => {
  if (score >= 75) return "critical";
  if (score >= 50) return "high";
  if (score >= 30) return "moderate";
  return "low";
};

const profileConditionIsRespiratory = (profile) => {
  const condition = String(profile?.condition || "").toLowerCase();
  return (
    condition.includes("asthma") ||
    condition.includes("copd") ||
    condition.includes("bronch") ||
    condition.includes("pulmonary") ||
    condition.includes("respiratory") ||
    condition.includes("apnea")
  );
};

const buildBaseValues = (profile, latestVital, seed) => {
  const isRespiratory = profileConditionIsRespiratory(profile);
  const status = String(profile?.status || "stable").toLowerCase();

  const statusRisk =
    status === "critical" ? 85 :
    status === "warning" ? 62 :
    status === "moderate" ? 42 :
    18;

  const spo2Fallback = isRespiratory
    ? deterministicNumber(seed + 1, 88, 96, 1)
    : deterministicNumber(seed + 1, 95, 99, 1);

  const rrFallback = isRespiratory
    ? deterministicNumber(seed + 2, 20, 34, 1)
    : deterministicNumber(seed + 2, 14, 21, 1);

  const hrFallback = rrFallback >= 25
    ? deterministicNumber(seed + 3, 92, 124, 1)
    : deterministicNumber(seed + 3, 68, 95, 1);

  const spo2 = Number(latestVital?.modelInputs?.model2Spo2?.features?.spo2_pct ?? latestVital?.spo2 ?? spo2Fallback);
  const rr = Number(latestVital?.modelInputs?.model2Spo2?.features?.respiratory_rate ?? latestVital?.rr ?? rrFallback);
  const hr = Number(latestVital?.modelInputs?.model2Spo2?.features?.heart_rate ?? latestVital?.hr ?? hrFallback);

  let risk = statusRisk;
  if (spo2 < 94) risk += (94 - spo2) * 4;
  if (rr > 22) risk += (rr - 22) * 2.5;
  if (hr > 100) risk += (hr - 100) * 0.8;
  risk = clamp(Number(risk.toFixed(1)), 4, 98);

  return {
    spo2: clamp(spo2, 82, 100),
    rr: clamp(rr, 10, 45),
    hr: clamp(hr, 45, 150),
    systolicBp: deterministicInt(seed + 4, 105, 145),
    diastolicBp: deterministicInt(seed + 5, 65, 95),
    mobilityScore: deterministicInt(seed + 6, 2, 9),
    lactate: risk >= 50 ? deterministicNumber(seed + 7, 1.8, 4.4, 1) : deterministicNumber(seed + 7, 0.8, 1.8, 1),
    hemoglobin: deterministicNumber(seed + 8, 11.5, 15.5, 1),
    comorbidityIndex: isRespiratory ? deterministicInt(seed + 9, 2, 8) : deterministicInt(seed + 9, 0, 4),
    coughEvents: isRespiratory ? deterministicInt(seed + 12, 2, 14) : deterministicInt(seed + 12, 0, 3),
    wheezeDetected: isRespiratory && deterministicInt(seed + 13, 0, 1) === 1,
    apneaRisk: clamp(risk + deterministicNumber(seed + 14, -8, 8, 1), 2, 99),
    deteriorationRisk: clamp(risk + deterministicNumber(seed + 15, -10, 10, 1), 1, 99),
  };
};

const buildModel2Spo2 = ({ profile, age, gender, values, seed }) => {
  const risk = Number(values.deteriorationRisk.toFixed(2));

  return {
    enabled: true,
    modelName: "lstm_SPO2_model.keras",
    source: "generated-backfill-csv",
    patient_id: profile.patientCode,
    csvFile: {
      name: `${profile.patientCode}_spo2_history.csv`,
      mimetype: "text/csv",
      sizeBytes: deterministicInt(seed + 20, 5000, 90000),
    },
    rowsUsed: deterministicInt(seed + 21, 24, 72),
    lastHourFromAdmission: deterministicInt(seed + 22, 24, 240),
    features: {
      patient_id: profile.patientCode,
      hour_from_admission: deterministicInt(seed + 22, 24, 240),
      heart_rate: values.hr,
      respiratory_rate: values.rr,
      spo2_pct: values.spo2,
      systolic_bp: values.systolicBp,
      diastolic_bp: values.diastolicBp,
      mobility_score: values.mobilityScore,
      lactate: values.lactate,
      hemoglobin: values.hemoglobin,
      age,
      gender: toCsvGender(gender),
      comorbidity_index: values.comorbidityIndex,
      deterioration_next_12h: risk >= 50 ? 1 : 0,
    },
    modelOutput: {
      probabilityDeterioration: Number((risk / 100).toFixed(4)),
      prediction: risk >= 50 ? 1 : 0,
      riskLabel: riskLabelFromScore(risk),
      status: risk >= 50 ? "Risque de détérioration" : "Pas de détérioration détectée",
      riskScore: risk,
      confidence: 90,
    },
  };
};

const buildModel1Apnea = ({ profile, values, seed }) => {
  const risk = Number(values.apneaRisk.toFixed(2));
  const hasApnea = risk >= 50;

  return {
    enabled: true,
    modelName: "cnn_bilstm_model.keras",
    source: "generated-backfill-wfdb",
    patientId: profile.patientCode,
    files: {
      apn: {
        name: "a01.apn",
        mimetype: "application/octet-stream",
        sizeBytes: deterministicInt(seed + 30, 1000, 20000),
      },
      dat: {
        name: "a01.dat",
        mimetype: "application/octet-stream",
        sizeBytes: deterministicInt(seed + 31, 200000, 5000000),
      },
      hea: {
        name: "a01.hea",
        mimetype: "application/octet-stream",
        sizeBytes: deterministicInt(seed + 32, 500, 5000),
      },
    },
    signalMetadata: {
      recordName: "a01",
      signalSamples: 6000,
      windowsAnalyzed: deterministicInt(seed + 33, 20, 80),
      trueApneaWindows: hasApnea ? deterministicInt(seed + 34, 8, 35) : deterministicInt(seed + 34, 0, 5),
      predictedApneaWindows: hasApnea ? deterministicInt(seed + 35, 8, 35) : deterministicInt(seed + 35, 0, 5),
    },
    clinicalContext: {
      apneaLevel: Number((risk / 10).toFixed(1)),
      spo2: values.spo2,
      respiratoryRate: values.rr,
      heartRate: values.hr,
      coughEvents: values.coughEvents,
      wheezeDetected: values.wheezeDetected,
    },
    modelOutput: {
      apneaLabel: hasApnea ? "apnea" : "no_apnea",
      hasApnea,
      riskScore: risk,
      confidence: 90,
      details: `Generated Model 1 apnea input snapshot for ${profile.patientCode}.`,
    },
  };
};

const buildAiInsights = ({ profile, modelInputs }) => {
  const apneaRisk = Number(modelInputs.model1Apnea.modelOutput.riskScore || 0);
  const spo2Risk = Number(modelInputs.model2Spo2.modelOutput.riskScore || 0);
  const score = Math.max(apneaRisk, spo2Risk);
  const label = riskLabelFromScore(score);

  return {
    score,
    confidence: 90,
    predictedWindowMinutes: score >= 75 ? 120 : score >= 50 ? 240 : 720,
    factors: [
      {
        key: "spo2_lstm_csv",
        label: "LSTM SpO2 deterioration",
        value: `${spo2Risk}% predicted deterioration risk`,
        severity: riskLabelFromScore(spo2Risk),
      },
      {
        key: "apnea",
        label: "CNN-BiLSTM Apnea Model",
        value: `${apneaRisk}% apnea-related risk`,
        severity: riskLabelFromScore(apneaRisk),
      },
    ],
    guidelines: [],
    modelOutputs: {
      spo2: modelInputs.model2Spo2.modelOutput,
      apnea: modelInputs.model1Apnea.modelOutput,
    },
    rag: {
      summary: `Generated patient-linked model input snapshots for ${profile.patientCode}. Model 2 chart now uses CSV SpO2, and Model 1 chart now uses CNN-BiLSTM apnea percentage.`,
      sources: [],
    },
    modelUsed: "all_models",
    riskLabel: label,
  };
};

const backfill = async () => {
  await connectToMongo();

  const profiles = await PatientProfile.find({}).populate("user");
  console.log(`Found ${profiles.length} patient profiles.`);

  for (const profile of profiles) {
    const patientId = profile?.user?._id || profile?.user;
    if (!patientId) continue;

    const seed = hashString(`${profile.patientCode}|${profile.condition}|${profile.user?.email || ""}`);

    const latestVital = await VitalRecord.findOne({ patient: patientId }).sort({ timestamp: -1 });

    const gender = normalizeGender(profile.gender, seed);
    const existingAge = computeAgeFromDob(profile.dob);
    const age = existingAge ?? deterministicInt(seed + 40, 35, 82);

    if (!profile.gender) profile.gender = gender;
    if (!profile.dob) profile.dob = dateOfBirthFromAge(age, seed);

    const values = buildBaseValues(profile, latestVital, seed);

    const modelInputs = {
      model1Apnea: buildModel1Apnea({ profile, values, seed }),
      model2Spo2: buildModel2Spo2({ profile, age, gender, values, seed }),
    };

    await VitalRecord.create({
      patient: patientId,
      timestamp: new Date(),
      spo2: modelInputs.model2Spo2.features.spo2_pct,
      hr: modelInputs.model2Spo2.features.heart_rate,
      rr: modelInputs.model2Spo2.features.respiratory_rate,
      temperature: deterministicNumber(seed + 41, 36.3, 38.2, 1),
      apneaLevel: Number((modelInputs.model1Apnea.modelOutput.riskScore / 10).toFixed(1)),
      coughEvents: values.coughEvents,
      wheezeDetected: values.wheezeDetected,
      aqi: deterministicInt(seed + 42, 45, 160),
      roomTemperature: deterministicNumber(seed + 43, 20, 28, 1),
      humidity: deterministicInt(seed + 44, 35, 75),
      source: "generated-model-input-backfill",
      modelInputs,
    });

    const insights = buildAiInsights({ profile, modelInputs });
    const score = Number(insights.score || 0);

    await RiskAssessment.create({
      patient: patientId,
      score,
      confidence: 90,
      predictedWindowMinutes: insights.predictedWindowMinutes,
      factors: insights.factors,
      guidelines: [],
      status: "active",
    });

    const doctorInput = {
      patientId: profile.patientCode,
      model: "all_models",
      usedAt: new Date().toISOString(),
      input: {
        ...modelInputs.model2Spo2.features,
        spo2: modelInputs.model2Spo2.features.spo2_pct,
      },
      vitalsUsed: {
        spo2: modelInputs.model2Spo2.features.spo2_pct,
        rr: modelInputs.model2Spo2.features.respiratory_rate,
        hr: modelInputs.model2Spo2.features.heart_rate,
        apneaRiskPercent: modelInputs.model1Apnea.modelOutput.riskScore,
      },
      filesUsed: {
        csv: modelInputs.model2Spo2.csvFile,
        apn: modelInputs.model1Apnea.files.apn,
        dat: modelInputs.model1Apnea.files.dat,
        hea: modelInputs.model1Apnea.files.hea,
      },
      modelInputs,
    };

    profile.latestAiInsights = {
      ...insights,
      doctorInput,
    };
    profile.latestDoctorAiInput = doctorInput;
    profile.latestDoctorSentResult = {
      score,
      confidence: 90,
      sentAt: new Date(),
      patientCode: profile.patientCode,
      source: "generated-model-input-backfill",
      insights: profile.latestAiInsights,
      doctorInput,
    };
    profile.status =
      score >= 75
        ? "critical"
        : score >= 50
          ? "warning"
          : score >= 30
            ? "moderate"
            : "stable";

    profile.doctorRiskHistory = [
      {
        score,
        confidence: 90,
        sentAt: new Date(),
        source: "generated-model-input-backfill",
      },
      ...(Array.isArray(profile.doctorRiskHistory) ? profile.doctorRiskHistory : []),
    ].slice(0, 100);

    await profile.save();

    console.log(
      `Updated ${profile.patientCode}: SpO2=${modelInputs.model2Spo2.features.spo2_pct}% | Apnea=${modelInputs.model1Apnea.modelOutput.riskScore}% | age=${age} | gender=${gender}`,
    );
  }

  console.log("Model input backfill completed successfully.");
  await mongoose.disconnect();
};

backfill().catch(async (error) => {
  console.error("Model input backfill failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});

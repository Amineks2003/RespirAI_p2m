import { explainRiskFromAiService, predictRiskFromAiService } from "./aiGateway.js";

const DEFAULT_INTAKE_FORM = {
  age: 45,
  sex: "other",
  height_cm: 170,
  weight_kg: 70,
  smoking_status: "non_smoker",
  spo2: 96,
  heart_rate: 80,
  respiratory_rate: 18,
  temperature: 37,
  cough: false,
  shortness_of_breath: false,
  wheezing: false,
  chest_pain: false,
  fatigue: false,
  asthma: false,
  copd: false,
  hypertension: false,
  diabetes: false,
  heart_disease: false,
  air_quality_index: 60,
  environment_temperature: 24,
  humidity: 50,
};

const classifyRiskStatus = (score) => {
  if (score >= 75) return "critical";
  if (score >= 50) return "warning";
  if (score >= 30) return "moderate";
  return "stable";
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const statusFromPercent = (value) => {
  if (value >= 75) return "critical";
  if (value >= 50) return "warning";
  if (value >= 30) return "moderate";
  return "stable";
};

const statusFromAiLabel = (label) => {
  const normalized = String(label || "").trim().toLowerCase();
  if (normalized === "critical") return "critical";
  if (normalized === "high") return "warning";
  if (normalized === "moderate") return "moderate";
  if (normalized === "stable" || normalized === "low") return "stable";
  return "moderate";
};

const toPercentFromRisk = (value) => clamp(Math.round(Number(value ?? 0) * 1000) / 10, 0, 100);

const normalizeRagSources = (sources = []) => (
  (Array.isArray(sources) ? sources : []).map((source, index) => ({
    badge: String(source?.source || `SRC-${index + 1}`),
    text: String(source?.snippet || source?.text || "Clinical source snippet unavailable."),
    reference: String(source?.reference || source?.source || "Clinical guideline"),
    relevance: clamp(Math.round(Number(source?.relevance ?? 0.6) * 100), 1, 100),
  }))
);

const toNumber = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const firstNumber = (...values) => {
  for (const value of values) {
    const numericValue = toNumber(value);
    if (numericValue !== null) {
      return numericValue;
    }
  }
  return null;
};

const toBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }
  return null;
};

const firstBoolean = (...values) => {
  for (const value of values) {
    const boolValue = toBoolean(value);
    if (boolValue !== null) {
      return boolValue;
    }
  }
  return null;
};

const normalizeSex = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["male", "female", "other"].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_INTAKE_FORM.sex;
};

const normalizeSmokingStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (["non_smoker", "former_smoker", "current_smoker"].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_INTAKE_FORM.smoking_status;
};

const normalizeIntakeForm = (
  input = {},
  {
    latestVital = {},
    latestEnvironment = {},
  } = {},
) => {
  const fallbackCoughEvents = firstNumber(
    input?.cough_events_per_hour,
    input?.coughEvents,
    latestVital?.coughEvents,
    latestVital?.cough_events_per_hour,
    0,
  );

  const spo2 = clamp(
    firstNumber(input?.spo2, latestVital?.spo2, DEFAULT_INTAKE_FORM.spo2) ?? DEFAULT_INTAKE_FORM.spo2,
    70,
    100,
  );
  const heartRate = clamp(
    firstNumber(
      input?.heart_rate,
      input?.hr,
      latestVital?.heart_rate,
      latestVital?.hr,
      DEFAULT_INTAKE_FORM.heart_rate,
    ) ?? DEFAULT_INTAKE_FORM.heart_rate,
    20,
    220,
  );
  const respiratoryRate = clamp(
    firstNumber(
      input?.respiratory_rate,
      input?.rr,
      latestVital?.respiratory_rate,
      latestVital?.rr,
      DEFAULT_INTAKE_FORM.respiratory_rate,
    ) ?? DEFAULT_INTAKE_FORM.respiratory_rate,
    5,
    80,
  );
  const bodyTemperature = clamp(
    firstNumber(input?.temperature, latestVital?.temperature, DEFAULT_INTAKE_FORM.temperature)
      ?? DEFAULT_INTAKE_FORM.temperature,
    30,
    45,
  );

  const environmentTemperature = clamp(
    firstNumber(
      input?.environment_temperature,
      latestEnvironment?.environment_temperature,
      latestEnvironment?.temperature,
      DEFAULT_INTAKE_FORM.environment_temperature,
    ) ?? DEFAULT_INTAKE_FORM.environment_temperature,
    -30,
    60,
  );

  const normalized = {
    age: clamp(
      Math.round(firstNumber(input?.age, DEFAULT_INTAKE_FORM.age) ?? DEFAULT_INTAKE_FORM.age),
      1,
      120,
    ),
    sex: normalizeSex(input?.sex),
    height_cm: clamp(
      firstNumber(input?.height_cm, DEFAULT_INTAKE_FORM.height_cm) ?? DEFAULT_INTAKE_FORM.height_cm,
      90,
      260,
    ),
    weight_kg: clamp(
      firstNumber(input?.weight_kg, DEFAULT_INTAKE_FORM.weight_kg) ?? DEFAULT_INTAKE_FORM.weight_kg,
      20,
      350,
    ),
    smoking_status: normalizeSmokingStatus(input?.smoking_status),
    spo2,
    heart_rate: heartRate,
    respiratory_rate: respiratoryRate,
    temperature: bodyTemperature,
    cough: firstBoolean(
      input?.cough,
      fallbackCoughEvents !== null ? fallbackCoughEvents > 0 : null,
      false,
    ) ?? false,
    shortness_of_breath: firstBoolean(
      input?.shortness_of_breath,
      respiratoryRate >= 22,
      false,
    ) ?? false,
    wheezing: firstBoolean(
      input?.wheezing,
      input?.wheeze_detected,
      input?.wheezeDetected,
      latestVital?.wheezeDetected,
      false,
    ) ?? false,
    chest_pain: firstBoolean(input?.chest_pain, false) ?? false,
    fatigue: firstBoolean(input?.fatigue, false) ?? false,
    asthma: firstBoolean(input?.asthma, false) ?? false,
    copd: firstBoolean(input?.copd, false) ?? false,
    hypertension: firstBoolean(input?.hypertension, false) ?? false,
    diabetes: firstBoolean(input?.diabetes, false) ?? false,
    heart_disease: firstBoolean(input?.heart_disease, false) ?? false,
    air_quality_index: clamp(
      firstNumber(
        input?.air_quality_index,
        input?.aqi,
        latestEnvironment?.air_quality_index,
        latestEnvironment?.aqi,
        DEFAULT_INTAKE_FORM.air_quality_index,
      ) ?? DEFAULT_INTAKE_FORM.air_quality_index,
      0,
      500,
    ),
    environment_temperature: environmentTemperature,
    humidity: clamp(
      firstNumber(input?.humidity, latestEnvironment?.humidity, DEFAULT_INTAKE_FORM.humidity)
        ?? DEFAULT_INTAKE_FORM.humidity,
      0,
      100,
    ),
  };

  const bmi = normalized.weight_kg / Math.max(0.25, (normalized.height_cm / 100) ** 2);
  const symptomCount = [
    normalized.cough,
    normalized.shortness_of_breath,
    normalized.wheezing,
    normalized.chest_pain,
    normalized.fatigue,
  ].filter(Boolean).length;
  const chronicConditionCount = [
    normalized.asthma,
    normalized.copd,
    normalized.hypertension,
    normalized.diabetes,
    normalized.heart_disease,
  ].filter(Boolean).length;

  const stressIndicator = clamp(
    Math.round(
      (
        Math.max(0, normalized.heart_rate - 72) * 0.8
        + Math.max(0, normalized.respiratory_rate - 18) * 1.8
        + Math.max(0, 96 - normalized.spo2) * 3.5
        + (normalized.shortness_of_breath ? 10 : 0)
        + (normalized.chest_pain ? 8 : 0)
      ),
    ),
    0,
    100,
  );

  return {
    ...normalized,
    bmi: Math.round(bmi * 100) / 100,
    symptom_count: symptomCount,
    chronic_condition_count: chronicConditionCount,
    stress_indicator: stressIndicator,
  };
};

const buildModelOutputsFromSignals = (signals) => {
  const spo2Risk = clamp((94 - signals.spo2) * 8, 0, 100);
  const heartRisk = clamp(Math.abs(signals.heart_rate - 78) * 1.4, 0, 100);
  const rrRisk = clamp(Math.abs(signals.respiratory_rate - 16) * 4.5, 0, 100);
  const temperatureRisk = clamp(Math.abs(signals.temperature - 37) * 40, 0, 100);
  const vitalsRisk = clamp(Math.round(0.45 * spo2Risk + 0.25 * heartRisk + 0.2 * rrRisk + 0.1 * temperatureRisk), 0, 100);

  const symptomLoad = (signals.symptom_count / 5) * 65;
  const symptomsRisk = clamp(
    Math.round(
      symptomLoad
      + (signals.wheezing ? 12 : 0)
      + (signals.shortness_of_breath ? 15 : 0)
      + (signals.chest_pain ? 10 : 0),
    ),
    0,
    100,
  );

  const smokingPenalty = signals.smoking_status === "current_smoker"
    ? 20
    : signals.smoking_status === "former_smoker"
      ? 10
      : 0;
  const bmiPenalty = signals.bmi >= 30 ? Math.min(20, (signals.bmi - 30) * 2) : signals.bmi < 18.5 ? 8 : 0;
  const agePenalty = signals.age >= 70 ? 14 : signals.age >= 60 ? 10 : signals.age >= 50 ? 6 : 0;
  const historyRisk = clamp(
    Math.round(signals.chronic_condition_count * 14 + smokingPenalty + bmiPenalty + agePenalty),
    0,
    100,
  );

  const aqiRisk = clamp((signals.air_quality_index - 50) * 0.45, 0, 100);
  const envTemperatureRisk = clamp(Math.abs(signals.environment_temperature - 24) * 4, 0, 100);
  const humidityRisk = clamp(Math.abs(signals.humidity - 50) * 1.8, 0, 100);
  const environmentRisk = clamp(
    Math.round(0.6 * aqiRisk + 0.2 * envTemperatureRisk + 0.2 * humidityRisk),
    0,
    100,
  );

  return {
    vitalsModel: {
      label: "Vitals Model",
      score: vitalsRisk,
      status: statusFromPercent(vitalsRisk),
      details: `SpO2 ${signals.spo2}% · HR ${signals.heart_rate} bpm · RR ${signals.respiratory_rate} br/min · Temp ${signals.temperature}C`,
    },
    symptomsModel: {
      label: "Symptoms Model",
      score: symptomsRisk,
      status: statusFromPercent(symptomsRisk),
      details: `${signals.symptom_count}/5 key symptoms · wheezing ${signals.wheezing ? "yes" : "no"} · dyspnea ${signals.shortness_of_breath ? "yes" : "no"}`,
    },
    historyModel: {
      label: "History Model",
      score: historyRisk,
      status: statusFromPercent(historyRisk),
      details: `BMI ${signals.bmi.toFixed(1)} · ${signals.chronic_condition_count} chronic factors · smoking ${signals.smoking_status}`,
    },
    environmentModel: {
      label: "Environment Model",
      score: environmentRisk,
      status: statusFromPercent(environmentRisk),
      details: `AQI ${signals.air_quality_index} · Env Temp ${signals.environment_temperature}C · Humidity ${signals.humidity}%`,
    },
  };
};

const buildWeightedScore = (modelOutputs) => {
  const vitals = Number(modelOutputs?.vitalsModel?.score ?? 0);
  const symptoms = Number(modelOutputs?.symptomsModel?.score ?? 0);
  const history = Number(modelOutputs?.historyModel?.score ?? 0);
  const environment = Number(modelOutputs?.environmentModel?.score ?? 0);
  return clamp(Math.round(0.35 * vitals + 0.25 * symptoms + 0.2 * history + 0.2 * environment), 0, 100);
};

const buildFactorsFromSignals = (signals, score) => {
  const severity = score >= 75 ? "critical" : score >= 50 ? "high" : score >= 30 ? "moderate" : "low";
  const factors = [];

  if (signals.spo2 < 94) {
    factors.push({
      key: "spo2",
      label: "Oxygen Saturation",
      value: `${signals.spo2}%`,
      severity,
    });
  }

  if (signals.respiratory_rate >= 22 || signals.shortness_of_breath) {
    factors.push({
      key: "respiratory",
      label: "Respiratory Stress",
      value: `RR ${signals.respiratory_rate} br/min`,
      severity,
    });
  }

  if (signals.symptom_count >= 2) {
    factors.push({
      key: "symptoms",
      label: "Symptom Burden",
      value: `${signals.symptom_count}/5 reported symptoms`,
      severity,
    });
  }

  if (signals.chronic_condition_count > 0 || signals.smoking_status !== "non_smoker") {
    factors.push({
      key: "history",
      label: "Medical History",
      value: `${signals.chronic_condition_count} chronic factors · smoking ${signals.smoking_status}`,
      severity,
    });
  }

  if (signals.air_quality_index > 100) {
    factors.push({
      key: "environment",
      label: "Environmental Exposure",
      value: `AQI ${signals.air_quality_index}`,
      severity,
    });
  }

  if (!factors.length) {
    factors.push({
      key: "overall",
      label: "Overall Stability",
      value: "No dominant destabilizing factor detected.",
      severity: "low",
    });
  }

  return factors;
};

const buildModelOutputsFromAiService = (models = {}) => {
  const finalModelSources = [
    {
      key: "spo2Model",
      source: models?.spo2 || null,
      label: "LSTM SpO2 Model",
      fallbackDetails: (source) =>
        `SpO2 ${Number(source?.spo2_level ?? source?.spo2 ?? 98)}% | RR ${Number(source?.respiration_rate ?? source?.respiratory_rate ?? 16)} | HR ${Number(source?.heart_rate ?? 72)}`,
    },
    {
      key: "apneaModel",
      source: models?.apnea || null,
      label: "CNN-BiLSTM Apnea Model",
      fallbackDetails: (source) =>
        `Apnea level ${Number(source?.apnea_level ?? 0).toFixed(1)}/10 | SpO2 ${Number(source?.spo2 ?? 98)}% | RR ${Number(source?.respiration_rate ?? source?.respiratory_rate ?? 16)}`,
    },
    {
      key: "respiratoryModel",
      source: models?.respiratory || null,
      label: "Respiratory Sound Model",
      fallbackDetails: (source) =>
        `${Number(source?.symptom_count ?? 0)} symptoms | wheezing ${source?.wheezing ? "yes" : "no"} | cough ${Number(source?.cough_frequency_per_hour ?? 0)}/hr`,
    },
  ];

  if (finalModelSources.some((item) => item.source && typeof item.source === "object")) {
    return finalModelSources.reduce((outputs, item) => {
      if (!item.source || typeof item.source !== "object") return outputs;

      const score = toPercentFromRisk(item.source.risk_score);
      outputs[item.key] = {
        label: String(item.source.label || item.label),
        score,
        status: statusFromPercent(score),
        details: String(item.source.details || item.fallbackDetails(item.source)),
      };
      return outputs;
    }, {});
  }

  const vitalsSource = models?.vitals || {};
  const symptomsSource = models?.symptoms || models?.audio || {};
  const historySource = models?.history || models?.apnea || {};
  const environmentSource = models?.environment || {};

  const vitalsRisk = toPercentFromRisk(vitalsSource?.risk_score);
  const symptomsRisk = toPercentFromRisk(symptomsSource?.risk_score);
  const historyRisk = toPercentFromRisk(historySource?.risk_score);
  const environmentRisk = toPercentFromRisk(environmentSource?.risk_score);

  const patterns = Array.isArray(vitalsSource?.abnormal_patterns)
    ? vitalsSource.abnormal_patterns
    : [];

  return {
    vitalsModel: {
      label: "Vitals Model",
      score: vitalsRisk,
      status: statusFromPercent(vitalsRisk),
      details: `SpO2 ${Number(vitalsSource?.spo2_level ?? vitalsSource?.spo2 ?? 98)}% · RR ${Number(vitalsSource?.respiration_rate ?? vitalsSource?.respiratory_rate ?? 16)} · HR ${Number(vitalsSource?.heart_rate ?? 72)}${patterns.length ? ` · ${patterns.join(", ")}` : ""}`,
    },
    symptomsModel: {
      label: "Symptoms Model",
      score: symptomsRisk,
      status: statusFromPercent(symptomsRisk),
      details: `${Number(symptomsSource?.symptom_count ?? 0)} symptoms · wheezing ${(symptomsSource?.wheezing ?? symptomsSource?.wheezing_detected) ? "yes" : "no"} · cough ${(symptomsSource?.cough ?? Number(symptomsSource?.cough_frequency_per_hour ?? 0) > 0) ? "yes" : "no"}`,
    },
    historyModel: {
      label: "History Model",
      score: historyRisk,
      status: statusFromPercent(historyRisk),
      details: `BMI ${Number(historySource?.bmi ?? 0).toFixed(1)} · smoking ${String(historySource?.smoking_status || "non_smoker")} · chronic ${Number(historySource?.chronic_condition_count ?? 0)}`,
    },
    environmentModel: {
      label: "Environment Model",
      score: environmentRisk,
      status: statusFromPercent(environmentRisk),
      details: `AQI ${Number(environmentSource?.air_quality_index ?? environmentSource?.aqi ?? 0)} · Temp ${Number(environmentSource?.temperature ?? 22)}C · Humidity ${Number(environmentSource?.humidity ?? 50)}%`,
    },
  };
};

const buildInsightsFromAiServiceResponse = (response) => {
  if (!response || typeof response !== "object" || !response.models || !response.fusion) {
    return null;
  }

  const ragSources = normalizeRagSources(response.sources || []);
  const guidelineTags = Array.from(
    new Set(
      (Array.isArray(response.sources) ? response.sources : [])
        .map((item) => String(item?.source || "").trim())
        .filter(Boolean),
    ),
  );
  const score = toPercentFromRisk(response.risk_score);

  return {
    score,
    status: statusFromAiLabel(response.risk_label || response?.fusion?.risk_level),
    confidence: clamp(Math.round(Number(response.confidence ?? 0.85) * 100), 0, 100),
    predictedWindowMinutes: Math.max(60, Number(response.predicted_window_hours ?? 4) * 60),
    factors: Array.isArray(response.factors) ? response.factors : [],
    guidelines: guidelineTags.length ? guidelineTags : ["WHO", "GINA", "GOLD"],
    modelOutputs: buildModelOutputsFromAiService(response.models),
    rag: {
      explanation: String(response.explanation || "No RAG explanation available."),
      sources: ragSources,
    },
    fusion: response.fusion,
    models: response.models,
  };
};

export const buildModelOutputs = ({ latestVital, latestEnvironment, intakeForm }) => {
  const signals = normalizeIntakeForm(intakeForm || {}, { latestVital, latestEnvironment });
  return buildModelOutputsFromSignals(signals);
};

export const buildModelOutputsFromManualInput = (input = {}) => {
  const signals = normalizeIntakeForm(input);
  return buildModelOutputsFromSignals(signals);
};

export const buildManualAiInsights = ({ input, ragInsight }) => {
  const signals = normalizeIntakeForm(input);
  const aiServiceInsight = buildInsightsFromAiServiceResponse(ragInsight);
  if (aiServiceInsight) {
    return {
      ...aiServiceInsight,
      factors: aiServiceInsight.factors?.length
        ? aiServiceInsight.factors
        : buildFactorsFromSignals(signals, aiServiceInsight.score),
    };
  }

  const modelOutputs = buildModelOutputsFromSignals(signals);
  const blendedScore = buildWeightedScore(modelOutputs);

  return {
    score: blendedScore,
    status: statusFromPercent(blendedScore),
    confidence: clamp(76 + Math.round((signals.symptom_count * 4) + (signals.chronic_condition_count * 2)), 70, 98),
    predictedWindowMinutes: blendedScore >= 75 ? 120 : blendedScore >= 50 ? 240 : 420,
    factors: buildFactorsFromSignals(signals, blendedScore),
    guidelines: ["WHO", "GINA", "GOLD", "ATS"],
    modelOutputs,
    rag: ragInsight
      ? {
          explanation: ragInsight.explanation || "",
          sources: Array.isArray(ragInsight.sources) ? ragInsight.sources : [],
        }
      : {
          explanation: "RAG explanation unavailable.",
          sources: [],
        },
  };
};

const buildHeuristicInsight = ({ latestVital, latestEnvironment, patientCondition, intakeForm }) => {
  const signals = normalizeIntakeForm(intakeForm || {}, { latestVital, latestEnvironment });
  const modelOutputs = buildModelOutputsFromSignals(signals);
  const score = buildWeightedScore(modelOutputs);
  const status = classifyRiskStatus(score);

  const recommendations =
    status === "critical"
      ? "Risk elevated: immediate clinical review and protocol escalation are recommended."
      : status === "warning"
        ? "Risk moderate-high: increase monitoring frequency and reduce trigger exposure."
        : "Risk currently controlled: continue treatment and routine monitoring.";

  const baseGuidelines = ["GINA 2024", "WHO Respiratory Care", "GOLD 2024", "ATS Guidance"];
  if (patientCondition) {
    baseGuidelines.unshift(String(patientCondition));
  }

  return {
    score,
    status,
    confidence: clamp(80 + Math.round(signals.stress_indicator / 8), 75, 97),
    predictedWindowMinutes: status === "critical" ? 120 : status === "warning" ? 360 : 720,
    factors: buildFactorsFromSignals(signals, score),
    recommendations,
    guidelines: baseGuidelines.slice(0, 6),
    modelOutputs,
  };
};

export const buildAiInsight = async ({
  patientId,
  latestVital,
  historyVitals,
  latestEnvironment,
  patientCondition,
  intakeForm,
}) => {
  const normalizedIntake = normalizeIntakeForm(intakeForm || {}, { latestVital, latestEnvironment });

  try {
    const aiPrediction = await predictRiskFromAiService({
      patientId,
      latestVital,
      historyVitals,
      latestEnvironment,
      intakeForm: normalizedIntake,
    });

    return {
      ...aiPrediction,
      factors: aiPrediction.factors?.length
        ? aiPrediction.factors
        : buildFactorsFromSignals(normalizedIntake, Number(aiPrediction.score ?? 0)),
    };
  } catch {
    return buildHeuristicInsight({ latestVital, latestEnvironment, patientCondition, intakeForm: normalizedIntake });
  }
};

export const buildCompositeAiInsight = async ({
  patientId,
  latestVital,
  historyVitals,
  latestEnvironment,
  patientCondition,
  ragInsight,
  intakeForm,
}) => {
  const base = await buildAiInsight({
    patientId,
    latestVital,
    historyVitals,
    latestEnvironment,
    patientCondition,
    intakeForm,
  });

  const aiServiceInsight = buildInsightsFromAiServiceResponse(ragInsight);
  if (aiServiceInsight) {
    return {
      ...base,
      ...aiServiceInsight,
      score: clamp(Number(aiServiceInsight.score ?? base.score ?? 0), 0, 100),
      status: aiServiceInsight.status || classifyRiskStatus(Number(aiServiceInsight.score ?? base.score ?? 0)),
    };
  }

  const modelOutputs = buildModelOutputs({ latestVital, latestEnvironment, intakeForm });
  const blendedScore = Math.round((Number(base.score || 0) + buildWeightedScore(modelOutputs)) / 2);

  return {
    ...base,
    score: clamp(blendedScore, 0, 100),
    status: classifyRiskStatus(blendedScore),
    modelOutputs,
    rag: ragInsight
      ? {
          explanation: ragInsight.explanation || "",
          sources: Array.isArray(ragInsight.sources) ? ragInsight.sources : [],
        }
      : {
          explanation: "RAG explanation unavailable. Showing rule-based interpretation.",
          sources: [],
        },
  };
};

export const generateChatReply = ({ prompt, insight }) => {
  const normalized = prompt.toLowerCase();

  if (normalized.includes("walk") || normalized.includes("outside") || normalized.includes("outdoor")) {
    if (insight.status === "critical" || insight.status === "warning") {
      return "Air quality is currently a trigger risk. Prefer indoor breathing exercises today and avoid outdoor effort until AQI improves.";
    }
    return "A short light walk is acceptable. Keep your inhaler with you and avoid intense exertion.";
  }

  if (normalized.includes("med") || normalized.includes("medication")) {
    return "Continue your scheduled medications exactly as prescribed. If symptoms increase, contact your doctor before changing dosage.";
  }

  if (insight.status === "critical") {
    return "Your recent signals show elevated risk. Please contact your care team now and stay in a safe environment while monitoring your breathing.";
  }

  return "Your latest vitals are being monitored continuously. Keep hydrated, follow your medication schedule, and I will alert you if risk rises.";
};

export const generateExplainableInsight = async ({
  patientId,
  latestVital,
  historyVitals,
  latestEnvironment,
  intakeForm,
}) => {
  const normalizedIntake = normalizeIntakeForm(intakeForm || {}, { latestVital, latestEnvironment });

  try {
    return await explainRiskFromAiService({
      patientId,
      latestVital,
      historyVitals,
      latestEnvironment,
      intakeForm: normalizedIntake,
    });
  } catch {
    return null;
  }
};

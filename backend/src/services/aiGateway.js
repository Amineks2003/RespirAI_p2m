const DEFAULT_AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8100";
const AI_TIMEOUT_MS = Number(process.env.AI_SERVICE_TIMEOUT_MS || 20000);

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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const requestAiService = async (path, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${DEFAULT_AI_SERVICE_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`AI service error (${response.status}): ${payload || response.statusText}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const fileToAiPayload = (file) => {
  if (!file?.buffer) return undefined;

  return {
    filename: file.originalname || "upload.bin",
    content_type: file.mimetype || "application/octet-stream",
    size: Number(file.size || file.buffer.length || 0),
    data_base64: file.buffer.toString("base64"),
  };
};

const buildManualFilePayload = (uploadedFiles = {}) => ({
  apn_file: fileToAiPayload(uploadedFiles.apnFile),
  dat_file: fileToAiPayload(uploadedFiles.datFile),
  hea_file: fileToAiPayload(uploadedFiles.heaFile),
  wav_files: Array.isArray(uploadedFiles.wavFiles)
    ? uploadedFiles.wavFiles.map(fileToAiPayload).filter(Boolean)
    : [],
});

const toRiskStatus = (label, scorePercent) => {
  const normalized = String(label || "").trim().toLowerCase();
  const fromLabel =
    normalized === "critical"
      ? "critical"
      : normalized === "high"
        ? "warning"
        : normalized === "moderate"
          ? "moderate"
          : normalized === "stable" || normalized === "low"
            ? "stable"
            : "stable";

  const fromScore =
    scorePercent >= 75
      ? "critical"
      : scorePercent >= 50
        ? "warning"
        : scorePercent >= 30
          ? "moderate"
          : "stable";

  const priority = { stable: 0, moderate: 1, warning: 2, critical: 3 };
  return priority[fromScore] > priority[fromLabel] ? fromScore : fromLabel;
};

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
  return ["male", "female", "other"].includes(normalized)
    ? normalized
    : DEFAULT_INTAKE_FORM.sex;
};

const normalizeSmokingStatus = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["non_smoker", "former_smoker", "current_smoker"].includes(normalized)
    ? normalized
    : DEFAULT_INTAKE_FORM.smoking_status;
};

const normalizeIntakeForm = ({ intakeForm = {}, latestVital = {}, latestEnvironment = {} } = {}) => {
  const fallbackCoughEvents = firstNumber(
    intakeForm?.cough_events_per_hour,
    intakeForm?.coughEvents,
    latestVital?.coughEvents,
    latestVital?.cough_events_per_hour,
    0,
  );

  const respiratoryRate = clamp(
    firstNumber(
      intakeForm?.respiratory_rate,
      intakeForm?.rr,
      latestVital?.respiratory_rate,
      latestVital?.rr,
      DEFAULT_INTAKE_FORM.respiratory_rate,
    ) ?? DEFAULT_INTAKE_FORM.respiratory_rate,
    5,
    80,
  );

  return {
    age: clamp(
      Math.round(firstNumber(intakeForm?.age, DEFAULT_INTAKE_FORM.age) ?? DEFAULT_INTAKE_FORM.age),
      1,
      120,
    ),
    sex: normalizeSex(intakeForm?.sex),
    height_cm: clamp(
      firstNumber(intakeForm?.height_cm, DEFAULT_INTAKE_FORM.height_cm) ?? DEFAULT_INTAKE_FORM.height_cm,
      90,
      260,
    ),
    weight_kg: clamp(
      firstNumber(intakeForm?.weight_kg, DEFAULT_INTAKE_FORM.weight_kg) ?? DEFAULT_INTAKE_FORM.weight_kg,
      20,
      350,
    ),
    smoking_status: normalizeSmokingStatus(intakeForm?.smoking_status),
    spo2: clamp(
      firstNumber(intakeForm?.spo2, latestVital?.spo2, DEFAULT_INTAKE_FORM.spo2) ?? DEFAULT_INTAKE_FORM.spo2,
      70,
      100,
    ),
    heart_rate: clamp(
      firstNumber(
        intakeForm?.heart_rate,
        intakeForm?.hr,
        latestVital?.heart_rate,
        latestVital?.hr,
        DEFAULT_INTAKE_FORM.heart_rate,
      ) ?? DEFAULT_INTAKE_FORM.heart_rate,
      20,
      220,
    ),
    respiratory_rate: respiratoryRate,
    temperature: clamp(
      firstNumber(intakeForm?.temperature, latestVital?.temperature, DEFAULT_INTAKE_FORM.temperature)
        ?? DEFAULT_INTAKE_FORM.temperature,
      30,
      45,
    ),
    cough: firstBoolean(
      intakeForm?.cough,
      fallbackCoughEvents !== null ? fallbackCoughEvents > 0 : null,
      false,
    ) ?? false,
    shortness_of_breath: firstBoolean(
      intakeForm?.shortness_of_breath,
      respiratoryRate >= 22,
      false,
    ) ?? false,
    wheezing: firstBoolean(
      intakeForm?.wheezing,
      intakeForm?.wheeze_detected,
      intakeForm?.wheezeDetected,
      latestVital?.wheezeDetected,
      false,
    ) ?? false,
    chest_pain: firstBoolean(intakeForm?.chest_pain, false) ?? false,
    fatigue: firstBoolean(intakeForm?.fatigue, false) ?? false,
    asthma: firstBoolean(intakeForm?.asthma, false) ?? false,
    copd: firstBoolean(intakeForm?.copd, false) ?? false,
    hypertension: firstBoolean(intakeForm?.hypertension, false) ?? false,
    diabetes: firstBoolean(intakeForm?.diabetes, false) ?? false,
    heart_disease: firstBoolean(intakeForm?.heart_disease, false) ?? false,
    air_quality_index: clamp(
      firstNumber(
        intakeForm?.air_quality_index,
        intakeForm?.aqi,
        latestEnvironment?.air_quality_index,
        latestEnvironment?.aqi,
        DEFAULT_INTAKE_FORM.air_quality_index,
      ) ?? DEFAULT_INTAKE_FORM.air_quality_index,
      0,
      500,
    ),
    environment_temperature: clamp(
      firstNumber(
        intakeForm?.environment_temperature,
        latestEnvironment?.environment_temperature,
        latestEnvironment?.temperature,
        DEFAULT_INTAKE_FORM.environment_temperature,
      ) ?? DEFAULT_INTAKE_FORM.environment_temperature,
      -30,
      60,
    ),
    humidity: clamp(
      firstNumber(intakeForm?.humidity, latestEnvironment?.humidity, DEFAULT_INTAKE_FORM.humidity)
        ?? DEFAULT_INTAKE_FORM.humidity,
      0,
      100,
    ),
  };
};

const buildPhysiologySeries = ({ latestVital, history = [], normalizedIntake }) => {
  const trend = Array.isArray(history) && history.length > 0
    ? history
    : latestVital
      ? [latestVital]
      : [];

  if (trend.length === 0) {
    return [{
      spo2: normalizedIntake.spo2,
      rr: normalizedIntake.respiratory_rate,
      hr: normalizedIntake.heart_rate,
    }];
  }

  const baseApneaLevel = clamp(
    (normalizedIntake.shortness_of_breath ? 3 : 1) + (normalizedIntake.fatigue ? 1 : 0),
    0,
    10,
  );
  const baseCoughEvents = normalizedIntake.cough ? 8 : 0;

  return trend.map((point) => ({
    spo2: Number(point.spo2 ?? normalizedIntake.spo2),
    rr: Number(point.rr ?? normalizedIntake.respiratory_rate),
    hr: Number(point.hr ?? normalizedIntake.heart_rate),
    apnea_level: Number(point.apneaLevel ?? point.apnea_level ?? baseApneaLevel),
    cough_events_per_hour: Number(point.coughEvents ?? point.cough_events_per_hour ?? baseCoughEvents),
    wheezing_detected: Boolean(point.wheezeDetected ?? point.wheezing_detected ?? normalizedIntake.wheezing),
    timestamp: point.timestamp || point.createdAt,
  }));
};

const buildAiPayload = ({ patientId, latestVital, historyVitals, latestEnvironment, intakeForm }) => {
  const normalizedIntake = normalizeIntakeForm({ intakeForm, latestVital, latestEnvironment });

  const coughEvents = normalizedIntake.cough ? Math.max(2, (normalizedIntake.shortness_of_breath ? 8 : 5)) : 0;
  const apneaLevel = clamp(
    (normalizedIntake.shortness_of_breath ? 4 : 1)
    + (normalizedIntake.fatigue ? 1 : 0)
    + (normalizedIntake.copd ? 1 : 0),
    0,
    10,
  );

  return {
    patient_id: String(patientId || "unknown"),
    intake_form: normalizedIntake,
    physiology: buildPhysiologySeries({ latestVital, history: historyVitals, normalizedIntake }),
    environment: {
      aqi: normalizedIntake.air_quality_index,
      temperature: normalizedIntake.environment_temperature,
      humidity: normalizedIntake.humidity,
      pm25: Number(latestEnvironment?.pm25 ?? normalizedIntake.air_quality_index),
      pm10: Number(latestEnvironment?.pm10 ?? normalizedIntake.air_quality_index),
    },

    spo2: normalizedIntake.spo2,
    rr: normalizedIntake.respiratory_rate,
    hr: normalizedIntake.heart_rate,
    cough_events: coughEvents,
    wheeze_detected: normalizedIntake.wheezing,
    apnea_level: apneaLevel,
    aqi: normalizedIntake.air_quality_index,
    temperature: normalizedIntake.environment_temperature,
    humidity: normalizedIntake.humidity,

    vitals: {
      spo2: normalizedIntake.spo2,
      respiration_rate: normalizedIntake.respiratory_rate,
      heart_rate: normalizedIntake.heart_rate,
    },
    audio: {
      cough_frequency_per_hour: coughEvents,
      wheezing_detected: normalizedIntake.wheezing,
      wheezing_intensity: normalizedIntake.wheezing ? 0.68 : 0.12,
    },
    apnea: {
      respiration_rate: normalizedIntake.respiratory_rate,
      spo2: normalizedIntake.spo2,
      apnea_level: apneaLevel,
    },
  };
};

export const predictRiskFromAiService = async ({
  patientId,
  latestVital,
  historyVitals,
  latestEnvironment,
  intakeForm,
}) => {
  const payload = buildAiPayload({
    patientId,
    latestVital,
    historyVitals,
    latestEnvironment,
    intakeForm,
  });

  const prediction = await requestAiService("/api/v1/predict", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const scorePercent = Math.round(Number(prediction.risk_score || 0) * 1000) / 10;

  return {
    score: scorePercent,
    status: toRiskStatus(prediction.risk_label, scorePercent),
    confidence: Math.round(Number(prediction.confidence || 0.9) * 100),
    predictedWindowMinutes: Number(prediction.predicted_window_hours || 2) * 60,
    factors: prediction.factors || [],
    recommendations:
      prediction.risk_label === "critical"
        ? "AI model detected critical short-term risk. Trigger immediate clinical review."
        : prediction.risk_label === "high"
          ? "AI model detected high short-term risk. Increase monitoring and interventions."
          : "AI model indicates lower short-term risk. Continue monitoring.",
    guidelines: ["WHO", "GINA", "GOLD"],
    models: prediction.models || null,
    fusion: prediction.fusion || null,
  };
};

export const explainRiskFromAiService = async ({
  patientId,
  latestVital,
  historyVitals,
  latestEnvironment,
  intakeForm,
}) => {
  const payload = {
    ...buildAiPayload({ patientId, latestVital, historyVitals, latestEnvironment, intakeForm }),
    top_k_guidelines: 4,
  };

  return requestAiService("/api/v1/explain", {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

export const runManualAiFromAiService = async ({
  modelKey,
  patientId,
  latestVital,
  historyVitals = [],
  latestEnvironment,
  intakeForm,
  uploadedFiles,
}) => {
  const payload = {
    ...buildAiPayload({
      patientId,
      latestVital,
      historyVitals,
      latestEnvironment,
      intakeForm,
    }),
    model: modelKey || "all_models",
    selected_models: modelKey && modelKey !== "all_models" ? [modelKey] : undefined,
    top_k_guidelines: 4,
  };

  return requestAiService("/api/v1/manual/run", {
    method: "POST",
    body: JSON.stringify({
      model: modelKey || "all_models",
      payload,
      files: buildManualFilePayload(uploadedFiles),
      top_k_guidelines: 4,
    }),
  });
};

export const fetchGuidelinesFromAiService = async ({ limit = 24, query } = {}) => {
  const params = new URLSearchParams();
  params.set("limit", String(Math.max(1, Math.min(200, Number(limit) || 24))));

  if (typeof query === "string" && query.trim().length >= 2) {
    params.set("query", query.trim());
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await requestAiService(`/api/v1/guidelines${suffix}`, { method: "GET" });
  return response?.sources || [];
};

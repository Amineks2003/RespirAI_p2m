const GENDER_OPTIONS = ["female", "male", "other", "unknown"];

const SPO2_NUMERIC_RULES = {
  hour_from_admission: { min: 0, max: 8760 },
  heart_rate: { min: 20, max: 220 },
  respiratory_rate: { min: 5, max: 80 },
  spo2_pct: { min: 50, max: 100 },
  systolic_bp: { min: 60, max: 260 },
  diastolic_bp: { min: 30, max: 150 },
  mobility_score: { min: 0, max: 10 },
  lactate: { min: 0, max: 30 },
  hemoglobin: { min: 4, max: 22 },
  age: { min: 0, max: 120 },
  comorbidity_index: { min: 0, max: 40 },
};

const normalizeNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeString = (value) => String(value ?? "").trim();

export const normalizeSpo2Gender = (value) => {
  const normalized = normalizeString(value).toLowerCase();
  if (!normalized) return "other";
  if (normalized === "m") return "male";
  if (normalized === "f") return "female";
  return GENDER_OPTIONS.includes(normalized) ? normalized : "other";
};

export const validateSpo2Payload = (rawPayload = {}, options = {}) => {
  const { requireAll = true } = options;
  const source = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const errors = {};
  const data = {};

  const patientId = normalizeString(source.patient_id);
  if (!patientId) {
    if (requireAll) errors.patient_id = "This field is required.";
  } else {
    data.patient_id = patientId;
  }

  const rawGender = normalizeString(source.gender);
  if (!rawGender) {
    if (requireAll) errors.gender = "This field is required.";
  } else {
    data.gender = normalizeSpo2Gender(rawGender);
  }

  for (const [field, bounds] of Object.entries(SPO2_NUMERIC_RULES)) {
    const value = source[field];

    if (value === undefined || value === null || value === "") {
      if (requireAll) errors[field] = "This field is required.";
      continue;
    }

    const numericValue = normalizeNumber(value);
    if (numericValue === null) {
      errors[field] = "Must be a valid number.";
      continue;
    }

    if (numericValue < bounds.min || numericValue > bounds.max) {
      errors[field] = `Must be between ${bounds.min} and ${bounds.max}.`;
      continue;
    }

    data[field] = numericValue;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    data,
  };
};

export const mapSpo2PayloadToIntakeForm = (payload = {}, fallback = {}) => {
  const sex = normalizeSpo2Gender(payload.gender);
  const intake = {
    ...fallback,
    patient_id: payload.patient_id,
    hour_from_admission: payload.hour_from_admission,
    age: payload.age,
    sex,
    spo2: payload.spo2_pct,
    spo2_pct: payload.spo2_pct,
    heart_rate: payload.heart_rate,
    respiratory_rate: payload.respiratory_rate,
    systolic_bp: payload.systolic_bp,
    diastolic_bp: payload.diastolic_bp,
    mobility_score: payload.mobility_score,
    lactate: payload.lactate,
    hemoglobin: payload.hemoglobin,
    comorbidity_index: payload.comorbidity_index,
  };

  return intake;
};

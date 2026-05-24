const SEX_OPTIONS = ["male", "female", "other"];
const SMOKING_OPTIONS = ["non_smoker", "former_smoker", "current_smoker"];

const NUMERIC_RULES = {
  age: { min: 1, max: 120 },
  height_cm: { min: 90, max: 260 },
  weight_kg: { min: 20, max: 350 },
  spo2: { min: 70, max: 100 },
  heart_rate: { min: 20, max: 220 },
  respiratory_rate: { min: 5, max: 80 },
  temperature: { min: 30, max: 45 },
  air_quality_index: { min: 0, max: 500 },
  environment_temperature: { min: -30, max: 60 },
  humidity: { min: 0, max: 100 },
};

const BOOLEAN_FIELDS = [
  "shortness_of_breath",
  "chest_pain",
  "fatigue",
  "asthma",
  "copd",
  "hypertension",
  "diabetes",
  "heart_disease",
];

const FORM_FIELDS = [
  "age",
  "sex",
  "height_cm",
  "weight_kg",
  "smoking_status",
  "spo2",
  "heart_rate",
  "respiratory_rate",
  "temperature",
  ...BOOLEAN_FIELDS,
  "air_quality_index",
  "environment_temperature",
  "humidity",
];

const normalizeBoolean = (value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off"].includes(normalized)) return false;
  }
  return null;
};

const normalizeNumber = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const defaultFormData = {
  age: 45,
  sex: "other",
  height_cm: 170,
  weight_kg: 70,
  smoking_status: "non_smoker",
  spo2: 96,
  heart_rate: 80,
  respiratory_rate: 18,
  temperature: 37.0,
  shortness_of_breath: false,
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

export const getDefaultPatientFormData = () => ({ ...defaultFormData });

export const getPatientFormFields = () => [...FORM_FIELDS];

export const validatePatientFormPayload = (rawPayload = {}, options = {}) => {
  const { requireAll = true } = options;

  const source = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  const errors = {};
  const data = {};

  for (const [field, bounds] of Object.entries(NUMERIC_RULES)) {
    const value = source[field];

    if (value === undefined || value === null || value === "") {
      if (requireAll) {
        errors[field] = "This field is required.";
      }
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

  const normalizedSex = String(source.sex || "").trim().toLowerCase();
  if (!normalizedSex) {
    if (requireAll) {
      errors.sex = "This field is required.";
    }
  } else if (!SEX_OPTIONS.includes(normalizedSex)) {
    errors.sex = `Must be one of: ${SEX_OPTIONS.join(", ")}.`;
  } else {
    data.sex = normalizedSex;
  }

  const normalizedSmokingStatus = String(source.smoking_status || "").trim().toLowerCase();
  if (!normalizedSmokingStatus) {
    if (requireAll) {
      errors.smoking_status = "This field is required.";
    }
  } else if (!SMOKING_OPTIONS.includes(normalizedSmokingStatus)) {
    errors.smoking_status = `Must be one of: ${SMOKING_OPTIONS.join(", ")}.`;
  } else {
    data.smoking_status = normalizedSmokingStatus;
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = source[field];

    if (value === undefined || value === null || value === "") {
      if (requireAll) {
        errors[field] = "This field is required.";
      }
      continue;
    }

    const boolValue = normalizeBoolean(value);
    if (boolValue === null) {
      errors[field] = "Must be true/false.";
      continue;
    }

    data[field] = boolValue;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    data,
  };
};

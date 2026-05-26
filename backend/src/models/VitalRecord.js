import mongoose from "mongoose";

const model1ApneaSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    modelName: { type: String, default: "cnn_bilstm_model.keras" },
    source: { type: String, default: "doctor-ai-insights-wfdb" },
    patientId: { type: String, default: "" },

    files: {
      apn: { type: mongoose.Schema.Types.Mixed, default: null },
      dat: { type: mongoose.Schema.Types.Mixed, default: null },
      hea: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    signalMetadata: {
      recordName: { type: String, default: null },
      signalSamples: { type: Number, default: null },
      windowsAnalyzed: { type: Number, default: null },
      trueApneaWindows: { type: Number, default: null },
      predictedApneaWindows: { type: Number, default: null },
    },

    clinicalContext: {
      apneaLevel: { type: Number, default: null },
      spo2: { type: Number, default: null },
      respiratoryRate: { type: Number, default: null },
      heartRate: { type: Number, default: null },
      coughEvents: { type: Number, default: null },
      wheezeDetected: { type: Boolean, default: false },
    },

    modelOutput: {
      apneaLabel: { type: String, default: null },
      hasApnea: { type: mongoose.Schema.Types.Mixed, default: null },
      riskScore: { type: Number, default: null },
      confidence: { type: Number, default: null },
      details: { type: String, default: null },
    },
  },
  { _id: false },
);

const model2Spo2Schema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    modelName: { type: String, default: "lstm_SPO2_model.keras" },
    source: { type: String, default: "doctor-ai-insights-csv" },
    patient_id: { type: String, default: "" },

    csvFile: { type: mongoose.Schema.Types.Mixed, default: null },
    rowsUsed: { type: Number, default: null },
    lastHourFromAdmission: { type: Number, default: null },

    features: {
      patient_id: { type: String, default: "" },
      hour_from_admission: { type: Number, default: null },
      heart_rate: { type: Number, default: null },
      respiratory_rate: { type: Number, default: null },
      spo2_pct: { type: Number, default: null },
      systolic_bp: { type: Number, default: null },
      diastolic_bp: { type: Number, default: null },
      mobility_score: { type: Number, default: null },
      lactate: { type: Number, default: null },
      hemoglobin: { type: Number, default: null },
      age: { type: Number, default: null },
      gender: { type: String, default: null },
      comorbidity_index: { type: Number, default: null },
      deterioration_next_12h: { type: mongoose.Schema.Types.Mixed, default: null },
    },

    modelOutput: {
      probabilityDeterioration: { type: Number, default: null },
      prediction: { type: mongoose.Schema.Types.Mixed, default: null },
      riskLabel: { type: String, default: null },
      status: { type: String, default: null },
      riskScore: { type: Number, default: null },
      confidence: { type: Number, default: null },
    },
  },
  { _id: false },
);

const vitalRecordSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    spo2: { type: Number, default: 98 },
    hr: { type: Number, default: 72 },
    rr: { type: Number, default: 16 },
    temperature: { type: Number, default: 37 },
    apneaLevel: { type: Number, default: 0 },
    coughEvents: { type: Number, default: 0 },
    wheezeDetected: { type: Boolean, default: false },
    aqi: { type: Number, default: null },
    roomTemperature: { type: Number, default: null },
    humidity: { type: Number, default: null },
    source: { type: String, default: "wearable" },
    timestamp: { type: Date, default: Date.now, index: true },

    modelInputs: {
      model1Apnea: { type: model1ApneaSchema, default: () => ({}) },
      model2Spo2: { type: model2Spo2Schema, default: () => ({}) },
    },
  },
  { timestamps: true },
);

vitalRecordSchema.index({ patient: 1, timestamp: -1 });
vitalRecordSchema.index({ patient: 1, "modelInputs.model1Apnea.enabled": 1, timestamp: -1 });
vitalRecordSchema.index({ patient: 1, "modelInputs.model2Spo2.enabled": 1, timestamp: -1 });

export const VitalRecord =
  mongoose.models.VitalRecord || mongoose.model("VitalRecord", vitalRecordSchema);

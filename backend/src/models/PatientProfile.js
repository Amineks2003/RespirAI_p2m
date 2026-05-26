import mongoose from "mongoose";

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    phone: { type: String, default: "" },
  },
  { _id: false },
);

const doctorRiskHistoryEntrySchema = new mongoose.Schema(
  {
    score: { type: Number, required: true },
    confidence: { type: Number, default: null },
    sentAt: { type: Date, default: Date.now },
    source: { type: String, default: "manual-ai-rag" },
  },
  { _id: false },
);

const fileMetaSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    mimetype: { type: String, default: "" },
    sizeBytes: { type: Number, default: 0 },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

const apneaSignalsSchema = new mongoose.Schema(
  {
    apn: { type: fileMetaSchema, default: null },
    dat: { type: fileMetaSchema, default: null },
    hea: { type: fileMetaSchema, default: null },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

const spo2SnapshotSchema = new mongoose.Schema(
  {
    patient_id: { type: String, default: "" },
    hour_from_admission: { type: Number, default: null },
    age: { type: Number, default: null },
    gender: { type: String, default: "" },
    comorbidity_index: { type: Number, default: null },
    heart_rate: { type: Number, default: null },
    respiratory_rate: { type: Number, default: null },
    spo2: { type: Number, default: null },
    spo2_pct: { type: Number, default: null },
    systolic_bp: { type: Number, default: null },
    diastolic_bp: { type: Number, default: null },
    mobility_score: { type: Number, default: null },
    lactate: { type: Number, default: null },
    hemoglobin: { type: Number, default: null },
  },
  { _id: false },
);

const spo2HistorySchema = new mongoose.Schema(
  {
    csv: { type: fileMetaSchema, default: null },
    lastRow: { type: spo2SnapshotSchema, default: null },
    uploadedAt: { type: Date },
  },
  { _id: false },
);

const aiModelDataSchema = new mongoose.Schema(
  {
    apneaSignals: { type: apneaSignalsSchema, default: null },
    spo2History: { type: spo2HistorySchema, default: null },
  },
  { _id: false },
);

const patientProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    patientCode: { type: String, required: true, unique: true, index: true },
    dob: { type: Date },
    gender: { type: String, default: "" },
    condition: { type: String, default: "" },
    bloodType: { type: String, default: "" },
    status: { type: String, enum: ["critical", "warning", "moderate", "stable"], default: "stable", index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    admittedAt: { type: Date },
    latestUploadAt: { type: Date },
    latestUploadName: { type: String, default: "" },
    latestUploadData: { type: mongoose.Schema.Types.Mixed, default: null },
    latestAiInsights: { type: mongoose.Schema.Types.Mixed, default: null },
    latestDoctorAiInput: { type: mongoose.Schema.Types.Mixed, default: null },
    latestDoctorSentResult: { type: mongoose.Schema.Types.Mixed, default: null },
    doctorRiskHistory: { type: [doctorRiskHistoryEntrySchema], default: [] },
    latestIntakeForm: { type: mongoose.Schema.Types.Mixed, default: null },
    aiModelData: { type: aiModelDataSchema, default: null },
    emergencyContact: { type: emergencyContactSchema, default: () => ({}) },
  },
  { timestamps: true },
);

export const PatientProfile = mongoose.model("PatientProfile", patientProfileSchema);

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  Activity, Bell, LogOut, AlertTriangle,
  TrendingUp, Thermometer, Wind, Brain, BookOpen,
  CheckCircle2, XCircle, Mic, Heart, Stethoscope,
  Clock, User, Calendar, Pill, Zap, Search,
  Download, RefreshCw, Phone, Mail, ChevronRight,
  ChevronDown, ChevronUp, Plus, Eye, Edit, FileText,
  BarChart2, MessageSquare, Users, LayoutDashboard,
  Shield, Sparkles, X, Footprints, Droplets, Send,
  TrendingDown,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, BarChart, Bar, Legend,
} from "recharts";
import { AIRiskWidget } from "./AIRiskWidget";
import { API_BASE_URL, ApiError, apiRequest } from "../lib/api";
import { logout } from "../lib/auth";
import { clearSession, getSession, getToken } from "../lib/session";

const defaultPatients: any[] = [];
const spo2Data: any[] = [];
const apneaData: any[] = [];
const riskHistory: any[] = [];
const defaultWeeklyData: any[] = [];

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard" },
  { icon: Users, label: "Patients" },
  { icon: Brain, label: "AI Insights" },
  { icon: MessageSquare, label: "Patient Chat" },
];

const defaultReports: any[] = [];
const defaultConsultations: any[] = [];
const defaultKnowledgeSources: any[] = [];

const AI_MODEL_KEYS = {
  apnea: "cnn_bilstm_model.keras",
  spo2: "lstm_SPO2_model.keras",
  audio: "model_best.pth",
  all: "all_models",
};

const SPO2_AUTO_FIELDS = [
  "patient_id",
  "hour_from_admission",
  "age",
  "gender",
  "comorbidity_index",
];

const SPO2_MANUAL_FIELDS = [
  "heart_rate",
  "respiratory_rate",
  "spo2_pct",
  "systolic_bp",
  "diastolic_bp",
  "mobility_score",
  "lactate",
  "hemoglobin",
];

const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
];

const CNN_BILSTM_FILE_FIELDS = [
  { key: "apn", label: "Apnea signal (.apn)", accept: ".apn" },
  { key: "dat", label: "Signal data (.dat)", accept: ".dat" },
  { key: "hea", label: "Header (.hea)", accept: ".hea" },
];

const SPO2_FIELD_LABELS: Record<string, string> = {
  patient_id: "Patient ID",
  hour_from_admission: "Hours From Admission",
  heart_rate: "Heart Rate (bpm)",
  respiratory_rate: "Respiratory Rate (br/min)",
  spo2_pct: "SpO2 (%)",
  systolic_bp: "Systolic BP (mmHg)",
  diastolic_bp: "Diastolic BP (mmHg)",
  mobility_score: "Mobility Score",
  lactate: "Lactate (mmol/L)",
  hemoglobin: "Hemoglobin (g/dL)",
  age: "Age",
  gender: "Gender",
  comorbidity_index: "Comorbidity Index",
};

const SPO2_NUMERIC_RULES: Record<string, { min: number; max: number; step?: string }> = {
  hour_from_admission: { min: 0, max: 8760, step: "0.1" },
  heart_rate: { min: 20, max: 220, step: "1" },
  respiratory_rate: { min: 5, max: 80, step: "1" },
  spo2_pct: { min: 50, max: 100, step: "0.1" },
  systolic_bp: { min: 60, max: 260, step: "1" },
  diastolic_bp: { min: 30, max: 150, step: "1" },
  mobility_score: { min: 0, max: 10, step: "0.1" },
  lactate: { min: 0, max: 30, step: "0.1" },
  hemoglobin: { min: 4, max: 22, step: "0.1" },
  age: { min: 0, max: 120, step: "1" },
  comorbidity_index: { min: 0, max: 40, step: "1" },
};

const EMPTY_MANUAL_ERRORS = {
  apnea: {},
  spo2: {},
  audio: {},
};

const toNumberOrNull = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const computeAdmissionHours = (admittedAt?: string) => {
  if (!admittedAt) return "";
  const admittedTimestamp = new Date(admittedAt).getTime();
  if (Number.isNaN(admittedTimestamp)) return "";
  const hours = Math.max(0, (Date.now() - admittedTimestamp) / (1000 * 60 * 60));
  return hours.toFixed(1);
};

const createManualIntakeForm = (context: any = {}) => {
  const latestVital = context?.latestVital || {};

  return {
    apnea: {
      apn: null,
      dat: null,
      hea: null,
    },
    spo2: {
      patient_id: String(context?.patientId ?? ""),
      hour_from_admission: String(context?.hourFromAdmission ?? ""),
      age: String(context?.age ?? ""),
      gender: String(context?.gender ?? ""),
      comorbidity_index: String(context?.comorbidityIndex ?? ""),
      heart_rate: String(latestVital?.hr ?? ""),
      respiratory_rate: String(latestVital?.rr ?? ""),
      spo2_pct: String(latestVital?.spo2 ?? ""),
      systolic_bp: String(latestVital?.systolic_bp ?? latestVital?.systolicBp ?? ""),
      diastolic_bp: String(latestVital?.diastolic_bp ?? latestVital?.diastolicBp ?? ""),
      mobility_score: String(latestVital?.mobility_score ?? ""),
      lactate: String(latestVital?.lactate ?? ""),
      hemoglobin: String(latestVital?.hemoglobin ?? ""),
    },
    audio: {
      wav_files: [] as File[],
    },
  };
};

const validateSpo2Form = (form: any) => {
  const errors: Record<string, string> = {};
  const payload: Record<string, any> = {};

  for (const field of ["patient_id", "gender"]) {
    const rawValue = String(form?.spo2?.[field] ?? "").trim();
    if (!rawValue) {
      errors[field] = "Required.";
    } else {
      payload[field] = rawValue;
    }
  }

  for (const [field, bounds] of Object.entries(SPO2_NUMERIC_RULES)) {
    const rawValue = String(form?.spo2?.[field] ?? "").trim();
    if (!rawValue) {
      errors[field] = "Required.";
      continue;
    }

    const parsed = toNumberOrNull(rawValue);
    if (parsed === null) {
      errors[field] = "Invalid number.";
      continue;
    }

    if (parsed < bounds.min || parsed > bounds.max) {
      errors[field] = `Range ${bounds.min}-${bounds.max}.`;
      continue;
    }

    payload[field] = parsed;
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    payload,
  };
};

const validateApneaFiles = (form: any) => {
  const errors: Record<string, string> = {};
  const files = form?.apnea || {};

  for (const field of CNN_BILSTM_FILE_FIELDS) {
    const file = files[field.key];
    if (!file) {
      errors[field.key] = "Required.";
      continue;
    }

    if (!String(file?.name || "").toLowerCase().endsWith(field.accept)) {
      errors[field.key] = `Expected ${field.accept} file.`;
    }
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    payload: files,
  };
};

const validateAudioFiles = (form: any) => {
  const errors: Record<string, string> = {};
  const files = Array.isArray(form?.audio?.wav_files) ? form.audio.wav_files : [];

  if (!files.length) {
    errors.wav_files = "Add at least one .wav file.";
  } else if (files.some((file: File) => !String(file?.name || "").toLowerCase().endsWith(".wav"))) {
    errors.wav_files = "All files must be .wav.";
  }

  return {
    isValid: Object.keys(errors).length === 0,
    errors,
    payload: files,
  };
};

/* ────────────────────────────────────────────────────────────
   HELPERS
──────────────────────────────────────────────────────────── */
const riskColor = (r: number) => r >= 75 ? "text-red-600" : r >= 50 ? "text-amber-600" : r >= 30 ? "text-orange-500" : "text-emerald-600";
const riskBg = (r: number) => r >= 75 ? "bg-red-500" : r >= 50 ? "bg-amber-500" : r >= 30 ? "bg-orange-400" : "bg-emerald-500";
const statusBadge = (s: string) => {
  const map: Record<string, string> = {
    critical: "bg-red-100 text-red-700 border-red-200",
    warning: "bg-amber-100 text-amber-700 border-amber-200",
    moderate: "bg-orange-100 text-orange-700 border-orange-200",
    stable: "bg-emerald-100 text-emerald-700 border-emerald-200",
    urgent: "bg-red-100 text-red-700 border-red-200",
    scheduled: "bg-blue-100 text-blue-700 border-blue-200",
    pending: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return map[s] ?? map.pending;
};

const toTimeLabel = (dateValue?: string) => {
  if (!dateValue) return "--:--";
  return new Date(dateValue).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

const toDateLabel = (dateValue?: string) => {
  if (!dateValue) return "--";
  return new Date(dateValue).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const formatNumber2 = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "--";
  return parsed.toFixed(2);
};

const formatPercent2 = (value: unknown) => {
  const formatted = formatNumber2(value);
  return formatted === "--" ? "--" : `${formatted}%`;
};

const formatWithUnit2 = (value: unknown, unit: string) => {
  const formatted = formatNumber2(value);
  return formatted === "--" ? "--" : `${formatted} ${unit}`;
};

const SpO2Tip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  const c = v < 90 ? "#DC2626" : v < 94 ? "#F59E0B" : "#10B981";
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="font-bold text-sm" style={{ color: c }}>{v}% SpO₂</p>
    </div>
  );
};

/* ────────────────────────────────────────────────────────────
   DASHBOARD VIEW (main)
──────────────────────────────────────────────────────────── */
function DashboardView({
  patients,
  selectedPatient,
  setSelectedPatient,
  patientDetails,
  spo2Series,
  apneaSeries,
  riskSeries,
}: any) {
  const p = selectedPatient || patients[0];

  if (!p) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm text-center">
        <h3 className="text-blue-900 font-bold mb-2">No patient data available</h3>
        <p className="text-slate-500 text-sm">Add a patient or wait for data synchronization from the backend.</p>
      </div>
    );
  }

  const latestEnvironment = patientDetails?.latestEnvironment || {};
  const latestRisk = patientDetails?.latestRisk || {};
  const latestVital = patientDetails?.latestVital || {};
  const medications = (patientDetails?.medications || []).slice(0, 2).map((medication: any) => medication.name).join(", ");
  const patientGender = patientDetails?.profile?.gender || "--";
  const admittedAt = toDateLabel(patientDetails?.profile?.admittedAt);
  const riskScore = latestRisk?.score ?? p.risk;
  const wheezeConfidence = latestVital?.wheezeDetected ? 82 : 18;
  const coughFrequency = latestVital?.coughEvents ?? 0;

  return (
    <div className="flex gap-5 h-full">
      {/* ── LEFT: Triage Sidebar ── */}
      <div className="w-64 flex-shrink-0 flex flex-col gap-3">
        <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-blue-600" />
            <span className="text-blue-900 font-bold text-sm">Patient Triage</span>
            <span className="ml-auto text-[10px] font-bold bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full">
              {patients.filter((pt: any) => pt.status === "critical").length} CRITICAL
            </span>
          </div>
          <div className="space-y-2">
            {patients.map((pt: any) => (
              <button key={pt.id} onClick={() => setSelectedPatient(pt)}
                className={`w-full text-left rounded-xl p-3 border transition-all ${
                  selectedPatient?.id === pt.id
                    ? "bg-blue-50 border-blue-300 shadow-sm"
                    : "bg-slate-50 border-slate-100 hover:border-blue-200 hover:bg-blue-50/40"
                }`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black text-white flex-shrink-0 ${
                    pt.risk >= 75 ? "bg-red-500" : pt.risk >= 50 ? "bg-amber-500" : "bg-emerald-500"
                  }`}>
                    {pt.name.split(" ").map((n: string) => n[0]).join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-slate-800 font-semibold text-xs truncate">{pt.name.split(" ")[0]} {pt.name.split(" ")[1]?.[0]}.</p>
                    <p className="text-slate-400 text-[10px]">{pt.id}</p>
                  </div>
                  {pt.status === "critical" && (
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 bg-slate-200 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${riskBg(pt.risk)}`} style={{ width: `${pt.risk}%` }} />
                  </div>
                  <span className={`text-[10px] font-black ${riskColor(pt.risk)}`}>{pt.risk}%</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Main Content ── */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {/* Patient Header */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white font-black text-lg shadow-lg ${
                riskScore >= 75 ? "bg-gradient-to-br from-red-500 to-rose-600" : riskScore >= 50 ? "bg-gradient-to-br from-amber-500 to-orange-600" : "bg-gradient-to-br from-emerald-500 to-teal-600"
              }`}>
                {p.name.split(" ").map((n: string) => n[0]).join("")}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h2 className="text-blue-900 font-black">{p.name}</h2>
                  <span className={`text-xs font-bold px-2.5 py-1 rounded-full border capitalize ${statusBadge(p.status)}`}>{p.status}</span>
                </div>
                <p className="text-slate-500 text-sm">{p.id} · Age {p.age ?? "--"}</p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="bg-blue-100 text-blue-700 text-xs font-medium px-2 py-0.5 rounded-full">{p.condition}</span>
                  {riskScore >= 75 && <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full">⚠ HIGH RISK</span>}
                </div>
              </div>
            </div>
            <div className="flex gap-2" />
          </div>

          {/* Patient info + Environmental context */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: User, label: "Age / Sex", value: `${p.age || "--"} · ${patientGender}`, alert: false },
              { icon: Calendar, label: "Admitted", value: admittedAt, alert: false },
              { icon: Pill, label: "Medication", value: medications || "Not set", alert: false },
              { icon: Heart, label: "Heart Rate", value: formatWithUnit2(latestVital?.hr ?? p.hr, "bpm"), alert: (latestVital?.hr ?? p.hr) > 100 },
            ].map((item) => (
              <div key={item.label} className={`rounded-xl p-3 ${item.alert ? "bg-red-50 border border-red-200" : "bg-slate-50 border border-slate-100"}`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <item.icon className={`w-3.5 h-3.5 ${item.alert ? "text-red-500" : "text-slate-400"}`} />
                  <span className="text-xs text-slate-500">{item.label}</span>
                </div>
                <p className={`text-sm font-bold ${item.alert ? "text-red-700" : "text-slate-700"}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {/* Environmental widgets */}
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-2.5">
              <Wind className="w-4 h-4 text-red-500 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-500">Local Air Pollution</p>
                <p className="text-sm font-bold text-red-800">AQI {latestEnvironment?.aqi ?? 156} — {(latestEnvironment?.aqi ?? 156) > 150 ? "Unhealthy" : "Moderate"}</p>
              </div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-center gap-2.5">
              <Thermometer className="w-4 h-4 text-amber-600 flex-shrink-0" />
              <div>
                <p className="text-xs text-slate-500">Room Temperature</p>
                <p className="text-sm font-bold text-amber-800">{latestEnvironment?.temperature ?? 24.2}°C — Warm</p>
              </div>
            </div>
          </div>
        </div>

        {/* Real-Time Multimodal Vitals */}
        <div className="grid grid-cols-3 gap-4">
          {/* SpO2 Chart */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Heart className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div>
                  <p className="text-blue-900 font-bold text-xs">SpO₂ — Oxygen</p>
                  <p className="text-slate-400 text-[10px]">Pulse oximeter · 7h</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-red-600 font-black text-lg">{formatPercent2(latestVital?.spo2 ?? p.spo2)}</p>
                <p className="text-red-400 text-[10px]">↓ Critical</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={spo2Series} margin={{ top: 5, right: 2, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#94A3B8" }} tickLine={false} axisLine={false} interval={4} />
                <YAxis domain={[82, 100]} tick={{ fontSize: 8, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
                <Tooltip content={<SpO2Tip />} />
                <ReferenceLine y={94} stroke="#10B981" strokeDasharray="3 3" strokeWidth={1.5} />
                <ReferenceLine y={90} stroke="#EF4444" strokeDasharray="3 3" strokeWidth={1.5} />
                <Area type="monotone" dataKey="v" stroke="#3B82F6" strokeWidth={2} fill="url(#g1)" dot={false} activeDot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Apnea */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan-100 flex items-center justify-center">
                  <Wind className="w-3.5 h-3.5 text-cyan-600" />
                </div>
                <div>
                  <p className="text-blue-900 font-bold text-xs">Apnea Level</p>
                  <p className="text-slate-400 text-[10px]">Sleep-breathing severity · 7h</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-amber-600 font-black text-lg">{latestVital?.apneaLevel ?? 0}/10</p>
                <p className="text-amber-400 text-[10px]">Severity scale</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={120}>
              <AreaChart data={apneaSeries} margin={{ top: 5, right: 2, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#94A3B8" }} tickLine={false} axisLine={false} interval={4} />
                <YAxis domain={[0, 10]} tick={{ fontSize: 8, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: any) => [`${Number(v).toFixed(1)}/10`, "Apnea"]} />
                <ReferenceLine y={5} stroke="#94A3B8" strokeDasharray="3 3" strokeWidth={1.5} />
                <Area type="monotone" dataKey="v" stroke="#06B6D4" strokeWidth={2} fill="url(#g2)" dot={false} activeDot={{ r: 3 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Audio Analysis */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center">
                <Mic className="w-3.5 h-3.5 text-violet-600" />
              </div>
              <div>
                <p className="text-blue-900 font-bold text-xs">Audio Analysis</p>
                <p className="text-slate-400 text-[10px]">Acoustic sensor</p>
              </div>
            </div>
            <div className="space-y-2.5">
              <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-red-700">Wheezing</span>
                  <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded-full font-bold">{latestVital?.wheezeDetected ? "DETECTED" : "LOW"}</span>
                </div>
                <div className="w-full bg-red-100 rounded-full h-1.5">
                  <div className="bg-red-500 h-1.5 rounded-full" style={{ width: `${wheezeConfidence}%` }} />
                </div>
                <p className="text-[10px] text-red-500 mt-1">Confidence: {wheezeConfidence}%</p>
              </div>
              <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-amber-700">Cough Freq.</span>
                  <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold">ELEVATED</span>
                </div>
                <div className="w-full bg-amber-100 rounded-full h-1.5">
                  <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${Math.min(100, coughFrequency * 5)}%` }} />
                </div>
                <p className="text-[10px] text-amber-600 mt-1">{coughFrequency} events/hr</p>
              </div>
            </div>
            {/* Waveform */}
            <div className="mt-3 bg-slate-900 rounded-xl p-2.5 flex items-center gap-0.5 overflow-hidden">
              {[6,10,16,8,22,6,28,12,20,6,16,26,8,18,6,12,24,8,16,10,22,6,14,28,8,20,6,16,12,24,6,10].map((h, i) => (
                <div key={i} className="flex-1 bg-violet-400 rounded-full opacity-80" style={{ height: `${h}px` }} />
              ))}
            </div>
          </div>
        </div>

        {/* Risk Trend */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-red-500" />
              <p className="text-blue-900 font-bold text-sm">Risk Score Trend</p>
              <span className="ml-auto text-xs bg-red-100 text-red-700 font-bold px-2 py-0.5 rounded-full">{riskScore}% ↑</span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={riskSeries} margin={{ top: 5, right: 2, left: -28, bottom: 0 }}>
                <defs>
                  <linearGradient id="rg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 8, fill: "#94A3B8" }} tickLine={false} axisLine={false} interval={1} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 8, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v: any) => [`${v}%`, "Risk"]} />
                <ReferenceLine y={75} stroke="#F59E0B" strokeDasharray="3 3" strokeWidth={1.5} />
                <Area type="monotone" dataKey="r" stroke="#EF4444" strokeWidth={2.5} fill="url(#rg)" dot={false} activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
              {[{ l: "Low", r: "0–40%", c: "emerald" }, { l: "Moderate", r: "41–75%", c: "amber" }, { l: "Critical", r: "76–100%", c: "red", active: true }].map((s) => (
                <div key={s.l} className={`rounded-xl py-1.5 bg-${s.c}-50 ${s.active ? `ring-2 ring-${s.c}-300` : ""}`}>
                  <p className="text-[10px] text-slate-400">{s.l}</p>
                  <p className={`text-xs font-bold text-${s.c}-700`}>{s.r}</p>
                </div>
              ))}
            </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   PATIENTS VIEW
──────────────────────────────────────────────────────────── */
function PatientsView({ patients, onAddPatient, isAddingPatient, onDownloadPatientForm, downloadingPatientId }: any) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAddPatientForm, setShowAddPatientForm] = useState(false);
  const [addPatientError, setAddPatientError] = useState("");
  const [addPatientForm, setAddPatientForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    condition: "Respiratory monitoring",
    gender: "",
    dob: "",
    status: "stable",
  });

  const filtered = patients.filter((p: any) => {
    const matchS = p.name.toLowerCase().includes(search.toLowerCase()) || p.id.includes(search);
    const matchF = filter === "all" || p.status === filter;
    return matchS && matchF;
  });

  const updateAddPatientForm = (key: string, value: string) => {
    setAddPatientForm((previous) => ({ ...previous, [key]: value }));
  };

  const closeAddPatientModal = () => {
    if (isAddingPatient) return;
    setShowAddPatientForm(false);
    setAddPatientError("");
  };

  const resetAddPatientForm = () => {
    setAddPatientForm({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      condition: "Respiratory monitoring",
      gender: "",
      dob: "",
      status: "stable",
    });
  };

  const submitAddPatient = async () => {
    const payload = {
      firstName: addPatientForm.firstName.trim(),
      lastName: addPatientForm.lastName.trim(),
      email: addPatientForm.email.trim(),
      phone: addPatientForm.phone.trim(),
      condition: addPatientForm.condition.trim(),
      gender: addPatientForm.gender.trim(),
      dob: addPatientForm.dob,
      status: addPatientForm.status,
    };

    if (!payload.firstName || !payload.lastName || !payload.email) {
      setAddPatientError("First name, last name and email are required.");
      return;
    }

    setAddPatientError("");
    const created = await onAddPatient(payload);
    if (created) {
      resetAddPatientForm();
      setShowAddPatientForm(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-blue-900 font-bold">Patient Management</h2>
          <p className="text-slate-500 text-sm">{patients.length} patients · {patients.filter((p: any) => p.status === "critical").length} critical</p>
        </div>
        <button
          onClick={() => {
            setAddPatientError("");
            setShowAddPatientForm(true);
          }}
          disabled={isAddingPatient}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-md shadow-blue-200 ${
            isAddingPatient ? "bg-blue-400 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          <Plus className="w-4 h-4" /> {isAddingPatient ? "Adding..." : "Add Patient"}
        </button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <div className="flex items-center gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or ID…"
              className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-400 transition-all" />
          </div>
          {["all", "critical", "warning", "stable"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize transition-all ${
                filter === f
                  ? f === "critical" ? "bg-red-600 text-white" : f === "warning" ? "bg-amber-500 text-white" : f === "stable" ? "bg-emerald-600 text-white" : "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}>{f}</button>
          ))}
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>{["Patient", "Condition", "SpO₂", "HR", "AI Risk", "Status", "Upload"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((pt: any) => (
                <>
                  <tr key={pt.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setExpanded(expanded === pt.id ? null : pt.id)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${riskBg(pt.risk)}`}>
                          {pt.name.split(" ").map((n: string) => n[0]).join("")}
                        </div>
                        <div>
                          <p className="font-semibold text-slate-800">{pt.name}</p>
                          <p className="text-xs text-slate-400">{pt.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 max-w-[130px] truncate">{pt.condition}</td>
                    <td className="px-4 py-3 font-bold text-sm" style={{ color: pt.spo2 < 90 ? "#DC2626" : pt.spo2 < 94 ? "#D97706" : "#059669" }}>{formatPercent2(pt.spo2)}</td>
                    <td className="px-4 py-3 text-sm font-semibold text-slate-700">{formatWithUnit2(pt.hr, "bpm")}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-14 bg-slate-100 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${riskBg(pt.risk)}`} style={{ width: `${pt.risk}%` }} />
                        </div>
                        <span className={`text-xs font-bold ${riskColor(pt.risk)}`}>{pt.risk}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${statusBadge(pt.status)}`}>{pt.status}</span></td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          onDownloadPatientForm(pt);
                        }}
                        className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 hover:shadow-sm transition-all"
                      >
                        {downloadingPatientId === pt.id ? "Downloading..." : "Upload (PDF)"}
                      </button>
                      <p className="text-[10px] text-slate-400 mt-1">{pt.latestUploadName ? `Data sent: ${pt.latestUploadName}${pt.latestUploadAt ? ` · ${toDateLabel(pt.latestUploadAt)}` : ""}` : "Waiting for patient data"}</p>
                    </td>
                  </tr>
                  {expanded === pt.id && (
                    <tr key={`${pt.id}-exp`} className="bg-blue-50/30">
                      <td colSpan={7} className="px-4 py-4">
                        <div className="grid grid-cols-4 gap-3">
                          {[
                            { l: "HR (heart rate)", v: formatWithUnit2(pt.hr, "bpm") },
                            { l: "Status", v: pt.status },
                            { l: "Condition", v: pt.condition },
                            { l: "Upload", v: pt.latestUploadName ? `Data sent (${pt.latestUploadAt ? toDateLabel(pt.latestUploadAt) : "recent"})` : "Waiting for patient data" },
                          ].map(i => (
                            <div key={i.l} className="bg-white rounded-xl p-3 border border-slate-200">
                              <p className="text-xs text-slate-400">{i.l}</p>
                              <p className="text-sm font-bold text-slate-800 mt-0.5">{i.v}</p>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {!filtered.length && (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400 text-sm">No patients found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddPatientForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-blue-900 font-bold">Add New Patient</h3>
                <p className="text-xs text-slate-500 mt-0.5">Fill in patient identity and monitoring details.</p>
              </div>
              <button
                onClick={closeAddPatientModal}
                disabled={isAddingPatient}
                className={`p-1 rounded-lg ${isAddingPatient ? "text-slate-300 cursor-not-allowed" : "hover:bg-slate-100 text-slate-500"}`}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">First name *</p>
                <input
                  value={addPatientForm.firstName}
                  onChange={(event) => updateAddPatientForm("firstName", event.target.value)}
                  placeholder="Ex: Amina"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Last name *</p>
                <input
                  value={addPatientForm.lastName}
                  onChange={(event) => updateAddPatientForm("lastName", event.target.value)}
                  placeholder="Ex: Diallo"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Email *</p>
                <input
                  type="email"
                  value={addPatientForm.email}
                  onChange={(event) => updateAddPatientForm("email", event.target.value)}
                  placeholder="patient@email.com"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Phone</p>
                <input
                  value={addPatientForm.phone}
                  onChange={(event) => updateAddPatientForm("phone", event.target.value)}
                  placeholder="+33 ..."
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500 mb-1">Condition</p>
                <input
                  value={addPatientForm.condition}
                  onChange={(event) => updateAddPatientForm("condition", event.target.value)}
                  placeholder="Respiratory monitoring"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Gender</p>
                <select
                  value={addPatientForm.gender}
                  onChange={(event) => updateAddPatientForm("gender", event.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white"
                >
                  <option value="">Not set</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Date of birth</p>
                <input
                  type="date"
                  value={addPatientForm.dob}
                  onChange={(event) => updateAddPatientForm("dob", event.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
                />
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500 mb-1">Initial status</p>
                <div className="grid grid-cols-4 gap-2">
                  {["stable", "moderate", "warning", "critical"].map((status) => (
                    <button
                      key={status}
                      onClick={() => updateAddPatientForm("status", status)}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold capitalize border transition-all ${
                        addPatientForm.status === status
                          ? status === "critical"
                            ? "bg-red-600 border-red-600 text-white"
                            : status === "warning"
                              ? "bg-amber-500 border-amber-500 text-white"
                              : status === "moderate"
                                ? "bg-orange-500 border-orange-500 text-white"
                                : "bg-emerald-600 border-emerald-600 text-white"
                          : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-between gap-2">
              <p className="text-xs text-slate-500">Temporary password is auto-generated by backend.</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    resetAddPatientForm();
                    closeAddPatientModal();
                  }}
                  disabled={isAddingPatient}
                  className={`px-4 py-2.5 rounded-xl border text-sm font-medium ${isAddingPatient ? "border-slate-100 text-slate-300 cursor-not-allowed" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  Cancel
                </button>
                <button
                  onClick={submitAddPatient}
                  disabled={isAddingPatient}
                  className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${isAddingPatient ? "bg-blue-400 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
                >
                  {isAddingPatient ? "Adding..." : "Create Patient"}
                </button>
              </div>
            </div>

            {addPatientError && (
              <div className="px-5 pb-4">
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">{addPatientError}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   AI INSIGHTS VIEW
──────────────────────────────────────────────────────────── */
function AIInsightsView({
  patients,
  knowledgeSources,
  selectedPatient,
  setSelectedPatient,
  patientDetails,
  aiInsights,
  onRunManualInsights,
  onSendResultsToPatient,
  runningManualInsights,
  sendingResults,
}: any) {
  const [manualForm, setManualForm] = useState<any>(() => createManualIntakeForm());
  const [manualFormErrors, setManualFormErrors] = useState<Record<string, Record<string, string>>>(EMPTY_MANUAL_ERRORS);

  useEffect(() => {
    const latestVital = patientDetails?.latestVital || {};
    const hourFromAdmission = computeAdmissionHours(patientDetails?.profile?.admittedAt);
    const comorbidityIndex = patientDetails?.profile?.comorbidityIndex ?? patientDetails?.profile?.charlsonIndex ?? "";
    const patientAge = selectedPatient?.age ?? patientDetails?.profile?.age ?? "";
    const patientGender = patientDetails?.profile?.gender || selectedPatient?.gender || "";

    setManualForm(createManualIntakeForm({
      patientId: selectedPatient?.id || "",
      hourFromAdmission,
      age: patientAge,
      gender: patientGender,
      comorbidityIndex,
      latestVital,
    }));
    setManualFormErrors(EMPTY_MANUAL_ERRORS);
  }, [selectedPatient?.id, patientDetails]);

  const clearManualError = (section: "apnea" | "spo2" | "audio", field: string) => {
    setManualFormErrors((previous) => {
      if (!previous?.[section]?.[field]) return previous;
      const nextSectionErrors = { ...previous[section] };
      delete nextSectionErrors[field];
      return { ...previous, [section]: nextSectionErrors };
    });
  };

  const updateSpo2Field = (field: string, value: string) => {
    setManualForm((previous: any) => ({
      ...previous,
      spo2: { ...previous.spo2, [field]: value },
    }));
    clearManualError("spo2", field);
  };

  const updateApneaFile = (field: string, file: File | null) => {
    setManualForm((previous: any) => ({
      ...previous,
      apnea: { ...previous.apnea, [field]: file },
    }));
    clearManualError("apnea", field);
  };

  const updateAudioFiles = (files: FileList | null) => {
    const wavFiles = files ? Array.from(files) : [];
    setManualForm((previous: any) => ({
      ...previous,
      audio: { ...previous.audio, wav_files: wavFiles },
    }));
    clearManualError("audio", "wav_files");
  };

  const runApneaModel = async () => {
    const validation = validateApneaFiles(manualForm);
    setManualFormErrors((previous) => ({ ...previous, apnea: validation.errors }));
    if (!validation.isValid) return;

    const formData = new FormData();
    formData.append("model", AI_MODEL_KEYS.apnea);
    formData.append("apn_file", manualForm.apnea.apn);
    formData.append("dat_file", manualForm.apnea.dat);
    formData.append("hea_file", manualForm.apnea.hea);

    await onRunManualInsights({ target: AI_MODEL_KEYS.apnea, body: formData });
  };

  const runSpo2Model = async () => {
    const validation = validateSpo2Form(manualForm);
    setManualFormErrors((previous) => ({ ...previous, spo2: validation.errors }));
    if (!validation.isValid) return;

    await onRunManualInsights({
      target: AI_MODEL_KEYS.spo2,
      body: { model: AI_MODEL_KEYS.spo2, ...validation.payload },
    });
  };

  const runAudioModel = async () => {
    const validation = validateAudioFiles(manualForm);
    setManualFormErrors((previous) => ({ ...previous, audio: validation.errors }));
    if (!validation.isValid) return;

    const formData = new FormData();
    formData.append("model", AI_MODEL_KEYS.audio);
    manualForm.audio.wav_files.forEach((file: File) => {
      formData.append("wav_files", file);
    });

    await onRunManualInsights({ target: AI_MODEL_KEYS.audio, body: formData });
  };

  const runAllModels = async () => {
    const apneaValidation = validateApneaFiles(manualForm);
    const spo2Validation = validateSpo2Form(manualForm);
    const audioValidation = validateAudioFiles(manualForm);

    setManualFormErrors({
      apnea: apneaValidation.errors,
      spo2: spo2Validation.errors,
      audio: audioValidation.errors,
    });

    if (!apneaValidation.isValid || !spo2Validation.isValid || !audioValidation.isValid) return;

    const formData = new FormData();
    formData.append("model", AI_MODEL_KEYS.all);
    formData.append("spo2_payload", JSON.stringify({
      model: AI_MODEL_KEYS.spo2,
      ...spo2Validation.payload,
    }));
    formData.append("apn_file", manualForm.apnea.apn);
    formData.append("dat_file", manualForm.apnea.dat);
    formData.append("hea_file", manualForm.apnea.hea);
    manualForm.audio.wav_files.forEach((file: File) => {
      formData.append("wav_files", file);
    });

    await onRunManualInsights({ target: AI_MODEL_KEYS.all, body: formData });
  };

  const isRunningApnea = Boolean(runningManualInsights?.[AI_MODEL_KEYS.apnea]);
  const isRunningSpo2 = Boolean(runningManualInsights?.[AI_MODEL_KEYS.spo2]);
  const isRunningAudio = Boolean(runningManualInsights?.[AI_MODEL_KEYS.audio]);
  const isRunningAll = Boolean(runningManualInsights?.[AI_MODEL_KEYS.all]);
  const isRunningAny = Boolean(isRunningApnea || isRunningSpo2 || isRunningAudio || isRunningAll);

  const latestRisk = aiInsights || patientDetails?.latestRisk;
  const latestVital = patientDetails?.latestVital;
  const latestEnvironment = patientDetails?.latestEnvironment;
  const modelOutputs = aiInsights?.modelOutputs ? Object.values(aiInsights.modelOutputs) : [];
  const ragSources = aiInsights?.rag?.sources || [];
  const ragExplanation = aiInsights?.rag?.explanation || "No RAG explanation available for this patient yet.";
  const [showAllKnowledgeSources, setShowAllKnowledgeSources] = useState(false);

  const maxVisibleSources = 6;
  const maxSourceTextLength = 180;

  const normalizeSource = (item: any, origin: "rag" | "knowledge", index: number) => {
    const rawRelevance = Number(item?.relevance ?? 0);
    const relevance = rawRelevance <= 1 ? Math.round(rawRelevance * 100) : Math.round(rawRelevance);
    return {
      badge: String(item?.badge || item?.source || `SRC-${index + 1}`),
      reference: String(item?.reference || item?.source || "Clinical guideline"),
      text: String(item?.text || item?.snippet || "Clinical excerpt unavailable."),
      relevance: Math.max(0, Math.min(100, Number.isFinite(relevance) ? relevance : 0)),
      origin,
    };
  };

  const mergedKnowledgeSources = useMemo(() => {
    const normalized = [
      ...(Array.isArray(ragSources) ? ragSources : []).map((item: any, index: number) => normalizeSource(item, "rag", index)),
      ...(Array.isArray(knowledgeSources) ? knowledgeSources : []).map((item: any, index: number) => normalizeSource(item, "knowledge", index)),
    ];

    const dedupe = new Set<string>();
    const unique = normalized.filter((item) => {
      const key = `${item.reference.toLowerCase()}::${item.text.toLowerCase().slice(0, 120)}`;
      if (dedupe.has(key)) return false;
      dedupe.add(key);
      return true;
    });

    return unique.sort((a, b) => {
      if (a.origin !== b.origin) return a.origin === "rag" ? -1 : 1;
      return b.relevance - a.relevance;
    });
  }, [ragSources, knowledgeSources]);

  const visibleKnowledgeSources = showAllKnowledgeSources
    ? mergedKnowledgeSources
    : mergedKnowledgeSources.slice(0, maxVisibleSources);

  const toCompactText = (text: string) => {
    if (showAllKnowledgeSources || text.length <= maxSourceTextLength) return text;
    return `${text.slice(0, maxSourceTextLength).trimEnd()}...`;
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-blue-900 font-bold">AI Insights & RAG Explainability</h2>
        <p className="text-slate-500 text-sm">Multimodal predictions · Retrieval-Augmented Generation · Clinical Guidelines</p>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Patients</p>
        <div className="flex flex-wrap gap-2">
          {patients.map((patient: any) => (
            <button
              key={patient.id}
              onClick={() => setSelectedPatient(patient)}
              className={`px-3 py-2 rounded-xl text-sm font-medium transition-all ${selectedPatient?.id === patient.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
            >
              {patient.name} ({patient.id})
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-blue-900 font-bold text-sm mb-3">Manual Input Form (Multi-Model Schema)</h3>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-blue-900 font-bold text-sm">Model 1 · CNN-BiLSTM Apnea Signals</p>
                <p className="text-xs text-slate-500">Inputs: .apn, .dat, .hea files</p>
              </div>
              <button
                onClick={runApneaModel}
                disabled={isRunningApnea || isRunningAll || !selectedPatient?.id}
                className={`px-3 py-2 rounded-xl text-xs font-semibold ${isRunningApnea || isRunningAll ? "bg-blue-300 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                {isRunningApnea ? "Running..." : "Run AI + RAG"}
              </button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {CNN_BILSTM_FILE_FIELDS.map((field) => (
                <div key={field.key}>
                  <p className="text-xs text-slate-500 mb-1">{field.label}</p>
                  <input
                    type="file"
                    accept={field.accept}
                    onChange={(event) => updateApneaFile(field.key, event.target.files?.[0] ?? null)}
                    className={`w-full border rounded-xl px-3 py-2 text-xs ${manualFormErrors.apnea?.[field.key] ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}
                  />
                  {manualForm?.apnea?.[field.key] && (
                    <p className="text-[11px] text-slate-500 mt-1 truncate">Selected: {manualForm.apnea[field.key].name}</p>
                  )}
                  {manualFormErrors.apnea?.[field.key] && (
                    <p className="text-[11px] text-red-600 mt-1">{manualFormErrors.apnea[field.key]}</p>
                  )}
                </div>
              ))}
            </div>
            {Object.keys(manualFormErrors.apnea || {}).length > 0 && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-red-700 mb-1">Fix missing apnea signal files.</p>
                <ul className="list-disc pl-4 text-[11px] text-red-700 space-y-0.5">
                  {Object.entries(manualFormErrors.apnea || {}).map(([field, error]) => {
                    const label = CNN_BILSTM_FILE_FIELDS.find((item) => item.key === field)?.label || field;
                    return <li key={field}>{label}: {error}</li>;
                  })}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-blue-900 font-bold text-sm">Model 2 · LSTM SpO2 Deterioration</p>
                <p className="text-xs text-slate-500">Tabular features · Target: deterioration_next_12h</p>
                <p className="text-[11px] text-slate-400 mt-1">Auto-filled: patient_id, hour_from_admission, age, gender, comorbidity_index</p>
              </div>
              <button
                onClick={runSpo2Model}
                disabled={isRunningSpo2 || isRunningAll || !selectedPatient?.id}
                className={`px-3 py-2 rounded-xl text-xs font-semibold ${isRunningSpo2 || isRunningAll ? "bg-blue-300 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                {isRunningSpo2 ? "Running..." : "Run AI + RAG"}
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Auto-filled fields</p>
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  {SPO2_AUTO_FIELDS.map((field) => {
                    const bounds = SPO2_NUMERIC_RULES[field];
                    const isGender = field === "gender";
                    const isPatientId = field === "patient_id";
                    return (
                      <div key={field}>
                        <p className="text-xs text-slate-500 mb-1">
                          {SPO2_FIELD_LABELS[field]}
                          <span className="text-[10px] text-emerald-600 font-semibold uppercase ml-1">Auto</span>
                        </p>
                        {isGender ? (
                          <select
                            value={manualForm?.spo2?.gender || ""}
                            onChange={(event) => updateSpo2Field("gender", event.target.value)}
                            className={`w-full border rounded-xl px-3 py-2 text-sm ${manualFormErrors.spo2?.gender ? "border-red-300 bg-red-50" : "border-slate-200"}`}
                          >
                            <option value="">Select</option>
                            {GENDER_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={isPatientId ? "text" : "number"}
                            {...(!isPatientId && bounds ? { min: bounds.min, max: bounds.max, step: bounds.step || "1" } : {})}
                            value={manualForm?.spo2?.[field] ?? ""}
                            onChange={(event) => updateSpo2Field(field, event.target.value)}
                            className={`w-full border rounded-xl px-3 py-2 text-sm ${manualFormErrors.spo2?.[field] ? "border-red-300 bg-red-50" : "border-slate-200"}`}
                          />
                        )}
                        {manualFormErrors.spo2?.[field] && (
                          <p className="text-[11px] text-red-600 mt-1">{manualFormErrors.spo2[field]}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wide mb-2">Clinical measurements</p>
                <div className="grid grid-cols-4 gap-3">
                  {SPO2_MANUAL_FIELDS.map((field) => (
                    <div key={field}>
                      <p className="text-xs text-slate-500 mb-1">{SPO2_FIELD_LABELS[field]}</p>
                      <input
                        type="number"
                        min={SPO2_NUMERIC_RULES[field].min}
                        max={SPO2_NUMERIC_RULES[field].max}
                        step={SPO2_NUMERIC_RULES[field].step || "1"}
                        value={manualForm?.spo2?.[field] ?? ""}
                        onChange={(event) => updateSpo2Field(field, event.target.value)}
                        className={`w-full border rounded-xl px-3 py-2 text-sm ${manualFormErrors.spo2?.[field] ? "border-red-300 bg-red-50" : "border-slate-200"}`}
                      />
                      {manualFormErrors.spo2?.[field] && (
                        <p className="text-[11px] text-red-600 mt-1">{manualFormErrors.spo2[field]}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {Object.keys(manualFormErrors.spo2 || {}).length > 0 && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-red-700 mb-1">Fix input errors before running the LSTM model.</p>
                <ul className="list-disc pl-4 text-[11px] text-red-700 space-y-0.5">
                  {Object.entries(manualFormErrors.spo2 || {}).map(([field, error]) => (
                    <li key={field}>{SPO2_FIELD_LABELS[field] || field}: {error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <p className="text-blue-900 font-bold text-sm">Model 3 · Respiratory Audio Spectrograms</p>
                <p className="text-xs text-slate-500">Input: .wav files (spectrograms generated server-side)</p>
              </div>
              <button
                onClick={runAudioModel}
                disabled={isRunningAudio || isRunningAll || !selectedPatient?.id}
                className={`px-3 py-2 rounded-xl text-xs font-semibold ${isRunningAudio || isRunningAll ? "bg-blue-300 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}
              >
                {isRunningAudio ? "Running..." : "Run AI + RAG"}
              </button>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">WAV files</p>
              <input
                type="file"
                accept=".wav"
                multiple
                onChange={(event) => updateAudioFiles(event.target.files)}
                className={`w-full border rounded-xl px-3 py-2 text-xs ${manualFormErrors.audio?.wav_files ? "border-red-300 bg-red-50" : "border-slate-200 bg-white"}`}
              />
              {manualForm?.audio?.wav_files?.length > 0 && (
                <div className="mt-1 text-[11px] text-slate-500 space-y-0.5">
                  {manualForm.audio.wav_files.slice(0, 3).map((file: File) => (
                    <p key={file.name}>• {file.name}</p>
                  ))}
                  {manualForm.audio.wav_files.length > 3 && (
                    <p>+{manualForm.audio.wav_files.length - 3} more files</p>
                  )}
                </div>
              )}
              {manualFormErrors.audio?.wav_files && (
                <p className="text-[11px] text-red-600 mt-1">{manualFormErrors.audio.wav_files}</p>
              )}
            </div>
            {Object.keys(manualFormErrors.audio || {}).length > 0 && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-red-700 mb-1">Fix missing audio files.</p>
                <ul className="list-disc pl-4 text-[11px] text-red-700 space-y-0.5">
                  {Object.entries(manualFormErrors.audio || {}).map(([field, error]) => (
                    <li key={field}>WAV files: {error}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={runAllModels}
            disabled={isRunningAny || !selectedPatient?.id}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${isRunningAny ? "bg-indigo-300 text-white cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-700"}`}
          >
            {isRunningAll ? "Running all..." : "Run AI + RAG (All Models)"}
          </button>
          <button
            onClick={onSendResultsToPatient}
            disabled={sendingResults || !selectedPatient?.id}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${sendingResults ? "bg-emerald-400 text-white cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}
          >
            {sendingResults ? "Sending..." : "Send Result To Patient"}
          </button>
        </div>
      </div>
      {latestRisk ? (
        <AIRiskWidget
          risk={latestRisk}
          latestVital={latestVital}
          latestEnvironment={latestEnvironment}
          patientCondition={selectedPatient?.condition}
          patientName={selectedPatient?.name}
        />
      ) : (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">AI Risk Assessment</p>
          <p className="text-sm text-slate-600">Run AI + RAG to generate a patient-specific risk assessment.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        {modelOutputs.map((output: any) => (
          <div key={output.label} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <p className="text-blue-900 font-bold text-sm">{output.label}</p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full border capitalize ${statusBadge(output.status)}`}>{output.status}</span>
            </div>
            <p className="text-2xl font-black text-slate-800">{output.score}%</p>
            <p className="text-xs text-slate-500 mt-1">{output.details}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <h3 className="text-blue-900 font-bold text-sm">RAG Summary From Uploaded Patient Data</h3>
        </div>
        <p className="text-slate-700 text-sm bg-slate-50 border border-slate-200 rounded-xl p-3">{ragExplanation}</p>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-4 h-4 text-indigo-600" />
          <h3 className="text-blue-900 font-bold text-sm">Retrieved Clinical Knowledge Base</h3>
          <span className="ml-auto text-xs bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">{mergedKnowledgeSources.length} sources</span>
        </div>
        <div className="space-y-3">
          {mergedKnowledgeSources.length === 0 && (
            <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-4">
              No guideline sources available yet.
            </div>
          )}
          {visibleKnowledgeSources.map((item: any, index: number) => (
            <div key={`${item.badge || "source"}-${index}`} className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="bg-blue-700 text-white text-xs font-black px-2 py-1 rounded-lg flex-shrink-0">{item.badge}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${item.origin === "rag" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                    {item.origin === "rag" ? "Used in prediction" : "Knowledge base"}
                  </span>
                </div>
                <p className="text-slate-700 text-sm leading-relaxed">{toCompactText(item.text)}</p>
                <div className="flex items-center gap-3 mt-2">
                  <div className="flex items-center gap-1">
                    <BookOpen className="w-3 h-3 text-slate-400" />
                    <span className="text-slate-400 text-xs">{item.reference}</span>
                  </div>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <span className="text-xs text-emerald-600 font-semibold">{item.relevance}% relevance</span>
                    <div className="w-12 bg-slate-200 rounded-full h-1">
                      <div className="bg-emerald-500 h-1 rounded-full" style={{ width: `${item.relevance}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {mergedKnowledgeSources.length > maxVisibleSources && (
            <div className="pt-1">
              <button
                onClick={() => setShowAllKnowledgeSources((previous) => !previous)}
                className="text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-3 py-1.5"
              >
                {showAllKnowledgeSources
                  ? `Show less (${maxVisibleSources} key sources)`
                  : `Show more (${mergedKnowledgeSources.length - maxVisibleSources} more sources)`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   ANALYTICS VIEW
──────────────────────────────────────────────────────────── */
function AnalyticsView({ patients, weeklyData, metrics }: any) {
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-blue-900 font-bold">Clinical Analytics</h2>
          <p className="text-slate-500 text-sm">Week of {toDateLabel(weekStart.toISOString())}–{toDateLabel(now.toISOString())}</p>
        </div>
        <button className="flex items-center gap-2 text-sm text-slate-600 bg-white border border-slate-200 px-4 py-2.5 rounded-xl hover:bg-slate-50 font-medium shadow-sm">
          <Download className="w-4 h-4" /> Export
        </button>
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Alerts", value: String(metrics.totalAlerts), change: "Live", color: "blue", icon: Bell },
          { label: "Critical Events", value: String(metrics.criticalEvents), change: "Live", color: "red", icon: AlertTriangle },
          { label: "Resolved", value: String(metrics.resolved), change: "Live", color: "emerald", icon: CheckCircle2 },
          { label: "Avg Response", value: metrics?.avgResponseMinutes ? `${metrics.avgResponseMinutes}m` : "--", change: "Derived", color: "violet", icon: Clock },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className={`w-10 h-10 rounded-xl bg-${k.color}-100 flex items-center justify-center`}>
                <k.icon className={`w-5 h-5 text-${k.color}-600`} />
              </div>
              <span className={`text-xs font-semibold text-${k.color}-600 bg-${k.color}-50 px-2 py-0.5 rounded-full`}>{k.change}</span>
            </div>
            <p className="text-3xl font-black text-slate-800 mb-1">{k.value}</p>
            <p className="text-slate-400 text-xs">{k.label}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-blue-900 font-bold text-sm mb-4">Weekly Alert Overview</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={weeklyData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} tickLine={false} axisLine={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="alerts" name="Total Alerts" fill="#3B82F6" radius={[4, 4, 0, 0]} />
            <Bar dataKey="resolved" name="Resolved" fill="#10B981" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-blue-900 font-bold text-sm mb-4">Patient Risk Distribution</h3>
        <div className="space-y-3">
          {patients.map((p: any) => (
            <div key={p.id} className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-700 w-28 truncate">{p.name.split(" ")[0]}</span>
              <div className="flex-1 bg-slate-100 rounded-full h-2.5">
                <div className={`h-2.5 rounded-full ${riskBg(p.risk)} transition-all`} style={{ width: `${p.risk}%` }} />
              </div>
              <span className={`text-sm font-bold w-10 text-right ${riskColor(p.risk)}`}>{p.risk}%</span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${statusBadge(p.status)}`}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   REPORTS VIEW
──────────────────────────────────────────────────────────── */
function ReportsView({
  reports,
  patients,
  selectedPatient,
  onGenerateReport,
  isGeneratingReport,
  onOpenReport,
  reportDetails,
  isLoadingReportDetails,
  onCloseReportDetails,
  onDownloadReport,
  isDownloadingReport,
}: any) {
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [formState, setFormState] = useState({
    type: "Daily",
    title: "",
    patientIdentifier: selectedPatient?.id || "",
    periodStart: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    periodEnd: new Date().toISOString().slice(0, 10),
    summary: "",
    notes: "",
    includeVitals: true,
    includeAlerts: true,
    includeConsultations: true,
  });

  const updateFormState = (key: string, value: any) => {
    setFormState((previous) => ({ ...previous, [key]: value }));
  };

  const submitGenerateForm = async () => {
    await onGenerateReport({
      ...formState,
      patientIdentifier: formState.patientIdentifier || undefined,
      periodStart: formState.periodStart ? new Date(`${formState.periodStart}T00:00:00`).toISOString() : undefined,
      periodEnd: formState.periodEnd ? new Date(`${formState.periodEnd}T23:59:59`).toISOString() : undefined,
    });
    setShowGenerateForm(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-blue-900 font-bold">Clinical Reports</h2>
          <p className="text-slate-500 text-sm">{reports.length} reports</p>
        </div>
        <button
          onClick={() => setShowGenerateForm(true)}
          disabled={isGeneratingReport}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-md shadow-blue-200 ${
            isGeneratingReport ? "bg-blue-400 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          <Plus className="w-4 h-4" /> {isGeneratingReport ? "Generating..." : "Generate"}
        </button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {reports.map((r: any) => (
          <div key={r.id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              r.type === "Daily" ? "bg-blue-100" : r.type === "Weekly" ? "bg-violet-100" : r.type === "Patient" ? "bg-emerald-100" : "bg-amber-100"
            }`}>
              <FileText className={`w-5 h-5 ${r.type === "Daily" ? "text-blue-600" : r.type === "Weekly" ? "text-violet-600" : r.type === "Patient" ? "text-emerald-600" : "text-amber-600"}`} />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-slate-800 text-sm">{r.title}</p>
              <p className="text-xs text-slate-400 mt-0.5">{r.date}{r.patientName ? ` · ${r.patientName}` : ""}</p>
            </div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{r.type}</span>
            <div className="flex gap-1">
              <button onClick={() => onOpenReport(r.id)} className="p-2 rounded-xl hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"><Eye className="w-4 h-4" /></button>
              <button onClick={() => onDownloadReport(r)} disabled={isDownloadingReport}
                className={`p-2 rounded-xl transition-colors ${isDownloadingReport ? "bg-slate-100 text-slate-300 cursor-not-allowed" : "hover:bg-emerald-50 text-slate-400 hover:text-emerald-600"}`}>
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showGenerateForm && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-2xl">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-blue-900 font-bold">Generate Report</h3>
              <button onClick={() => setShowGenerateForm(false)} className="p-1 rounded-lg hover:bg-slate-100"><X className="w-4 h-4 text-slate-500" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Type</p>
                <select value={formState.type} onChange={(event) => updateFormState("type", event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                  {[
                    "Daily",
                    "Weekly",
                    "Patient",
                    "Audit",
                    "Technical",
                  ].map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Patient (optional)</p>
                <select value={formState.patientIdentifier} onChange={(event) => updateFormState("patientIdentifier", event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white">
                  <option value="">All assigned patients</option>
                  {patients.map((patient: any) => (
                    <option key={patient.id} value={patient.id}>{patient.name} ({patient.id})</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500 mb-1">Title</p>
                <input value={formState.title} onChange={(event) => updateFormState("title", event.target.value)}
                  placeholder="Ex: Daily Respiratory Summary"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Period Start</p>
                <input type="date" value={formState.periodStart} onChange={(event) => updateFormState("periodStart", event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Period End</p>
                <input type="date" value={formState.periodEnd} onChange={(event) => updateFormState("periodEnd", event.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm" />
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-3">
                {[
                  { key: "includeVitals", label: "Include vitals" },
                  { key: "includeAlerts", label: "Include alerts" },
                  { key: "includeConsultations", label: "Include consultations" },
                ].map((option) => (
                  <label key={option.key} className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5">
                    <input type="checkbox" checked={Boolean((formState as any)[option.key])} onChange={(event) => updateFormState(option.key, event.target.checked)} />
                    {option.label}
                  </label>
                ))}
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500 mb-1">Summary (optional)</p>
                <textarea value={formState.summary} onChange={(event) => updateFormState("summary", event.target.value)} rows={3}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>
              <div className="col-span-2">
                <p className="text-xs text-slate-500 mb-1">Clinical Notes (optional)</p>
                <textarea value={formState.notes} onChange={(event) => updateFormState("notes", event.target.value)} rows={2}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm resize-none" />
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button onClick={() => setShowGenerateForm(false)} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={submitGenerateForm} disabled={isGeneratingReport}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${isGeneratingReport ? "bg-blue-400 text-white cursor-not-allowed" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                {isGeneratingReport ? "Generating..." : "Generate report"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reportDetails && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white rounded-2xl border border-slate-200 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-blue-900 font-bold">{reportDetails.title}</h3>
                <p className="text-xs text-slate-400 mt-0.5">{reportDetails.type} · {toDateLabel(reportDetails.generatedAt)}</p>
              </div>
              <button onClick={onCloseReportDetails} className="p-1 rounded-lg hover:bg-slate-100"><X className="w-4 h-4 text-slate-500" /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">
              {isLoadingReportDetails ? (
                <p className="text-slate-500 text-sm">Loading report details...</p>
              ) : (
                <>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                    <p className="text-xs text-slate-500 mb-1">Summary</p>
                    <p className="text-sm text-slate-700">{reportDetails.summary || "No summary provided."}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <p className="text-xs text-slate-500">Latest SpO₂</p>
                      <p className="text-sm font-bold text-slate-800">{formatPercent2(reportDetails.latestVital?.spo2)}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <p className="text-xs text-slate-500">Latest HR</p>
                      <p className="text-sm font-bold text-slate-800">{formatWithUnit2(reportDetails.latestVital?.hr, "bpm")}</p>
                    </div>
                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                      <p className="text-xs text-slate-500">Latest RR</p>
                      <p className="text-sm font-bold text-slate-800">{reportDetails.latestVital?.rr ?? "--"} br/min</p>
                    </div>
                  </div>
                  {reportDetails.alerts?.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Alerts</p>
                      <div className="space-y-2">
                        {reportDetails.alerts.map((alert: any) => (
                          <div key={alert._id} className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            <span className="font-semibold">[{alert.type?.toUpperCase()}]</span> {alert.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {reportDetails.consultations?.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-xl p-4">
                      <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Consultations</p>
                      <div className="space-y-2">
                        {reportDetails.consultations.map((consultation: any) => (
                          <div key={consultation._id} className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            <span className="font-semibold">{consultation.type}</span> · {toDateLabel(consultation.scheduledFor)} · {consultation.status}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-2">
              <button onClick={onCloseReportDetails} className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-medium hover:bg-slate-50">Close</button>
              <button onClick={() => onDownloadReport({ id: reportDetails._id, title: reportDetails.title })} disabled={isDownloadingReport}
                className={`px-4 py-2.5 rounded-xl text-sm font-semibold ${isDownloadingReport ? "bg-emerald-300 text-white cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-700"}`}>
                {isDownloadingReport ? "Downloading..." : "Download PDF"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   CONSULTATIONS VIEW
──────────────────────────────────────────────────────────── */
function ConsultationsView({ chats }: any) {
  const [sel, setSel] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const selectedChat = chats.find((chat: any) => chat.patientId === sel) || null;

  const loadMessages = async (patientId: string) => {
    setLoading(true);
    try {
      const payload = await apiRequest<any>(`/doctor/patient-chats/${encodeURIComponent(patientId)}/messages`, { auth: true });
      setMessages((payload?.messages || []).map((message: any) => ({
        from: message.role,
        text: message.text,
        time: toTimeLabel(message.createdAt),
      })));
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!sel || !chatInput.trim() || sending) return;
    const text = chatInput.trim();
    setChatInput("");
    setSending(true);
    try {
      await apiRequest(`/doctor/patient-chats/${encodeURIComponent(sel)}/messages`, {
        method: "POST",
        auth: true,
        body: { text },
      });
      await loadMessages(sel);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-blue-900 font-bold">Patient Chat</h2>
        <p className="text-slate-500 text-sm">Direct messaging with patients</p>
      </div>

      <div className="grid grid-cols-3 gap-5">
        <div className="col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Patients</p>
            <div className="text-[11px] text-slate-400">{chats.length} conversations</div>
          </div>
          {chats.map((chat: any) => (
            <button key={chat.patientId} onClick={() => { setSel(chat.patientId); loadMessages(chat.patientId); }}
              className={`w-full text-left px-4 py-3.5 hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-0 ${sel === chat.patientId ? "bg-blue-50 border-l-2 border-l-blue-600" : ""}`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
                  {chat.patientName.split(" ").map((word: string) => word[0]).join("").slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-800 text-sm truncate">{chat.patientName}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {chat.lastMessage?.from === "doctor" ? "You: " : ""}{chat.lastMessage?.text || "No messages"}
                  </p>
                </div>
                {chat.unread > 0 && (
                  <span className="text-[10px] bg-red-500 text-white font-bold px-1.5 py-0.5 rounded-full">{chat.unread}</span>
                )}
              </div>
            </button>
          ))}
        </div>
        <div className="col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-0 flex flex-col min-h-[520px] overflow-hidden">
          {!sel ? (
            <div className="h-full flex items-center justify-center text-slate-400">Select a patient to open chat.</div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-slate-100 bg-white flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-500 flex items-center justify-center text-xs font-bold text-white">
                  {selectedChat?.patientName?.split(" ").map((word: string) => word[0]).join("").slice(0, 2).toUpperCase() || "PT"}
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{selectedChat?.patientName || "Patient"}</p>
                  <p className="text-xs text-slate-400">Direct patient chat</p>
                </div>
              </div>

              <div className="flex-1 bg-slate-50 p-4 overflow-y-auto min-h-24 space-y-3">
                {loading ? (
                  <p className="text-sm text-slate-500">Loading messages...</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-slate-500">No messages yet.</p>
                ) : messages.map((m: any, i: number) => (
                  <div key={i} className={`flex ${m.from === "doctor" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-2xl px-3 py-2.5 text-sm shadow-sm ${m.from === "doctor" ? "bg-blue-600 text-white rounded-br-md" : "bg-white border border-slate-200 text-slate-700 rounded-bl-md"}`}>
                      {m.text}
                      <p className={`text-[10px] mt-0.5 ${m.from === "doctor" ? "text-blue-200" : "text-slate-400"}`}>{m.time}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 p-3 border-t border-slate-100 bg-white">
                <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && sendMessage()}
                  disabled={sending}
                  placeholder="Write a message..."
                  className={`flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm transition-all ${sending ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-white focus:outline-none focus:ring-2 focus:ring-blue-200"}`} />
                <button
                  onClick={sendMessage}
                  disabled={sending}
                  className={`p-2.5 rounded-xl transition-colors ${sending ? "bg-blue-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"}`}
                >
                  <Send className="w-4 h-4 text-white" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   MAIN DASHBOARD
──────────────���───────────────────────────────────────────── */
export function DoctorDashboard() {
  const navigate = useNavigate();
  const [activeNav, setActiveNav] = useState("Dashboard");
  const [patientsData, setPatientsData] = useState<any[]>(defaultPatients);
  const [selectedPatient, setSelectedPatient] = useState<any>(null);
  const [selectedPatientDetails, setSelectedPatientDetails] = useState<any>(null);
  const [spo2Series, setSpo2Series] = useState<any[]>(spo2Data);
  const [apneaSeries, setApneaSeries] = useState<any[]>(apneaData);
  const [riskSeries, setRiskSeries] = useState<any[]>(riskHistory);
  const [knowledgeSources, setKnowledgeSources] = useState<any[]>(defaultKnowledgeSources);
  const [consultationsData, setConsultationsData] = useState<any[]>(defaultConsultations);
  const [weeklyDataState, setWeeklyDataState] = useState<any[]>(defaultWeeklyData);
  const [reportsData, setReportsData] = useState<any[]>(defaultReports);
  const [activeReportDetails, setActiveReportDetails] = useState<any>(null);
  const [isLoadingReportDetails, setIsLoadingReportDetails] = useState(false);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [analyticsMetrics, setAnalyticsMetrics] = useState({ totalAlerts: 0, criticalEvents: 0, resolved: 0, avgResponseMinutes: null as number | null });
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [downloadingPatientId, setDownloadingPatientId] = useState<string | null>(null);
  const [runningManualInsights, setRunningManualInsights] = useState<Record<string, boolean>>(() => ({
    [AI_MODEL_KEYS.apnea]: false,
    [AI_MODEL_KEYS.spo2]: false,
    [AI_MODEL_KEYS.audio]: false,
    [AI_MODEL_KEYS.all]: false,
  }));
  const [sendingResults, setSendingResults] = useState(false);
  const [actionLoading, setActionLoading] = useState({
    validateRisk: false,
    dismissRisk: false,
    generateReport: false,
    scheduleConsultation: false,
    addPatient: false,
    consultationNote: false,
  });
  const [lastUpdated, setLastUpdated] = useState(toTimeLabel(new Date().toISOString()));
  const [showNotif, setShowNotif] = useState(false);
  const [dataError, setDataError] = useState("");
  const [notifs, setNotifs] = useState<any[]>([]);
  const [patientDataAlertCount, setPatientDataAlertCount] = useState(0);
  const [doctorIdentity, setDoctorIdentity] = useState({
    name: "Doctor",
    specialty: "Clinical Care",
    department: "Hospital",
  });

  const unread = useMemo(() => notifs.filter(n => !n.read).length, [notifs]);

  const setActionState = (key: keyof typeof actionLoading, value: boolean) => {
    setActionLoading((previous) => ({ ...previous, [key]: value }));
  };

  const loadSelectedPatientContext = async (patientIdentifier: string) => {
    const encodedPatientIdentifier = encodeURIComponent(patientIdentifier);

    const [patientPayload, vitalsPayload, risksPayload, insightsPayload] = await Promise.all([
      apiRequest<any>(`/doctor/patients/${encodedPatientIdentifier}`, { auth: true }),
      apiRequest<any>(`/doctor/patients/${encodedPatientIdentifier}/vitals?limit=24`, { auth: true }),
      apiRequest<any>(`/doctor/patients/${encodedPatientIdentifier}/risk-history?limit=24`, { auth: true }),
      apiRequest<any>(`/doctor/patients/${encodedPatientIdentifier}/ai-insights`, { auth: true }),
    ]);

    setSelectedPatientDetails(patientPayload?.patient || null);

    const mappedSpo2 = (vitalsPayload?.trend || [])
      .map((point: any) => ({ t: toTimeLabel(point?.timestamp), v: point?.spo2 }))
      .filter((point: any) => typeof point.v === "number");

    const mappedApnea = (vitalsPayload?.trend || [])
      .map((point: any) => ({ t: toTimeLabel(point?.timestamp), v: point?.apneaLevel }))
      .filter((point: any) => typeof point.v === "number");

    const mappedRisk = (risksPayload?.trend || [])
      .map((point: any) => ({ t: toTimeLabel(point?.createdAt), r: point?.score ?? 0 }))
      .filter((point: any) => typeof point.r === "number");

    setSpo2Series(mappedSpo2);
    setApneaSeries(mappedApnea);
    setRiskSeries(mappedRisk);
    setAiInsights(insightsPayload?.insights || null);
  };

  const loadDashboard = async () => {
    try {
      setDataError("");

      const [patientsPayload, notificationsPayload, consultationsPayload, analyticsPayload, reportsPayload, knowledgePayload, mePayload] = await Promise.all([
        apiRequest<any>("/doctor/patients", { auth: true }),
        apiRequest<any>("/doctor/notifications?limit=50", { auth: true }),
        apiRequest<any>("/doctor/patient-chats", { auth: true }),
        apiRequest<any>("/doctor/analytics/weekly", { auth: true }),
        apiRequest<any>("/doctor/reports", { auth: true }),
        apiRequest<any>("/doctor/knowledge-base", { auth: true }),
        apiRequest<any>("/auth/me", { auth: true }),
      ]);

      const mappedPatients = (patientsPayload?.patients || []).map((patient: any) => {
        const score = patient?.risk?.score ?? 0;

        return {
          id: patient.id,
          userId: patient.userId,
          name: patient.name,
          age: patient.age ?? null,
          condition: patient.condition || "--",
          risk: score,
          status: patient.status || "stable",
          spo2: patient?.vitals?.spo2 ?? null,
          hr: patient?.vitals?.hr ?? null,
          rr: patient?.vitals?.rr ?? null,
          last: toTimeLabel(patient?.vitals?.timestamp),
          latestUploadAt: patient?.latestUploadAt || null,
          latestUploadName: patient?.latestUploadName || "",
          color: score >= 75 ? "red" : score >= 50 ? "amber" : score >= 30 ? "orange" : "emerald",
        };
      });

      if (mappedPatients.length > 0) {
        const nextSelectedPatient = mappedPatients.find((patient: any) => patient.id === selectedPatient?.id) || mappedPatients[0];
        setPatientsData(mappedPatients);
        setSelectedPatient(nextSelectedPatient);
        await loadSelectedPatientContext(nextSelectedPatient.id);
      } else {
        setPatientsData([]);
        setSelectedPatient(null);
        setSelectedPatientDetails(null);
        setSpo2Series([]);
        setApneaSeries([]);
        setRiskSeries([]);
        setAiInsights(null);
      }

      const seenDoctorNotifKeys = new Set<string>();
      const patientFormUnreadCodes = new Set<string>();
      (notificationsPayload?.notifications || []).forEach((notification: any) => {
        if (notification?.metadata?.type === "patient-form" && !notification?.read) {
          patientFormUnreadCodes.add(String(notification?.metadata?.patientCode || notification?._id || ""));
        }
      });
      setPatientDataAlertCount(patientFormUnreadCodes.size);

      setNotifs((notificationsPayload?.notifications || [])
        .filter((notification: any) => notification?.metadata?.type === "patient-chat")
        .filter((notification: any) => {
          const key = String(notification?._id || `${notification?.metadata?.patientCode || ""}-${notification?.message || notification?.title || ""}-${notification?.createdAt || ""}`);
          if (seenDoctorNotifKeys.has(key)) return false;
          seenDoctorNotifKeys.add(key);
          return true;
        })
        .map((notification: any) => ({
          id: notification._id,
          text: notification.message || notification.title,
          time: toTimeLabel(notification.createdAt),
          type: notification.type || "info",
          read: notification.read,
        })));

      setConsultationsData(Array.isArray(consultationsPayload?.chats) ? consultationsPayload.chats : []);

      if (analyticsPayload?.weeklyOverview) {
        setWeeklyDataState(analyticsPayload.weeklyOverview);
      }

      if (analyticsPayload?.metrics) {
        setAnalyticsMetrics({
          totalAlerts: analyticsPayload.metrics.totalAlerts ?? 0,
          criticalEvents: analyticsPayload.metrics.criticalEvents ?? 0,
          resolved: analyticsPayload.metrics.resolved ?? 0,
          avgResponseMinutes: analyticsPayload.metrics.avgResponseMinutes ?? null,
        });
      }

      if (mePayload?.user) {
        const fullName = `${mePayload.user.firstName || ""} ${mePayload.user.lastName || ""}`.trim();
        setDoctorIdentity({
          name: fullName || mePayload.user.email || "Doctor",
          specialty: mePayload?.profile?.specialty || "Clinical Care",
          department: mePayload?.profile?.department || mePayload?.profile?.hospital || "Hospital",
        });
      }

      setReportsData((reportsPayload?.reports || []).map((report: any) => ({
        id: report._id,
        title: report.title,
        date: toDateLabel(report.generatedAt),
        type: report.type,
        status: report.status,
        summary: report.summary,
        patientName: report.patient ? `${report.patient.firstName} ${report.patient.lastName}` : "",
      })));

      setKnowledgeSources(Array.isArray(knowledgePayload?.sources) ? knowledgePayload.sources : []);

      setLastUpdated(toTimeLabel(new Date().toISOString()));
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to sync doctor dashboard.";
      setDataError(message);
    }
  };

  const markRead = async (id: string | number) => {
    setNotifs((previous) => previous.map((notification) => notification.id === id ? { ...notification, read: true } : notification));

    if (typeof id === "string") {
      try {
        await apiRequest(`/doctor/notifications/${id}/read`, { method: "PATCH", auth: true });
      } catch {
        // noop
      }
    }
  };

  const markAll = async () => {
    setNotifs((previous) => previous.map((notification) => ({ ...notification, read: true })));
    setPatientDataAlertCount(0);
    try {
      await apiRequest("/doctor/notifications/read-all", { method: "PATCH", auth: true });
    } catch {
      // noop
    }
  };

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== "doctor") {
      clearSession();
      navigate("/", { replace: true });
      return;
    }

    loadDashboard();
  }, [navigate]);

  useEffect(() => {
    if (!selectedPatient?.id) return;

    loadSelectedPatientContext(selectedPatient.id).catch(() => {
      // noop
    });
  }, [selectedPatient?.id]);

  const handleGenerateReport = async (payload?: any) => {
    if (actionLoading.generateReport) return;

    setActionState("generateReport", true);

    try {
      await apiRequest("/doctor/reports/generate", {
        method: "POST",
        auth: true,
        body: {
          type: payload?.type || "Daily",
          patientIdentifier: payload?.patientIdentifier || selectedPatient?.id,
          title: payload?.title || `${selectedPatient?.name || "Patient"} — Daily Clinical Summary`,
          summary: payload?.summary,
          periodStart: payload?.periodStart,
          periodEnd: payload?.periodEnd,
          includeVitals: payload?.includeVitals,
          includeAlerts: payload?.includeAlerts,
          includeConsultations: payload?.includeConsultations,
          notes: payload?.notes,
        },
      });
      await loadDashboard();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to generate report.";
      setDataError(message);
    } finally {
      setActionState("generateReport", false);
    }
  };

  const handleScheduleConsultation = async (payload?: any) => {
    if ((!selectedPatient?.id && !payload?.patientIdentifier) || actionLoading.scheduleConsultation) return;

    setActionState("scheduleConsultation", true);

    try {
      const scheduledFor = payload?.scheduledFor || new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await apiRequest("/doctor/consultations", {
        method: "POST",
        auth: true,
        body: {
          patientIdentifier: payload?.patientIdentifier || selectedPatient.id,
          scheduledFor,
          type: payload?.type || "Follow-up",
          status: payload?.status || "scheduled",
          channel: payload?.channel || "video",
        },
      });
      await loadDashboard();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to schedule consultation.";
      setDataError(message);
    } finally {
      setActionState("scheduleConsultation", false);
    }
  };

  const handleOpenReport = async (reportId: string) => {
    if (!reportId) return;

    setActiveReportDetails({ _id: reportId, title: "Loading report...", type: "Report", generatedAt: new Date().toISOString() });
    setIsLoadingReportDetails(true);
    try {
      const payload = await apiRequest<any>(`/doctor/reports/${reportId}`, { auth: true });
      setActiveReportDetails(payload?.report || null);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to open report.";
      setDataError(message);
    } finally {
      setIsLoadingReportDetails(false);
    }
  };

  const handleCloseReportDetails = () => {
    setActiveReportDetails(null);
  };

  const handleDownloadReport = async (report: { id: string; title?: string }) => {
    if (!report?.id || isDownloadingReport) return;

    const token = getToken();
    if (!token) return;

    setIsDownloadingReport(true);
    try {
      const response = await fetch(`${API_BASE_URL}/doctor/reports/${report.id}/pdf`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Unable to download report PDF.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${(report.title || "report").replace(/[^a-z0-9\-_. ]/gi, "").trim() || "report"}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to download report.";
      setDataError(message);
    } finally {
      setIsDownloadingReport(false);
    }
  };

  const handleAddConsultationNote = async (consultationId: string | number, text: string) => {
    if (actionLoading.consultationNote) return;

    setActionState("consultationNote", true);

    try {
      await apiRequest(`/doctor/consultations/${String(consultationId)}/notes`, {
        method: "POST",
        auth: true,
        body: { text },
      });
      await loadDashboard();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to save consultation note.";
      setDataError(message);
    } finally {
      setActionState("consultationNote", false);
    }
  };

  const handleAddPatient = async (payload?: any) => {
    if (actionLoading.addPatient) return false;

    const firstName = String(payload?.firstName || window.prompt("First name of the patient:") || "").trim();
    const lastName = String(payload?.lastName || window.prompt("Last name of the patient:") || "").trim();
    const email = String(payload?.email || window.prompt("Patient email address:") || "").trim();

    if (!firstName || !lastName || !email) {
      return false;
    }

    const phone = String(payload?.phone || "").trim();
    const condition = String(payload?.condition || "Respiratory monitoring").trim();
    const gender = String(payload?.gender || "").trim();
    const dob = payload?.dob ? String(payload.dob) : "";
    const status = String(payload?.status || "stable");

    setActionState("addPatient", true);

    try {
      await apiRequest("/doctor/patients", {
        method: "POST",
        auth: true,
        body: {
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          condition: condition || "Respiratory monitoring",
          gender: gender || undefined,
          dob: dob || undefined,
          status,
        },
      });
      await loadDashboard();
      setActiveNav("Patients");
      return true;
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to add patient.";
      setDataError(message);
      return false;
    } finally {
      setActionState("addPatient", false);
    }
  };

  const handleDownloadPatientForm = async (patient: any) => {
    if (!patient?.id || downloadingPatientId) return;

    setDownloadingPatientId(patient.id);
    try {
      const token = getToken();
      if (!token) {
        return;
      }

      const response = await fetch(`${API_BASE_URL}/doctor/patients/${encodeURIComponent(patient.id)}/intake-form/pdf`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        throw new Error("Unable to download patient form PDF.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${patient.id}-patient-form.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to download patient form.";
      setDataError(message);
    } finally {
      setDownloadingPatientId(null);
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const handleRunManualInsights = async (request: { target?: string; body?: any }) => {
    if (!selectedPatient?.id) return;

    const target = request?.target || AI_MODEL_KEYS.all;
    if (runningManualInsights?.[target]) return;

    setRunningManualInsights((previous) => ({ ...previous, [target]: true }));
    try {
      const endpoint = target === AI_MODEL_KEYS.all
        ? `/doctor/patients/${encodeURIComponent(selectedPatient.id)}/ai-insights/manual`
        : `/doctor/patients/${encodeURIComponent(selectedPatient.id)}/ai-insights/manual?model=${encodeURIComponent(target)}`;

      const payload = await apiRequest<any>(endpoint, {
        method: "POST",
        auth: true,
        body: request?.body ?? null,
      });
      setAiInsights(payload?.insights || null);
      await loadDashboard();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to run manual AI insights.";
      setDataError(message);
    } finally {
      setRunningManualInsights((previous) => ({ ...previous, [target]: false }));
    }
  };

  const handleSendResultsToPatient = async () => {
    if (!selectedPatient?.id || sendingResults) return;

    setSendingResults(true);
    try {
      await apiRequest(`/doctor/patients/${encodeURIComponent(selectedPatient.id)}/ai-insights/send-to-patient`, {
        method: "POST",
        auth: true,
      });
      await loadDashboard();
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to send AI results to patient.";
      setDataError(message);
    } finally {
      setSendingResults(false);
    }
  };

  const renderContent = () => {
    switch (activeNav) {
      case "Dashboard": return (
        <DashboardView
          patients={patientsData}
          selectedPatient={selectedPatient}
          setSelectedPatient={setSelectedPatient}
          patientDetails={selectedPatientDetails}
          spo2Series={spo2Series}
          apneaSeries={apneaSeries}
          riskSeries={riskSeries}
        />
      );
      case "Patients": return (
        <PatientsView
          patients={patientsData}
          onAddPatient={handleAddPatient}
          isAddingPatient={actionLoading.addPatient}
          onDownloadPatientForm={handleDownloadPatientForm}
          downloadingPatientId={downloadingPatientId}
        />
      );
      case "AI Insights": return (
        <AIInsightsView
          patients={patientsData}
          knowledgeSources={knowledgeSources}
          selectedPatient={selectedPatient}
          setSelectedPatient={setSelectedPatient}
          patientDetails={selectedPatientDetails}
          aiInsights={aiInsights}
          onRunManualInsights={handleRunManualInsights}
          onSendResultsToPatient={handleSendResultsToPatient}
          runningManualInsights={runningManualInsights}
          sendingResults={sendingResults}
        />
      );
      case "Patient Chat": return (
        <ConsultationsView
          chats={consultationsData}
        />
      );
      default: return null;
    }
  };

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      {/* ── SIDEBAR ── */}
      <aside className="w-60 bg-gradient-to-b from-blue-950 to-blue-900 flex flex-col shadow-2xl flex-shrink-0">
        <div className="flex items-center gap-3 px-5 py-5 border-b border-blue-800/50">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-cyan-400 flex items-center justify-center shadow-lg">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-black tracking-tight">Respir<span className="text-cyan-400">AI</span></span>
        </div>

        <div className="px-4 py-4 border-b border-blue-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 flex items-center justify-center flex-shrink-0">
              <Stethoscope className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{doctorIdentity.name}</p>
              <p className="text-blue-300 text-xs truncate">{doctorIdentity.specialty} · {doctorIdentity.department}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <button key={item.label} onClick={() => setActiveNav(item.label)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                activeNav === item.label ? "bg-blue-600 text-white shadow-md" : "text-blue-200 hover:bg-blue-800/60 hover:text-white"
              }`}>
              <item.icon className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium">{item.label}</span>
              {item.label === "Patients" && patientDataAlertCount > 0 && (
                <span className="ml-auto text-[10px] bg-red-500 text-white font-bold px-1.5 py-0.5 rounded-full">
                  {patientDataAlertCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-3 pb-5 space-y-1 border-t border-blue-800/40 pt-3">
          <button onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-blue-300 hover:bg-red-900/40 hover:text-red-300 transition-all text-left">
            <LogOut className="w-4 h-4" /><span className="text-sm font-medium">Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-3.5 flex items-center justify-between flex-shrink-0 shadow-sm">
          <div>
            <h1 className="text-blue-900 font-bold">{activeNav}</h1>
            <p className="text-slate-400 text-xs flex items-center gap-1.5 mt-0.5">
              <Clock className="w-3 h-3" /> Last updated: Today {lastUpdated}
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-emerald-700 text-xs font-semibold">All Sensors Online</span>
            </div>
            {/* Notif bell */}
            <div className="relative">
              <button onClick={() => setShowNotif(!showNotif)}
                className="relative w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <Bell className="w-4.5 h-4.5 text-slate-600" />
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">{unread}</span>
                )}
              </button>
              {showNotif && (
                <div className="absolute right-0 top-11 w-80 bg-white rounded-2xl border border-slate-200 shadow-2xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-sm">Notifications {unread > 0 && <span className="ml-1 text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5">{unread}</span>}</span>
                    <div className="flex items-center gap-2">
                      {unread > 0 && <button onClick={markAll} className="text-xs text-blue-600 font-medium hover:text-blue-700">Mark all read</button>}
                      <button onClick={() => setShowNotif(false)}><X className="w-3.5 h-3.5 text-slate-400" /></button>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {notifs.map(n => (
                      <div key={n.id} onClick={() => markRead(n.id)}
                        className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${!n.read ? "bg-blue-50/40" : ""}`}>
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.type === "critical" ? "bg-red-500" : n.type === "warning" ? "bg-amber-500" : "bg-blue-400"} ${!n.read ? "animate-pulse" : "opacity-40"}`} />
                        <div className="flex-1">
                          <p className={`text-sm ${!n.read ? "font-semibold text-slate-800" : "text-slate-600"}`}>{n.text}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{n.time}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-5 py-5" onClick={() => showNotif && setShowNotif(false)}>
          <div className="max-w-full mx-auto">
            {dataError && (
              <div className="mb-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {dataError}
              </div>
            )}
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  );
}

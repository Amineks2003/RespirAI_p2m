import { useEffect, useState } from "react";
import {
  Brain,
  CalendarClock,
  Database,
  Download,
  HeartPulse,
  Loader2,
} from "lucide-react";
import { API_BASE_URL, apiRequest } from "../lib/api";
import { getToken } from "../lib/session";

type FieldItem = {
  key: string;
  label: string;
  value: unknown;
  unit?: string;
};

const formatDateTime = (value?: string | Date | null) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatValue = (value: unknown, unit = "") => {
  if (value === undefined || value === null || value === "") return "--";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  const numericValue = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(numericValue) && String(value).trim?.() !== "") {
    const formatted = Number.isInteger(numericValue)
      ? String(numericValue)
      : numericValue.toFixed(2).replace(/\.00$/, "");
    return `${formatted}${unit ? ` ${unit}` : ""}`;
  }

  return `${String(value)}${unit ? ` ${unit}` : ""}`;
};

const getFirstValue = (...values: unknown[]) => {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "--";
};

const riskColor = (score: number) =>
  score >= 75 ? "text-red-600" : score >= 50 ? "text-amber-600" : "text-emerald-600";

const riskBadge = (score: number) =>
  score >= 75
    ? "bg-red-50 text-red-700 border-red-200"
    : score >= 50
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-emerald-50 text-emerald-700 border-emerald-200";

export function PatientDoctorAiData() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [doctorAiData, setDoctorAiData] = useState<any>(null);
  const [isDownloadingReport, setIsDownloadingReport] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  useEffect(() => {
    let active = true;

    const loadData = async () => {
      setLoading(true);
      setError("");

      try {
        const payload = await apiRequest<any>("/patient/me/doctor-ai-data", { auth: true });
        if (active) setDoctorAiData(payload?.doctorAiData || null);
      } catch (err: any) {
        if (active) setError(err?.message || "Unable to load doctor AI data.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadData();

    return () => {
      active = false;
    };
  }, []);

  const inputSnapshot = doctorAiData?.input || {};
  const input = inputSnapshot?.input || {};
  const sentResult = doctorAiData?.sentResult || {};
  const insights = doctorAiData?.insights || {};

  const score = Number(sentResult?.score ?? insights?.score ?? doctorAiData?.latestRisk?.score ?? 0);
  const confidence = Number(sentResult?.confidence ?? insights?.confidence ?? doctorAiData?.latestRisk?.confidence ?? 0);
  const patientId = getFirstValue(input.patient_id, inputSnapshot.patientId, doctorAiData?.patientId);
  const modelUsed = getFirstValue(inputSnapshot?.model, sentResult?.model, insights?.model);
  const analysisDate = getFirstValue(inputSnapshot?.usedAt, doctorAiData?.updatedAt, sentResult?.sentAt);

  const canDownloadReport = Boolean(sentResult?.sentAt || sentResult?.score || sentResult?.confidence);

  const handleDownloadReport = async () => {
    if (isDownloadingReport || !canDownloadReport) return;

    const token = getToken();
    if (!token) {
      setDownloadError("Session expired. Please sign in again.");
      return;
    }

    setDownloadError("");
    setIsDownloadingReport(true);
    try {
      const response = await fetch(`${API_BASE_URL}/patient/me/doctor-ai-report/pdf`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Unable to download the AI report PDF.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      const safeName = `${patientId || "patient"}`
        .replace(/[^a-z0-9\-_. ]/gi, "")
        .trim()
        || "patient";
      link.download = `${safeName}-ai-report.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err: any) {
      setDownloadError(err?.message || "Unable to download the AI report.");
    } finally {
      setIsDownloadingReport(false);
    }
  };

  const fields: FieldItem[] = [
    { key: "patient_id", label: "patient_id", value: patientId },
    { key: "hour_from_admission", label: "hour_from_admission", value: input.hour_from_admission },
    { key: "age", label: "age", value: input.age },
    { key: "gender", label: "gender", value: getFirstValue(input.gender, input.sex) },
    { key: "comorbidity_index", label: "comorbidity_index", value: input.comorbidity_index },
    { key: "heart_rate", label: "heart_rate", value: getFirstValue(input.heart_rate, inputSnapshot?.vitalsUsed?.hr), unit: "bpm" },
    { key: "respiratory_rate", label: "respiratory_rate", value: getFirstValue(input.respiratory_rate, inputSnapshot?.vitalsUsed?.rr), unit: "br/min" },
    { key: "spo2", label: "spo2", value: getFirstValue(input.spo2, input.spo2_pct, inputSnapshot?.vitalsUsed?.spo2), unit: "%" },
    { key: "systolic_bp", label: "systolic_bp", value: input.systolic_bp, unit: "mmHg" },
    { key: "diastolic_bp", label: "diastolic_bp", value: input.diastolic_bp, unit: "mmHg" },
    { key: "mobility_score", label: "mobility_score", value: input.mobility_score },
    { key: "lactate", label: "lactate", value: input.lactate, unit: "mmol/L" },
    { key: "hemoglobin", label: "hemoglobin", value: input.hemoglobin, unit: "g/dL" },
  ];

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex items-center gap-3">
        <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
        <p className="text-sm text-slate-600">Loading doctor AI data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-3xl p-6 shadow-sm">
        <p className="text-sm font-semibold text-red-700">{error}</p>
      </div>
    );
  }

  if (!doctorAiData?.input && !doctorAiData?.insights && !doctorAiData?.sentResult) {
    return (
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-2">
          <Brain className="w-5 h-5 text-blue-600" />
          <p className="font-bold text-blue-900">Doctor AI data</p>
        </div>
        <p className="text-sm text-slate-500">
          No doctor AI analysis has been shared yet. Once your doctor runs AI Insights, the LSTM SpO2 fields used for that analysis will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Doctor AI data</p>
            <h2 className="text-blue-900 font-black text-xl">Data used by your doctor in AI Insights</h2>
            <p className="text-sm text-slate-500 mt-1">
              Latest analysis for patient <span className="font-semibold text-slate-700">{formatValue(patientId)}</span>.
            </p>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className={`border rounded-2xl px-4 py-3 ${riskBadge(score)}`}>
              <p className="text-[11px] font-bold uppercase tracking-wide">Shared AI risk</p>
              <p className={`text-2xl font-black ${riskColor(score)}`}>{Number.isFinite(score) ? score.toFixed(1) : "0.0"}%</p>
              <p className="text-[11px]">Confidence {Number.isFinite(confidence) ? confidence.toFixed(0) : "--"}%</p>
            </div>
            <button
              onClick={handleDownloadReport}
              disabled={!canDownloadReport || isDownloadingReport}
              className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 ${!canDownloadReport || isDownloadingReport ? "bg-slate-100 text-slate-300 cursor-not-allowed" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              <Download className="w-3.5 h-3.5" />
              {isDownloadingReport ? "Downloading..." : "Download AI Report PDF"}
            </button>
            {downloadError && (
              <p className="text-[11px] text-red-600">{downloadError}</p>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-[11px] text-slate-500">Model used</p>
            <p className="text-sm font-semibold text-slate-800">{formatValue(modelUsed)}</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
            <p className="text-[11px] text-slate-500">Analysis date</p>
            <p className="text-sm font-semibold text-slate-800">{formatDateTime(analysisDate as string)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <HeartPulse className="w-4 h-4" />
          </div>
          <div>
            <p className="text-blue-900 font-bold text-sm">LSTM SpO2 CSV fields used</p>
            <p className="text-xs text-slate-500">Only the features required by the LSTM model are displayed here.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {fields.map((field) => (
            <div key={field.key} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2">
              <p className="text-[11px] text-slate-500 mb-0.5 font-mono">{field.label}</p>
              <p className="text-sm font-semibold text-slate-800 break-words">{formatValue(field.value, field.unit)}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-xs text-slate-400 flex items-center justify-center gap-1">
        <CalendarClock className="w-3 h-3" /> This view is read-only and replaces the old patient form submission.
      </p>
    </div>
  );
}

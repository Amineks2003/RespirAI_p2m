import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router";
import {
  Shield, Wind, Heart, Bell, ChevronRight, Activity,
  Home, BarChart2, MessageCircle,
  Zap, Clock, CheckCircle,
  TrendingDown, TrendingUp, X, Send, Mic,
  Calendar, User, LogOut, Phone, Camera, FileText,
  Sparkles,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ApiError, apiRequest } from "../lib/api";
import { logout } from "../lib/auth";
import { clearSession, getSession } from "../lib/session";
import { PatientDoctorAiData } from "./PatientDoctorAiData";

/* ────────────────────────────────────────────────────────────
   UI DATA
──────────────────────────────────────────────────────────── */
const spo2History: Array<{ t: string; v: number }> = [];
const hrHistory: Array<{ t: string; v: number }> = [];
const initialChat: Array<{ id: string | number; from: "ai" | "user"; text: string; time: string }> = [];
const medications: Array<{ id?: string; name: string; dose: string; time: string; taken: boolean; icon: string }> = [];
const historyData: Array<{ date: string; spo2: number; hr: number; status: string }> = [];

const navItems = [
  { icon: Home, label: "Home" },
  { icon: BarChart2, label: "Health Form" },
  { icon: MessageCircle, label: "Doctor Chat" },
  { icon: User, label: "Profile" },
];

type ChatMessageItem = {
  id: string | number;
  from: "ai" | "user" | "doctor";
  text: string;
  time: string;
};

const formatTwoDecimals = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return "--";
  return Number(parsed.toFixed(2)).toString();
};

/* ────────────────────────────────────────────────────────────
   HOME SCREEN
──────────────────────────────────────────────────────────── */
function HomeScreen({ homeData, meds, onToggleMedication, pendingMedicationIds, latestDoctorResult }: any) {
  const latestVital = homeData?.latestVital || {};
  const aiInsight = homeData?.aiInsight || {};
  const modelVitals = homeData?.modelVitals || {};

  const hasNumeric = (value: unknown) => typeof value === "number" && Number.isFinite(value);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const toNumberOrNull = (...values: unknown[]) => {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.replace(",", "."));
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    return null;
  };
  const normalizePercent = (...values: unknown[]) => {
    const value = toNumberOrNull(...values);
    if (value === null) return null;
    return value <= 1 ? Number((value * 100).toFixed(2)) : Number(value.toFixed(2));
  };

  const model2Features = latestVital?.modelInputs?.model2Spo2?.features || {};
  const model2Output = latestVital?.modelInputs?.model2Spo2?.modelOutput || {};
  const model1Output = latestVital?.modelInputs?.model1Apnea?.modelOutput || {};
  const model1Context = latestVital?.modelInputs?.model1Apnea?.clinicalContext || {};

  // Patient home now follows the same model-specific data used in the doctor dashboard:
  // - Oxygen / RR / HR come from Model 2 CSV features when available.
  // - Apnea is the latest Model 1 CNN-BiLSTM percentage output, not a /10 scale.
  const spo2 = toNumberOrNull(
    modelVitals.spo2,
    model2Features.spo2_pct,
    model2Features.spo2,
    latestVital.spo2,
  );
  const heartRate = toNumberOrNull(
    modelVitals.heartRate,
    model2Features.heart_rate,
    latestVital.hr,
  );
  const breathingRate = toNumberOrNull(
    modelVitals.respiratoryRate,
    model2Features.respiratory_rate,
    latestVital.rr,
  );
  const apneaRiskPercent = normalizePercent(
    modelVitals.apneaRiskPercent,
    model1Output.riskScore,
    model1Output.risk_score,
    model1Output.probability,
  );
  const model2RiskPercent = normalizePercent(
    modelVitals.model2DeteriorationPercent,
    model2Output.probabilityDeterioration,
    model2Output.probability_deterioration,
    model2Output.riskScore,
  );

  const spo2Progress = spo2 !== null ? clamp(spo2, 0, 100) : 0;
  const breathingProgress = breathingRate !== null ? clamp(((breathingRate - 8) / 20) * 100, 0, 100) : 0;
  const heartProgress = heartRate !== null ? clamp(((heartRate - 45) / 95) * 100, 0, 100) : 0;
  const apneaProgress = apneaRiskPercent !== null ? clamp(apneaRiskPercent, 0, 100) : 0;
  const riskLevel = (score: number) => {
    if (score >= 75) return "Critical";
    if (score >= 50) return "High";
    if (score >= 30) return "Moderate";
    return "Low";
  };
  const apneaSeverity = apneaRiskPercent === null ? "Unknown" : riskLevel(apneaRiskPercent);
  const apneaColorClass = apneaRiskPercent === null
    ? "text-slate-500"
    : apneaRiskPercent >= 75
      ? "text-red-600"
      : apneaRiskPercent >= 50
        ? "text-amber-600"
        : "text-emerald-600";
  const apneaBarClass = apneaRiskPercent === null
    ? "bg-slate-300"
    : apneaRiskPercent >= 75
      ? "bg-red-500"
      : apneaRiskPercent >= 50
        ? "bg-amber-500"
        : "bg-emerald-500";

  const model2Progress = model2RiskPercent !== null ? clamp(model2RiskPercent, 0, 100) : 0;
  const model2Severity = model2RiskPercent === null ? "Unknown" : riskLevel(model2RiskPercent);
  const model2ColorClass = model2RiskPercent === null
    ? "text-slate-500"
    : model2RiskPercent >= 75
      ? "text-red-600"
      : model2RiskPercent >= 50
        ? "text-amber-600"
        : "text-emerald-600";
  const model2BarClass = model2RiskPercent === null
    ? "bg-slate-300"
    : model2RiskPercent >= 75
      ? "bg-red-500"
      : model2RiskPercent >= 50
        ? "bg-amber-500"
        : "bg-emerald-500";

  const monitoringLabel = latestVital?.timestamp
    ? `Live monitoring · updated ${new Date(latestVital.timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
    : "Live monitoring active";

  const medsTaken = meds.filter((medication: any) => medication.taken).length;
  const doctorScoreValue = hasNumeric(latestDoctorResult?.score)
    ? Number(latestDoctorResult.score)
    : null;
  const doctorResultMessage = doctorScoreValue !== null
    ? `Global risk update: ${formatTwoDecimals(doctorScoreValue)}% (${riskLevel(doctorScoreValue)}).`
    : "";
  const heroMessage = doctorResultMessage || "Your doctor has not shared a new AI result yet.";

  return (
    <div className="space-y-5">
      {/* ── Doctor Result Hero ── */}
      <div className="relative bg-gradient-to-br from-teal-500 to-emerald-600 rounded-3xl p-6 overflow-hidden shadow-xl shadow-teal-200/60">
        {/* Background circles */}
        <div className="absolute -top-8 -right-8 w-36 h-36 rounded-full bg-white/10" />
        <div className="absolute -bottom-6 -left-6 w-28 h-28 rounded-full bg-white/10" />

        <div className="relative flex items-center gap-5">
          {/* Animated shield */}
          <div className="flex-shrink-0">
            <div className="relative w-20 h-20">
              <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center ring-4 ring-white/30">
                <Shield className="w-10 h-10 text-white" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-white rounded-full flex items-center justify-center shadow-md">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
            </div>
          </div>
          <div>
            <p className="text-emerald-100 text-sm font-medium mb-1">New Doctor AI Result</p>
            <p className="text-white text-xl font-black leading-tight mb-1 max-w-xs">{heroMessage}</p>
            <div className="flex items-center gap-2 mt-2">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-emerald-100 text-xs font-medium">{monitoringLabel}</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-slate-800 font-bold">My Vitals</h3>
          <span className="text-teal-600 text-xs font-semibold flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-500 animate-pulse" /> Live
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {/* SpO2 */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-blue-100 flex items-center justify-center">
                <Heart className="w-4 h-4 text-blue-500" />
              </div>
              <span className="text-slate-500 text-xs font-medium">Oxygen (SpO₂)</span>
            </div>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-emerald-600 font-black" style={{ fontSize: "32px", lineHeight: 1 }}>{spo2 !== null ? formatTwoDecimals(spo2) : "--"}</span>
              <span className="text-slate-400 text-sm mb-1">{spo2 !== null ? "%" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-emerald-500" />
              <span className="text-emerald-600 text-xs font-semibold">Normal range</span>
            </div>
            <div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-gradient-to-r from-teal-400 to-emerald-500" style={{ width: `${spo2Progress}%` }} />
            </div>
          </div>

          {/* Apnea Model 1 Result */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-cyan-100 flex items-center justify-center">
                <Wind className="w-4 h-4 text-cyan-500" />
              </div>
              <span className="text-slate-500 text-xs font-medium">Apnea — Model 1</span>
            </div>
            <div className="flex items-end gap-1 mb-1">
              <span className={`${apneaColorClass} font-black`} style={{ fontSize: "32px", lineHeight: 1 }}>
                {apneaRiskPercent !== null ? formatTwoDecimals(apneaRiskPercent) : "--"}
              </span>
              <span className="text-slate-400 text-sm mb-1">{apneaRiskPercent !== null ? "%" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className={`w-3 h-3 ${apneaColorClass}`} />
              <span className={`${apneaColorClass} text-xs font-semibold`}>
                {apneaRiskPercent !== null ? `${apneaSeverity} CNN-BiLSTM result` : "No Model 1 result yet"}
              </span>
            </div>
            <div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${apneaBarClass}`} style={{ width: `${apneaProgress}%` }} />
            </div>
          </div>

          {/* Model 2 Result */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-sky-100 flex items-center justify-center">
                <Wind className="w-4 h-4 text-sky-500" />
              </div>
              <span className="text-slate-500 text-xs font-medium">Model 2 Result</span>
            </div>
            <div className="flex items-end gap-1 mb-1">
              <span className={`${model2ColorClass} font-black`} style={{ fontSize: "32px", lineHeight: 1 }}>
                {model2RiskPercent !== null ? formatTwoDecimals(model2RiskPercent) : "--"}
              </span>
              <span className="text-slate-400 text-sm mb-1">{model2RiskPercent !== null ? "%" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className={`w-3 h-3 ${model2ColorClass}`} />
              <span className={`${model2ColorClass} text-xs font-semibold`}>
                {model2RiskPercent !== null ? `${model2Severity} LSTM SpO₂ deterioration` : "No Model 2 result yet"}
              </span>
            </div>
            <div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${model2BarClass}`} style={{ width: `${model2Progress}%` }} />
            </div>
          </div>

          {/* Heart Rate */}
          <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-8 h-8 rounded-xl bg-rose-100 flex items-center justify-center">
                <Activity className="w-4 h-4 text-rose-500" />
              </div>
              <span className="text-slate-500 text-xs font-medium">Heart Rate</span>
            </div>
            <div className="flex items-end gap-1 mb-1">
              <span className="text-emerald-600 font-black" style={{ fontSize: "32px", lineHeight: 1 }}>{heartRate !== null ? formatTwoDecimals(heartRate) : "--"}</span>
              <span className="text-slate-400 text-sm mb-1">{heartRate !== null ? "bpm" : ""}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3 h-3 text-emerald-500" />
              <span className="text-emerald-600 text-xs font-semibold">Resting normal</span>
            </div>
            <div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5">
              <div className="h-1.5 rounded-full bg-gradient-to-r from-rose-400 to-pink-400" style={{ width: `${heartProgress}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Today's meds */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-slate-800 font-bold">Today's Medications</h3>
          <span className="text-emerald-600 text-xs font-semibold">{medsTaken}/{meds.length} taken</span>
        </div>
        <div className="space-y-2.5">
          {meds.length === 0 && (
            <div className="text-sm text-slate-500 bg-white border border-slate-200 rounded-2xl p-4">No medications found for your profile.</div>
          )}
          {meds.map((m: any) => (
            <div key={m.name} className={`flex items-center gap-3 p-3.5 rounded-2xl border ${m.taken ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
              <input
                type="checkbox"
                checked={Boolean(m.taken)}
                onChange={(event) => onToggleMedication(m.id, event.target.checked)}
                disabled={!m.id || pendingMedicationIds.includes(String(m.id))}
                className="w-4 h-4 rounded accent-emerald-600 border-slate-300 disabled:opacity-60 disabled:cursor-not-allowed"
                aria-label={`Mark ${m.name} as taken`}
              />
              <span className="text-2xl flex-shrink-0">{m.icon}</span>
              <div className="flex-1">
                <p className="text-slate-800 text-sm font-semibold">{m.name}</p>
                <p className="text-slate-400 text-xs">{m.dose} · {m.time}</p>
              </div>
              {m.id && pendingMedicationIds.includes(String(m.id)) ? (
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-700">Saving...</span>
              ) : (
                <span className={`text-xs font-bold px-2 py-1 rounded-full ${m.taken ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                  {m.taken ? "✓ Done" : "Pending"}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   HISTORY SCREEN
──────────────────────────────────────────────────────────── */
/* ────────────────────────────────────────────────────────────
   AI CHAT SCREEN
──────────────────────────────────────────────────────────── */
function ChatScreen({ messages, onSendMessage, loadingChat }: {
  messages: ChatMessageItem[];
  onSendMessage: (text: string) => Promise<void>;
  loadingChat: boolean;
}) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const keyboardRows = [
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
    ["z", "x", "c", "v", "b", "n", "m"],
  ];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loadingChat]);

  const sendMessage = async () => {
    if (!input.trim()) return;
    const prompt = input.trim();
    setInput("");
    await onSendMessage(prompt);
  };

  const pressKeyboardKey = async (key: string) => {
    if (key === "backspace") {
      setInput((previous) => previous.slice(0, -1));
      return;
    }

    if (key === "space") {
      setInput((previous) => `${previous} `);
      return;
    }

    if (key === "enter") {
      await sendMessage();
      return;
    }

    setInput((previous) => `${previous}${key}`);
  };

  return (
    <div className="flex flex-col bg-white rounded-2xl border border-slate-100 p-3" style={{ height: "650px" }}>
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b border-slate-100 mb-3 flex-shrink-0">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center shadow-md shadow-violet-200">
          <User className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-bold text-slate-800">Doctor Chat</p>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-600 font-medium">Connected with your doctor</span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1 bg-slate-50 rounded-xl p-3">
        {!messages.length && !loadingChat && (
          <div className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-xl p-3">
            No messages yet. Start the conversation with your assistant.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex gap-2 ${m.from === "user" ? "justify-end" : "justify-start"}`}>
            {m.from !== "user" && (
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center flex-shrink-0 mt-1 shadow">
                <User className="w-3.5 h-3.5 text-white" />
              </div>
            )}
            <div className={`max-w-[78%] rounded-2xl px-4 py-3 ${
              m.from === "user"
                ? "bg-teal-500 text-white rounded-br-sm shadow-sm"
                : "bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm"
            }`}>
              <p className="text-sm leading-relaxed">{m.text}</p>
              <p className={`text-[10px] mt-1 ${m.from === "user" ? "text-teal-200" : "text-slate-400"}`}>{m.time}</p>
            </div>
          </div>
        ))}
        {loadingChat && (
          <div className="flex gap-2 justify-start">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-blue-600 flex items-center justify-center flex-shrink-0 mt-1 shadow">
              <User className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1.5 items-center h-4">
                {[0, 0.2, 0.4].map((d, i) => (
                  <div key={i} className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${d}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      <div className="flex gap-2 overflow-x-auto pb-2 pt-3 flex-shrink-0">
        {["I feel shortness of breath", "Can we review my medications?", "Please check my latest form"].map((q) => (
          <button key={q} onClick={() => setInput(q)}
            className="whitespace-nowrap text-xs font-medium px-3 py-1.5 rounded-full bg-teal-50 border border-teal-200 text-teal-700 hover:bg-teal-100 transition-colors flex-shrink-0">
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-shrink-0">
        <button className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors flex-shrink-0">
          <Mic className="w-4 h-4 text-slate-500" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Ask anything…"
          className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-300 transition-all"
        />
        <button onClick={sendMessage}
          className="p-2.5 rounded-xl bg-teal-500 hover:bg-teal-600 transition-colors flex-shrink-0 shadow-md shadow-teal-200">
          <Send className="w-4 h-4 text-white" />
        </button>
      </div>

      {/* Phone-style keyboard */}
      <div className="mt-2 flex-shrink-0 rounded-[1.7rem] bg-slate-200/90 border border-slate-300 px-2.5 pt-2.5 pb-3 shadow-inner">
        <div className="space-y-1.5">
          {keyboardRows.map((row, rowIndex) => (
            <div
              key={`keyboard-row-${rowIndex}`}
              className={`flex justify-center gap-1 ${rowIndex === 1 ? "px-3" : rowIndex === 2 ? "px-8" : ""}`}
            >
              {row.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => pressKeyboardKey(key)}
                  className="h-9 min-w-[27px] flex-1 rounded-lg bg-white text-slate-800 text-sm font-semibold shadow-sm active:bg-slate-300 active:scale-95 transition-all"
                >
                  {key}
                </button>
              ))}
            </div>
          ))}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setInput((previous) => previous.charAt(0).toUpperCase() + previous.slice(1))}
              className="h-9 w-12 rounded-lg bg-slate-300 text-slate-700 text-xs font-bold shadow-sm active:bg-slate-400 transition-all"
            >
              shift
            </button>
            <button
              type="button"
              onClick={() => pressKeyboardKey("space")}
              className="h-9 flex-1 rounded-lg bg-white text-slate-500 text-xs font-semibold shadow-sm active:bg-slate-300 transition-all"
            >
              space
            </button>
            <button
              type="button"
              onClick={() => pressKeyboardKey("backspace")}
              className="h-9 w-12 rounded-lg bg-slate-300 text-slate-700 text-lg font-black shadow-sm active:bg-slate-400 transition-all"
              aria-label="Backspace"
            >
              ⌫
            </button>
            <button
              type="button"
              onClick={() => pressKeyboardKey("enter")}
              className="h-9 w-14 rounded-lg bg-teal-500 text-white text-xs font-bold shadow-sm active:bg-teal-600 transition-all"
            >
              send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   SETTINGS SCREEN
──────────────────────────────────────────────────────────── */
function SettingsScreen({
  profile,
  settings,
  onToggleSetting,
  onSignOut,
  pendingSettingKeys,
  riskHistory,
  isEditingProfile,
  profileDraft,
  onStartProfileEdit,
  onCancelProfileEdit,
  onProfileDraftChange,
  onSaveProfile,
  savingProfile,
}: any) {
  const fullName = profile?.fullName || "Patient";
  const patientCode = profile?.patientCode || "#P-0000";
  const condition = profile?.condition || "Respiratory Monitoring";
  const doctorName = profile?.doctorName || "Unassigned";
  const emergencyContactDisplay = profile?.emergencyContactName
    ? `${profile.emergencyContactName}${profile?.emergencyContactPhone ? ` · ${profile.emergencyContactPhone}` : ""}`
    : "Not set";

  return (
    <div className="space-y-5">
      {/* Profile card */}
      <div className="bg-gradient-to-br from-teal-50 to-emerald-50 rounded-3xl p-5 border border-teal-100 text-center">
        <div className="relative inline-block mb-3">
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-teal-400 to-emerald-500 flex items-center justify-center shadow-xl shadow-teal-200 mx-auto">
            <User className="w-10 h-10 text-white" />
          </div>
          <button className="absolute bottom-0 right-0 w-7 h-7 bg-white rounded-full border border-slate-200 flex items-center justify-center shadow hover:bg-slate-50 transition-colors">
            <Camera className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>
        <h3 className="text-slate-800 font-black text-lg">{fullName}</h3>
        <p className="text-slate-500 text-sm mt-0.5">Patient ID: {patientCode}</p>
        <div className="flex items-center justify-center gap-2 mt-3">
          <span className="bg-teal-100 text-teal-700 text-xs font-semibold px-3 py-1 rounded-full">Patient</span>
          <span className="bg-blue-100 text-blue-700 text-xs px-3 py-1 rounded-full">{condition}</span>
        </div>
        {!isEditingProfile ? (
          <button
            onClick={onStartProfileEdit}
            className="mt-4 flex items-center gap-2 mx-auto text-sm text-teal-600 border border-teal-200 bg-white rounded-xl px-4 py-2 hover:bg-teal-50 transition-colors font-medium"
          >
            <User className="w-4 h-4" /> Edit Profile
          </button>
        ) : (
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={onCancelProfileEdit}
              disabled={savingProfile}
              className="text-sm border border-slate-200 text-slate-600 bg-white rounded-xl px-4 py-2 hover:bg-slate-50 transition-colors font-medium disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              onClick={onSaveProfile}
              disabled={savingProfile}
              className="text-sm text-white bg-teal-600 rounded-xl px-4 py-2 hover:bg-teal-700 transition-colors font-medium disabled:opacity-60"
            >
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </div>
        )}
      </div>

      {/* Personal info */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">Personal Information</p>
        {!isEditingProfile ? (
          <div className="space-y-3 divide-y divide-slate-50">
            {[
              { label: "Full Name", value: fullName },
              { label: "Date of Birth", value: profile?.dob || "Not set" },
              { label: "Blood Type", value: profile?.bloodType || "Not set" },
              { label: "Condition", value: condition },
              { label: "Physician", value: doctorName },
              { label: "Emergency Contact", value: emergencyContactDisplay },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                <span className="text-xs text-slate-400">{item.label}</span>
                <span className="text-sm font-semibold text-slate-700">{item.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-slate-400 mb-1">Full Name</p>
              <input
                value={profileDraft?.fullName || ""}
                onChange={(event) => onProfileDraftChange("fullName", event.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-400 mb-1">Date of Birth</p>
                <input
                  value={profileDraft?.dob || ""}
                  onChange={(event) => onProfileDraftChange("dob", event.target.value)}
                  placeholder="YYYY-MM-DD"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Blood Type</p>
                <input
                  value={profileDraft?.bloodType || ""}
                  onChange={(event) => onProfileDraftChange("bloodType", event.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-1">Condition</p>
              <input
                value={profileDraft?.condition || ""}
                onChange={(event) => onProfileDraftChange("condition", event.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-400 mb-1">Emergency Contact Name</p>
                <input
                  value={profileDraft?.emergencyContactName || ""}
                  onChange={(event) => onProfileDraftChange("emergencyContactName", event.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-1">Emergency Contact Phone</p>
                <input
                  value={profileDraft?.emergencyContactPhone || ""}
                  onChange={(event) => onProfileDraftChange("emergencyContactPhone", event.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">Physician is assigned by your care team and cannot be changed here.</p>
          </div>
        )}
      </div>

      {/* Preferences */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-4">Preferences</p>
        <div className="space-y-4">
          {[
            { label: "Push Notifications", sub: "Alerts for vitals & AI tips", icon: Bell, state: settings.notifications, key: "notifications" },
            { label: "Share Data with Doctor", sub: "Real-time vitals sharing", icon: Activity, state: settings.dataSharing, key: "dataSharing" },
            { label: "Biometric Login", sub: "Face ID / Fingerprint", icon: Shield, state: settings.biometric, key: "biometric" },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center">
                  <item.icon className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{item.label}</p>
                  <p className="text-xs text-slate-400">{item.sub}</p>
                </div>
              </div>
              <button onClick={() => onToggleSetting(item.key, !item.state)}
                disabled={pendingSettingKeys.includes(item.key)}
                className={`w-12 h-6 rounded-full transition-all relative ${item.state ? "bg-teal-500" : "bg-slate-200"} ${pendingSettingKeys.includes(item.key) ? "opacity-60 cursor-not-allowed" : ""}`}>
                <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all shadow ${item.state ? "left-6" : "left-0.5"}`} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm space-y-1">
        <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3">History</p>
        {riskHistory?.length ? riskHistory.map((entry: any, index: number) => (
          <div key={`${entry.sentAt || "na"}-${entry.score}-${index}`} className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100 text-left">
            <Calendar className="w-4 h-4 text-blue-500" />
            <span className="text-sm font-medium text-slate-700 flex-1">
              {entry.sentAt ? new Date(entry.sentAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "Unknown date"}
            </span>
            <span className="text-xs text-slate-500">Global Risk {formatTwoDecimals(entry.score || 0)}%{entry.confidence !== undefined && entry.confidence !== null ? ` · Conf. ${formatTwoDecimals(entry.confidence || 0)}%` : ""}</span>
          </div>
        )) : (
          <div className="text-sm text-slate-500">No doctor risk history available.</div>
        )}
      </div>

      <button onClick={onSignOut}
        className="w-full flex items-center justify-center gap-2 py-3.5 border-2 border-red-200 text-red-600 rounded-2xl font-semibold hover:bg-red-50 transition-colors">
        <LogOut className="w-4 h-4" /> Sign Out
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
   MAIN PATIENT APP
──────────────────────────────────────────────────────────── */
export function PatientApp() {
  const navigate = useNavigate();
  const [activeNav, setActiveNav] = useState("Home");
  const [showNotif, setShowNotif] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [dataError, setDataError] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessageItem[]>(initialChat);
  const [settingsState, setSettingsState] = useState({
    notifications: true,
    dataSharing: true,
    biometric: false,
    darkMode: false,
  });
  const [profileState, setProfileState] = useState({
    fullName: "",
    patientCode: "",
    condition: "",
    bloodType: "",
    dob: "",
    doctorName: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  });
  const [profileDraft, setProfileDraft] = useState({
    fullName: "",
    patientCode: "",
    condition: "",
    bloodType: "",
    dob: "",
    doctorName: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
  });
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [homeState, setHomeState] = useState<any>(null);
  const [medicationsState, setMedicationsState] = useState(medications);
  const [spo2TrendState, setSpo2TrendState] = useState(spo2History);
  const [hrTrendState, setHrTrendState] = useState(hrHistory);
  const [historyRowsState, setHistoryRowsState] = useState(historyData);
  const [doctorRiskHistoryState, setDoctorRiskHistoryState] = useState<any[]>([]);
  const [latestDoctorResultState, setLatestDoctorResultState] = useState<any>(null);
  const [pendingMedicationIds, setPendingMedicationIds] = useState<string[]>([]);
  const [pendingNotificationIds, setPendingNotificationIds] = useState<string[]>([]);
  const [pendingSettingKeys, setPendingSettingKeys] = useState<string[]>([]);

  const unreadCount = notifications.filter((notification) => !notification.read).length;

  useEffect(() => {
    const session = getSession();
    if (!session || session.role !== "patient") {
      clearSession();
      navigate("/", { replace: true });
      return;
    }

    let stopSync = false;

    const formatTime = (dateValue?: string) => {
      if (!dateValue) return "--:--";
      return new Date(dateValue).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    };

    const loadPatientData = async () => {
      try {
        setDataError("");

        const [homePayload, spo2HistoryPayload, hrHistoryPayload, chatPayload, settingsPayload, profilePayload, notificationsPayload, doctorPayload] = await Promise.all([
          apiRequest<any>("/patient/me/home", { auth: true }),
          apiRequest<any>("/patient/me/history?metric=spo2&limit=30", { auth: true }),
          apiRequest<any>("/patient/me/history?metric=hr&limit=30", { auth: true }),
          apiRequest<any>("/patient/me/chat?limit=100", { auth: true }),
          apiRequest<any>("/patient/me/settings", { auth: true }),
          apiRequest<any>("/patient/me/profile", { auth: true }),
          apiRequest<any>("/patient/me/notifications?limit=20", { auth: true }),
          apiRequest<any>("/patient/me/doctor", { auth: true }),
        ]);

        if (homePayload?.home) {
          setHomeState(homePayload.home);
          setLatestDoctorResultState(homePayload.home.latestDoctorSentResult || null);
          setMedicationsState(
            Array.isArray(homePayload.home.medications)
              ? homePayload.home.medications.map((medication: any) => ({
                  id: medication._id,
                  name: medication.name,
                  dose: medication.dose,
                  time: medication.time,
                  taken: Boolean(medication.takenToday),
                  icon: medication.icon || "💊",
                }))
              : [],
          );
        } else {
          setHomeState(null);
          setMedicationsState([]);
        }

        if (Array.isArray(spo2HistoryPayload?.records)) {
          const spo2Records = spo2HistoryPayload.records;
          setSpo2TrendState(
            spo2Records.map((record: any, index: number) => ({
              t: index === spo2Records.length - 1 ? "Now" : formatTime(record.timestamp),
              v: record.modelSpo2 ?? record.spo2 ?? record.value ?? 0,
            })),
          );

          const rows = spo2Records.slice(-7).map((record: any) => ({
            date: new Date(record.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
            spo2: record.modelSpo2 ?? record.spo2 ?? 0,
            hr: record.modelHeartRate ?? record.hr ?? 0,
            status: (record.modelSpo2 ?? record.spo2 ?? 0) < 94 ? "warning" : "stable",
          }));
          setHistoryRowsState(rows);
        } else {
          setSpo2TrendState([]);
          setHistoryRowsState([]);
        }

        if (Array.isArray(hrHistoryPayload?.records)) {
          const hrRecords = hrHistoryPayload.records;
          setHrTrendState(
            hrRecords.map((record: any, index: number) => ({
              t: index === hrRecords.length - 1 ? "Now" : formatTime(record.timestamp),
              v: record.modelHeartRate ?? record.hr ?? record.value ?? 0,
            })),
          );
        } else {
          setHrTrendState([]);
        }

        if (Array.isArray(chatPayload?.messages)) {
          setChatMessages(
            chatPayload.messages.map((message: any, index: number) => ({
              id: message._id || index + 1,
              from: message.role === "doctor" ? "doctor" : message.role === "ai" ? "ai" : "user",
              text: message.text,
              time: formatTime(message.createdAt),
            })),
          );
        } else {
          setChatMessages([]);
        }

        if (settingsPayload?.settings) {
          setSettingsState((previous) => ({ ...previous, ...settingsPayload.settings }));
        }

        if (profilePayload?.profile) {
          const user = profilePayload.profile.user;
          const patient = profilePayload.profile.patient;
          const doctorName = doctorPayload?.doctor?.user
            ? `Dr. ${doctorPayload.doctor.user.firstName} ${doctorPayload.doctor.user.lastName}`
            : "Unassigned";

          const nextProfileState = {
            fullName: `${user.firstName} ${user.lastName}`,
            patientCode: patient.patientCode || "#P-0000",
            condition: patient.condition || "Respiratory Monitoring",
            bloodType: patient.bloodType || "Not set",
            dob: patient.dob ? new Date(patient.dob).toISOString().slice(0, 10) : "",
            doctorName,
            emergencyContactName: patient.emergencyContact?.name || "",
            emergencyContactPhone: patient.emergencyContact?.phone || "",
          };

          setProfileState(nextProfileState);
          setProfileDraft(nextProfileState);
          setDoctorRiskHistoryState(Array.isArray(patient.doctorRiskHistory) ? patient.doctorRiskHistory : []);
          if (patient.latestDoctorSentResult) {
            setLatestDoctorResultState(patient.latestDoctorSentResult);
          }
        }

        const seenPatientNotifKeys = new Set<string>();
        setNotifications(
          Array.isArray(notificationsPayload?.notifications)
            ? notificationsPayload.notifications
              .filter((notification: any) => {
                const eventType = notification?.metadata?.type;
                return eventType === "doctor-chat" || eventType === "doctor-ai-results";
              })
              .filter((notification: any) => {
                const eventType = String(notification?.metadata?.type || "");
                const patientCode = String(notification?.metadata?.patientCode || "");
                const score = notification?.metadata?.score;
                const confidence = notification?.metadata?.confidence;
                const normalizedMessage = String(notification?.message || notification?.title || "")
                  .replace(/\(\d+%\s*global\s*risk\)/gi, "")
                  .replace(/\s+/g, " ")
                  .trim()
                  .toLowerCase();
                const key = eventType === "doctor-ai-results"
                  ? `${eventType}-${patientCode}-${score ?? "na"}-${confidence ?? "na"}-${normalizedMessage}`
                  : `${eventType}-${patientCode}-${normalizedMessage}`;
                if (seenPatientNotifKeys.has(key)) return false;
                seenPatientNotifKeys.add(key);
                return true;
              })
              .map((notification: any) => ({
                id: notification._id,
                text: notification.message || notification.title,
                type: notification.type === "success" ? "good" : notification.type === "warning" ? "warn" : "info",
                time: formatTime(notification.createdAt),
                read: Boolean(notification.read),
                metadata: notification.metadata || {},
                message: notification.message || notification.title,
              }))
            : [],
        );
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Unable to sync patient app.";
        setDataError(message);
      }
    };

    const refreshLiveVitals = async () => {
      try {
        const [homePayload, spo2HistoryPayload, hrHistoryPayload] = await Promise.all([
          apiRequest<any>("/patient/me/home", { auth: true }),
          apiRequest<any>("/patient/me/history?metric=spo2&limit=30", { auth: true }),
          apiRequest<any>("/patient/me/history?metric=hr&limit=30", { auth: true }),
        ]);

        if (stopSync) return;

        if (homePayload?.home) {
          setHomeState(homePayload.home);
          setLatestDoctorResultState(homePayload.home.latestDoctorSentResult || null);
          setMedicationsState(
            Array.isArray(homePayload.home.medications)
              ? homePayload.home.medications.map((medication: any) => ({
                  id: medication._id,
                  name: medication.name,
                  dose: medication.dose,
                  time: medication.time,
                  taken: Boolean(medication.takenToday),
                  icon: medication.icon || "💊",
                }))
              : [],
          );
        }

        if (Array.isArray(spo2HistoryPayload?.records)) {
          const spo2Records = spo2HistoryPayload.records;
          setSpo2TrendState(
            spo2Records.map((record: any, index: number) => ({
              t: index === spo2Records.length - 1 ? "Now" : formatTime(record.timestamp),
              v: record.modelSpo2 ?? record.spo2 ?? record.value ?? 0,
            })),
          );

          const rows = spo2Records.slice(-7).map((record: any) => ({
            date: new Date(record.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
            spo2: record.modelSpo2 ?? record.spo2 ?? 0,
            hr: record.modelHeartRate ?? record.hr ?? 0,
            status: (record.modelSpo2 ?? record.spo2 ?? 0) < 94 ? "warning" : "stable",
          }));
          setHistoryRowsState(rows);
        }

        if (Array.isArray(hrHistoryPayload?.records)) {
          const hrRecords = hrHistoryPayload.records;
          setHrTrendState(
            hrRecords.map((record: any, index: number) => ({
              t: index === hrRecords.length - 1 ? "Now" : formatTime(record.timestamp),
              v: record.modelHeartRate ?? record.hr ?? record.value ?? 0,
            })),
          );
        }
      } catch {
        // Keep current UI data if live refresh fails.
      }
    };

    loadPatientData();

    const liveSyncTimer = setInterval(() => {
      refreshLiveVitals();
    }, 15000);

    return () => {
      stopSync = true;
      clearInterval(liveSyncTimer);
    };
  }, [navigate]);

  const handleSendMessage = async (text: string) => {
    const optimisticUserMessage: { id: string; from: "user"; text: string; time: string } = {
      id: `${Date.now()}-user`,
      from: "user",
      text,
      time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    };
    setChatMessages((previous) => [...previous, optimisticUserMessage]);

    try {
      setLoadingChat(true);
      const response = await apiRequest<any>("/patient/me/chat", {
        method: "POST",
        auth: true,
        body: { text },
      });

      const incoming: ChatMessageItem[] = (response?.messages || []).map((message: any, index: number) => ({
        id: message._id || `${Date.now()}-${index}`,
        from: (message.role === "doctor" ? "doctor" : message.role === "ai" ? "ai" : "user") as "ai" | "user" | "doctor",
        text: message.text,
        time: new Date(message.createdAt || Date.now()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      }));

      setChatMessages((previous) => [...previous, ...incoming.filter((message) => message.from !== "user")]);
    } catch {
      const fallbackAiMessage: { id: string; from: "doctor"; text: string; time: string } = {
        id: `${Date.now()}-ai-fallback`,
        from: "doctor",
        text: "Unable to send message right now. Please try again.",
        time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
      };
      setChatMessages((previous) => [...previous, fallbackAiMessage]);
    } finally {
      setLoadingChat(false);
    }
  };

  const handleToggleSetting = async (key: string, value: boolean) => {
    if (pendingSettingKeys.includes(key)) return;

    const previousValue = settingsState[key as keyof typeof settingsState];
    setSettingsState((previous) => ({ ...previous, [key]: value }));
    setPendingSettingKeys((previous) => [...previous, key]);
    try {
      await apiRequest("/patient/me/settings", {
        method: "PATCH",
        auth: true,
        body: { [key]: value },
      });
    } catch {
      setSettingsState((previous) => ({ ...previous, [key]: previousValue }));
    } finally {
      setPendingSettingKeys((previous) => previous.filter((pendingKey) => pendingKey !== key));
    }
  };

  const handleToggleMedication = async (medicationId: string, takenToday: boolean) => {
    if (!medicationId) return;

    const medicationKey = String(medicationId);
    if (pendingMedicationIds.includes(medicationKey)) return;

    setMedicationsState((previous: any[]) => previous.map((medication) => (
      medication.id === medicationId ? { ...medication, taken: takenToday } : medication
    )));
    setPendingMedicationIds((previous) => [...previous, medicationKey]);

    try {
      await apiRequest(`/patient/me/medications/${medicationId}/taken`, {
        method: "PATCH",
        auth: true,
        body: { takenToday },
      });
    } catch {
      setMedicationsState((previous: any[]) => previous.map((medication) => (
        medication.id === medicationId ? { ...medication, taken: !takenToday } : medication
      )));
    } finally {
      setPendingMedicationIds((previous) => previous.filter((pendingId) => pendingId !== medicationKey));
    }
  };

  const handleMarkNotificationRead = async (notificationId: string) => {
    if (pendingNotificationIds.includes(notificationId)) return;

    const targetNotification = notifications.find((notification) => notification.id === notificationId);
    if (!targetNotification || targetNotification.read) return;

    setNotifications((previous) => previous.map((notification) => (
      notification.id === notificationId ? { ...notification, read: true } : notification
    )));
    setPendingNotificationIds((previous) => [...previous, notificationId]);

    try {
      await apiRequest(`/patient/me/notifications/${notificationId}/read`, {
        method: "PATCH",
        auth: true,
      });
    } catch {
      setNotifications((previous) => previous.map((notification) => (
        notification.id === notificationId ? { ...notification, read: false } : notification
      )));
    } finally {
      setPendingNotificationIds((previous) => previous.filter((pendingId) => pendingId !== notificationId));
    }
  };

  const handleSignOut = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const handleStartProfileEdit = () => {
    setProfileDraft(profileState);
    setEditingProfile(true);
    setDataError("");
  };

  const handleCancelProfileEdit = () => {
    setProfileDraft(profileState);
    setEditingProfile(false);
  };

  const handleProfileDraftChange = (field: string, value: string) => {
    setProfileDraft((previous) => ({ ...previous, [field]: value }));
  };

  const handleSaveProfile = async () => {
    if (savingProfile) return;

    const trimmedName = (profileDraft.fullName || "").trim();
    if (!trimmedName) {
      setDataError("Full name is required.");
      return;
    }

    const nameParts = trimmedName.split(/\s+/);
    const firstName = nameParts.shift() || "";
    const lastName = nameParts.join(" ") || "Patient";

    setSavingProfile(true);
    setDataError("");
    try {
      const payload = await apiRequest<any>("/patient/me/profile", {
        method: "PATCH",
        auth: true,
        body: {
          firstName,
          lastName,
          dob: profileDraft.dob && profileDraft.dob !== "Not set" ? profileDraft.dob : null,
          condition: profileDraft.condition,
          bloodType: profileDraft.bloodType && profileDraft.bloodType !== "Not set" ? profileDraft.bloodType : null,
          emergencyContact: {
            name: (profileDraft.emergencyContactName || "").trim(),
            phone: (profileDraft.emergencyContactPhone || "").trim(),
          },
        },
      });

      const user = payload?.profile?.user;
      const patient = payload?.profile?.patient;
      const updatedProfile = {
        fullName: `${user?.firstName || firstName} ${user?.lastName || lastName}`.trim(),
        patientCode: patient?.patientCode || profileState.patientCode,
        condition: patient?.condition || profileDraft.condition,
        bloodType: patient?.bloodType || profileDraft.bloodType,
        dob: patient?.dob ? new Date(patient.dob).toISOString().slice(0, 10) : "",
        doctorName: profileState.doctorName,
        emergencyContactName: patient?.emergencyContact?.name || profileDraft.emergencyContactName,
        emergencyContactPhone: patient?.emergencyContact?.phone || profileDraft.emergencyContactPhone,
      };

      setProfileState(updatedProfile);
      setProfileDraft(updatedProfile);
      setEditingProfile(false);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to save profile.";
      setDataError(message);
    } finally {
      setSavingProfile(false);
    }
  };

  const getScreen = () => {
    const latestDoctorResult = latestDoctorResultState || notifications.find((notification) => notification?.metadata?.type === "doctor-ai-results");
    switch (activeNav) {
      case "Home": return <HomeScreen homeData={homeState} meds={medicationsState} onToggleMedication={handleToggleMedication} pendingMedicationIds={pendingMedicationIds} latestDoctorResult={latestDoctorResult} />;
      case "Health Form": return <PatientDoctorAiData />;
      case "Doctor Chat": return <ChatScreen messages={chatMessages} onSendMessage={handleSendMessage} loadingChat={loadingChat} />;
      case "Profile":
        return (
          <SettingsScreen
            profile={profileState}
            settings={settingsState}
            onToggleSetting={handleToggleSetting}
            onSignOut={handleSignOut}
            pendingSettingKeys={pendingSettingKeys}
            riskHistory={doctorRiskHistoryState}
            isEditingProfile={editingProfile}
            profileDraft={profileDraft}
            onStartProfileEdit={handleStartProfileEdit}
            onCancelProfileEdit={handleCancelProfileEdit}
            onProfileDraftChange={handleProfileDraftChange}
            onSaveProfile={handleSaveProfile}
            savingProfile={savingProfile}
          />
        );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center py-8 px-4">
      {/* Phone frame */}
      <div className="relative w-[390px] bg-slate-50 rounded-[3.5rem] shadow-2xl overflow-hidden border-[5px] border-slate-800 flex flex-col"
        style={{ height: "844px", boxShadow: "0 0 0 1px #1e293b, 0 40px 80px rgba(0,0,0,0.4)" }}>

        {/* Status bar */}
        <div className="bg-white px-7 pt-3 pb-1 flex items-center justify-between flex-shrink-0">
          <span className="text-slate-900 text-xs font-bold">{new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>
          <div className="flex items-center gap-1.5">
            {[3, 5, 7, 9].map((h, i) => (
              <div key={i} className="w-1 bg-slate-900 rounded-sm" style={{ height: `${h}px` }} />
            ))}
            <div className="w-4 h-2.5 border border-slate-900 rounded-sm flex items-center px-0.5 ml-1">
              <div className="h-1.5 bg-emerald-500 rounded-sm w-3" />
            </div>
          </div>
        </div>

        {/* App Header */}
        <div className="bg-white px-5 pb-3 flex items-center justify-between flex-shrink-0 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div>
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
                  <Activity className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-black text-sm text-slate-800">Respir<span className="text-teal-500">AI</span></span>
              </div>
              <p className="text-slate-400 text-xs ml-8">Good morning, {profileState.fullName?.split(" ")[0] || "there"} 👋</p>

            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center hover:bg-rose-100 transition-colors"
            >
              <LogOut className="w-4 h-4 text-rose-600" />
            </button>
            <div className="relative">
              <button onClick={() => setShowNotif(!showNotif)}
                className="relative w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center hover:bg-slate-200 transition-colors">
                <Bell className="w-4 h-4 text-slate-600" />
                {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-teal-500 rounded-full border border-white" />}
              </button>
              {showNotif && (
                <div className="absolute right-0 top-11 w-64 bg-white rounded-2xl border border-slate-100 shadow-2xl z-50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
                    <span className="font-bold text-slate-800 text-sm">Notifications</span>
                    <button onClick={() => setShowNotif(false)}><X className="w-3.5 h-3.5 text-slate-400" /></button>
                  </div>
                  {notifications.length === 0 && (
                    <div className="px-4 py-3 text-xs text-slate-400">No notifications yet.</div>
                  )}
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleMarkNotificationRead(n.id)}
                      className={`px-4 py-3 border-b border-slate-50 last:border-0 ${pendingNotificationIds.includes(String(n.id)) ? "cursor-wait" : "hover:bg-slate-50 cursor-pointer"} ${!n.read ? "bg-teal-50/40" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${n.type === "good" ? "bg-emerald-500" : n.type === "warn" ? "bg-amber-500" : "bg-blue-500"} ${!n.read ? "animate-pulse" : "opacity-50"}`} />
                        <div>
                          <p className={`text-xs ${!n.read ? "text-slate-700 font-semibold" : "text-slate-500 font-medium"}`}>{n.text}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{pendingNotificationIds.includes(String(n.id)) ? "Marking as read..." : n.time}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 pb-28" onClick={() => showNotif && setShowNotif(false)}>
          {dataError && (
            <div className="mb-3 text-red-600 text-xs bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {dataError}
            </div>
          )}
          {getScreen()}
        </div>

        {/* Bottom Nav */}
        <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-slate-100 px-3 pt-2 pb-6 flex items-center justify-around shadow-lg">
          {navItems.map((item) => (
            <button key={item.label} onClick={() => setActiveNav(item.label)}
              className="flex flex-col items-center gap-1">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
                activeNav === item.label
                  ? "bg-gradient-to-br from-teal-500 to-emerald-600 shadow-lg shadow-teal-200"
                  : "hover:bg-slate-100"
              }`}>
                <item.icon className={`w-5 h-5 ${activeNav === item.label ? "text-white" : "text-slate-400"}`} />
              </div>
              <span className={`text-[10px] font-bold ${activeNav === item.label ? "text-teal-600" : "text-slate-400"}`}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

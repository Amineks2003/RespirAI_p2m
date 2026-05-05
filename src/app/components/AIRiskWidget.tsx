import { useState } from "react";
import {
  Brain, Sparkles, AlertTriangle, Clock,
  BookOpen, ShieldAlert, TrendingUp, Activity,
  Mic, ChevronDown, ChevronUp, Zap, Info, Wind,
  CheckCircle2, XCircle,
} from "lucide-react";

interface AIRiskWidgetProps {
  risk?: any;
  latestVital?: any;
  latestEnvironment?: any;
  patientCondition?: string;
  patientName?: string;
}

export function AIRiskWidget({
  risk,
  latestVital,
  latestEnvironment,
  patientCondition,
  patientName,
}: AIRiskWidgetProps) {
  const [showFull, setShowFull] = useState(false);
  const status = risk?.status || "active";
  const riskScore = Math.max(0, Math.min(100, Number(risk?.score ?? 0)));
  const confidence = Math.max(0, Math.min(100, Number(risk?.confidence ?? 0)));
  const riskScoreLabel = riskScore.toFixed(1);
  const confidenceLabel = Math.round(confidence);
  const riskMarkerLeft = Math.max(0, Math.min(98, riskScore - 2));
  const predictedWindowMinutes = Number(risk?.predictedWindowMinutes ?? 120);
  const factors = Array.isArray(risk?.factors) ? risk.factors : [];
  const guidelines = Array.isArray(risk?.guidelines) ? risk.guidelines : [];
  const ragExplanation = String(risk?.rag?.explanation || "").trim();
  const ragSources = Array.isArray(risk?.rag?.sources) ? risk.rag.sources : [];

  const derivedFactors = factors.length
    ? factors
    : [
        { key: "spo2", label: "SpO₂ Trend", value: `${latestVital?.spo2 ?? "--"}%`, severity: (latestVital?.spo2 ?? 100) < 90 ? "critical" : "moderate" },
        { key: "cough", label: "Cough Frequency", value: `${latestVital?.coughEvents ?? 0} events/hr`, severity: (latestVital?.coughEvents ?? 0) > 10 ? "high" : "moderate" },
        { key: "aqi", label: "Air Quality", value: `AQI ${latestEnvironment?.aqi ?? "--"}`, severity: (latestEnvironment?.aqi ?? 0) > 140 ? "high" : "moderate" },
      ];

  const normalizedStatus = String(status || "").toLowerCase();
  const effectiveStatus =
    normalizedStatus === "warning"
      ? "high"
      : ["critical", "high", "moderate", "stable", "low"].includes(normalizedStatus)
        ? normalizedStatus
        : riskScore >= 75
          ? "critical"
          : riskScore >= 50
            ? "high"
            : riskScore >= 30
              ? "moderate"
              : "stable";

  const riskTitle =
    effectiveStatus === "critical"
      ? "Critical Prediction"
      : effectiveStatus === "high"
        ? "High Prediction"
        : effectiveStatus === "moderate"
          ? "Moderate Prediction"
          : "Low Prediction";

  const riskHeadline =
    effectiveStatus === "critical"
      ? "Respiratory Crisis"
      : effectiveStatus === "high"
        ? "Respiratory Exacerbation"
        : "Acute Respiratory Event";

  const reasoningText =
    ragExplanation ||
    `Signal synthesis from vitals, audio, apnea and environment indicates ${riskTitle.toLowerCase()} for ${patientName || "this patient"}.`;

  const sourceHighlights = ragSources
    .slice(0, 2)
    .map((source: any) => String(source?.snippet || source?.text || "").trim())
    .filter(Boolean);

  const C = 2 * Math.PI * 52;
  const dash = (riskScore / 100) * C;

  if (!risk) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 flex items-center gap-3">
        <Info className="w-5 h-5 text-slate-400 flex-shrink-0" />
        <div>
          <p className="text-slate-700 font-semibold text-sm">No active AI alert</p>
          <p className="text-slate-400 text-xs">Select a patient with available risk analysis data.</p>
        </div>
      </div>
    );
  }

  if (status === "validated") {
    return (
      <div className="bg-white rounded-3xl border border-emerald-200 shadow-lg overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-500 to-teal-600 px-6 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-7 h-7 text-white" />
          </div>
          <div>
            <p className="text-white font-black">Intervention Validated</p>
            <p className="text-emerald-100 text-sm">Clinical protocol initiated · Case escalated</p>
          </div>
        </div>
        <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100">
          <p className="text-emerald-800 text-sm">✔ Intervention confirmed for {patientName || "selected patient"}. The alert is now marked as validated.</p>
        </div>
      </div>
    );
  }

  if (status === "dismissed") {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 flex items-center gap-3">
        <XCircle className="w-5 h-5 text-slate-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="text-slate-600 font-semibold text-sm">Alert Dismissed</p>
          <p className="text-slate-400 text-xs">The alert was dismissed and is no longer active for {patientName || "this patient"}.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-3xl border-2 border-orange-200 shadow-2xl shadow-orange-100/60 overflow-hidden relative">
      {/* Top pulsing bar */}
      <div className="h-1 bg-gradient-to-r from-red-500 via-orange-400 to-red-500 animate-pulse" />

      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-orange-100 bg-gradient-to-r from-orange-50/60 to-red-50/40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center shadow-md shadow-orange-200">
            <Brain className="w-5 h-5 text-white" />
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center border border-white">
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-slate-900 font-black">AI Risk Assessment</p>
              <span className="bg-red-100 text-red-700 text-[10px] font-black px-2 py-0.5 rounded-full border border-red-200 uppercase tracking-wider">Live</span>
            </div>
            <p className="text-slate-400 text-xs">Multimodal AI · RAG-Augmented</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-orange-700 bg-orange-100 border border-orange-200 rounded-full px-3 py-1.5">
          <div className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
          <Zap className="w-3 h-3" /> {confidenceLabel}% Confidence
        </div>
      </div>

      <div className="px-6 py-5">
        {/* Risk score + title */}
        <div className="flex items-center gap-6 mb-5">
          {/* Gauge */}
          <div className="relative flex-shrink-0 w-32 h-32">
            <div className="absolute inset-0 rounded-full bg-red-50 animate-pulse opacity-60" />
            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#FEE2E2" strokeWidth="10" />
              <circle cx="60" cy="60" r="52" fill="none" stroke="url(#rg2)" strokeWidth="11"
                strokeDasharray={`${dash} ${C}`} strokeLinecap="round" />
              <defs>
                <linearGradient id="rg2" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#F59E0B" />
                  <stop offset="100%" stopColor="#DC2626" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-red-600 font-black leading-none" style={{ fontSize: "28px" }}>{riskScoreLabel}%</span>
              <span className="text-red-400 text-[10px] font-bold uppercase tracking-wider mt-0.5">RISK</span>
            </div>
          </div>

          {/* Title */}
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <span className="text-red-600 text-xs font-bold uppercase tracking-widest">{riskTitle}</span>
            </div>
            <p className="text-slate-900 font-black leading-tight mb-2" style={{ fontSize: "18px" }}>
              {riskScoreLabel}% Risk of <span className="text-red-600">{riskHeadline}</span>
            </p>
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
              <Clock className="w-3.5 h-3.5 text-amber-600 flex-shrink-0" />
              <span className="text-amber-800 text-sm font-semibold">Estimated within the next <strong>{Math.max(1, Math.round(predictedWindowMinutes / 60))} hours</strong></span>
            </div>
            {/* Risk bar */}
            <div className="mt-3 flex gap-1 items-center">
              <div className="flex-1 h-2 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 relative">
                <div className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-red-600 shadow-md" style={{ left: `${riskMarkerLeft}%` }} />
              </div>
              <span className="text-xs text-slate-400 ml-2 whitespace-nowrap">Low → Critical</span>
            </div>
          </div>
        </div>

        {/* RAG Reasoning Box */}
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-4 h-4 text-indigo-600" />
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wide">AI Reasoning (RAG)</span>
            <button onClick={() => setShowFull(!showFull)}
              className="ml-auto flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
              {showFull ? "Less" : "More"} {showFull ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
            <p className="text-slate-700 text-sm leading-relaxed">
              {reasoningText}
            </p>
            {showFull && (
              <div className="mt-4 pt-4 border-t border-slate-200 space-y-2.5">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Contributing Factors</p>
                {derivedFactors.map((factor: any, index: number) => {
                  const color = factor.severity === "critical" ? "red" : factor.severity === "high" ? "amber" : factor.severity === "moderate" ? "orange" : "indigo";
                  const icon = index === 0 ? Activity : index === 1 ? Mic : index === 2 ? Wind : TrendingUp;
                  const Icon = icon;
                  const iconClass =
                    color === "red"
                      ? "bg-red-100 text-red-600"
                      : color === "amber"
                        ? "bg-amber-100 text-amber-600"
                        : color === "orange"
                          ? "bg-orange-100 text-orange-600"
                          : "bg-indigo-100 text-indigo-600";
                  const textClass =
                    color === "red"
                      ? "text-red-700"
                      : color === "amber"
                        ? "text-amber-700"
                        : color === "orange"
                          ? "text-orange-700"
                          : "text-indigo-700";
                  return (
                    <div key={factor.label} className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${iconClass}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1">
                        <p className="text-xs text-slate-400">{factor.label}</p>
                        <p className={`text-sm font-semibold ${textClass}`}>{factor.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Clinical source badges */}
        <div className="mb-5">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-blue-800 text-xs font-semibold">Guidelines Applied To This Prediction</span>
              <ShieldAlert className="w-3.5 h-3.5 text-blue-500" />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {(guidelines.length ? guidelines : ["GINA 2024", "WHO", "GOLD", "ATS"]).map((guideline: string, index: number) => {
              const badgeColor = index % 4 === 0 ? "bg-blue-700" : index % 4 === 1 ? "bg-emerald-700" : index % 4 === 2 ? "bg-violet-700" : "bg-amber-700";
              return (
                <span key={guideline} className={`${badgeColor} text-white text-[10px] font-black px-2.5 py-1 rounded-lg tracking-wide`}>{guideline}</span>
              );
            })}
          </div>
          <div className="mt-2 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
            <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
            {sourceHighlights.length > 0 ? (
              <p className="text-blue-700 text-xs leading-relaxed">
                {sourceHighlights.map((snippet, index) => (
                  <span key={`source-highlight-${index}`}>
                    <strong>Source {index + 1}:</strong> {snippet}{index < sourceHighlights.length - 1 ? " " : ""}
                  </span>
                ))}
              </p>
            ) : (
              <p className="text-blue-700 text-xs leading-relaxed">
                The decision support explanation uses current patient inputs and retrieved RAG clinical references.
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-2">AI decision-support tool · Does not replace physician judgment</p>
      </div>
    </div>
  );
}

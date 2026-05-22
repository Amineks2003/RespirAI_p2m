import { useMemo } from "react";
import {
  Brain,
  Sparkles,
  AlertTriangle,
  Clock,
  Zap,
  Info,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface AIRiskWidgetProps {
  risk?: any;
  latestVital?: any;
  latestEnvironment?: any;
  patientCondition?: string;
  patientName?: string;
}

const getRiskScaleColor = (percentage: number) => {
  if (percentage >= 75) return "#DC2626"; // red
  if (percentage >= 50) return "#D97706"; // amber
  return "#059669"; // green
};

const getRiskSoftColor = (percentage: number) => {
  if (percentage >= 75) {
    return {
      border: "border-red-200",
      shadow: "shadow-red-100/60",
      headerFrom: "from-red-50/70",
      headerTo: "to-rose-50/50",
      iconFrom: "from-red-500",
      iconTo: "to-rose-600",
      liveBg: "bg-red-100",
      liveText: "text-red-700",
      liveBorder: "border-red-200",
      pulse: "bg-red-500",
      gaugeBg: "#FEE2E2",
      gaugeFillFrom: "#F87171",
      gaugeFillTo: "#DC2626",
      gaugeHalo: "bg-red-50",
      estimateBg: "bg-red-50",
      estimateBorder: "border-red-200",
      estimateText: "text-red-800",
      estimateIcon: "text-red-600",
      predictionText: "text-red-600",
    };
  }

  if (percentage >= 50) {
    return {
      border: "border-amber-200",
      shadow: "shadow-amber-100/60",
      headerFrom: "from-amber-50/70",
      headerTo: "to-orange-50/50",
      iconFrom: "from-amber-500",
      iconTo: "to-orange-600",
      liveBg: "bg-amber-100",
      liveText: "text-amber-700",
      liveBorder: "border-amber-200",
      pulse: "bg-amber-500",
      gaugeBg: "#FEF3C7",
      gaugeFillFrom: "#FBBF24",
      gaugeFillTo: "#D97706",
      gaugeHalo: "bg-amber-50",
      estimateBg: "bg-amber-50",
      estimateBorder: "border-amber-200",
      estimateText: "text-amber-800",
      estimateIcon: "text-amber-600",
      predictionText: "text-amber-600",
    };
  }

  return {
    border: "border-emerald-200",
    shadow: "shadow-emerald-100/60",
    headerFrom: "from-emerald-50/70",
    headerTo: "to-teal-50/50",
    iconFrom: "from-emerald-500",
    iconTo: "to-teal-600",
    liveBg: "bg-emerald-100",
    liveText: "text-emerald-700",
    liveBorder: "border-emerald-200",
    pulse: "bg-emerald-500",
    gaugeBg: "#D1FAE5",
    gaugeFillFrom: "#34D399",
    gaugeFillTo: "#059669",
    gaugeHalo: "bg-emerald-50",
    estimateBg: "bg-amber-50",
    estimateBorder: "border-amber-200",
    estimateText: "text-amber-800",
    estimateIcon: "text-amber-600",
    predictionText: "text-emerald-600",
  };
};

export function AIRiskWidget({
  risk,
  latestVital,
  latestEnvironment,
  patientCondition,
  patientName,
}: AIRiskWidgetProps) {
  const status = risk?.status || "active";
  const riskScore = Math.max(0, Math.min(100, Number(risk?.score ?? 0)));
  const riskColor = getRiskScaleColor(riskScore);
  const palette = getRiskSoftColor(riskScore);

  const confidence = Math.max(0, Math.min(100, Number(risk?.confidence ?? 0)));
  const riskScoreLabel = riskScore.toFixed(1);
  const confidenceLabel = Math.round(confidence);
  const riskMarkerLeft = Math.max(0, Math.min(98, riskScore - 2));
  const predictedWindowMinutes = Number(risk?.predictedWindowMinutes ?? 120);

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

  const riskLabelColor = useMemo(() => ({ color: riskColor }), [riskColor]);

  const C = 2 * Math.PI * 52;
  const dash = (riskScore / 100) * C;

  if (!risk) {
    return (
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-5 flex items-center gap-3">
        <Info className="w-5 h-5 text-slate-400 flex-shrink-0" />
        <div>
          <p className="text-slate-700 font-semibold text-sm">No active AI alert</p>
          <p className="text-slate-400 text-xs">
            Select a patient with available risk analysis data.
          </p>
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
            <p className="text-emerald-100 text-sm">
              Clinical protocol initiated · Case escalated
            </p>
          </div>
        </div>

        <div className="px-6 py-4 bg-emerald-50 border-b border-emerald-100">
          <p className="text-emerald-800 text-sm">
            ✔ Intervention confirmed for {patientName || "selected patient"}. The alert is now
            marked as validated.
          </p>
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
          <p className="text-slate-400 text-xs">
            The alert was dismissed and is no longer active for{" "}
            {patientName || "this patient"}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`bg-white rounded-3xl border-2 ${palette.border} shadow-2xl ${palette.shadow} overflow-hidden relative`}
    >
      <div
        className="h-1"
        style={{
          background: `linear-gradient(90deg, ${palette.gaugeFillFrom}, ${palette.gaugeFillTo})`,
        }}
      />

      <div
        className={`px-6 pt-5 pb-4 border-b border-slate-100 bg-gradient-to-r ${palette.headerFrom} ${palette.headerTo} flex items-center justify-between`}
      >
        <div className="flex items-center gap-3">
          <div
            className={`relative w-10 h-10 rounded-2xl bg-gradient-to-br ${palette.iconFrom} ${palette.iconTo} flex items-center justify-center shadow-md`}
          >
            <Brain className="w-5 h-5 text-white" />
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full flex items-center justify-center border border-white">
              <Sparkles className="w-2.5 h-2.5 text-white" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <p className="text-slate-900 font-black">AI Risk Assessment</p>
              <span
                className={`${palette.liveBg} ${palette.liveText} text-[10px] font-black px-2 py-0.5 rounded-full border ${palette.liveBorder} uppercase tracking-wider`}
              >
                Live
              </span>
            </div>
            <p className="text-slate-400 text-xs">Multimodal AI · RAG-Augmented</p>
          </div>
        </div>

        <div
          className={`flex items-center gap-1.5 text-xs ${palette.liveText} ${palette.liveBg} border ${palette.liveBorder} rounded-full px-3 py-1.5`}
        >
          <div className={`w-2 h-2 rounded-full ${palette.pulse} animate-pulse`} />
          <Zap className="w-3 h-3" /> {confidenceLabel}% Confidence
        </div>
      </div>

      <div className="px-6 py-5">
        <div className="flex items-center gap-6 mb-5">
          <div className="relative flex-shrink-0 w-32 h-32">
            <div className={`absolute inset-0 rounded-full ${palette.gaugeHalo} opacity-80`} />

            <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke={palette.gaugeBg}
                strokeWidth="10"
              />
              <circle
                cx="60"
                cy="60"
                r="52"
                fill="none"
                stroke="url(#riskWidgetGradient)"
                strokeWidth="11"
                strokeDasharray={`${dash} ${C}`}
                strokeLinecap="round"
              />
              <defs>
                <linearGradient
                  id="riskWidgetGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor={palette.gaugeFillFrom} />
                  <stop offset="100%" stopColor={palette.gaugeFillTo} />
                </linearGradient>
              </defs>
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span
                className="font-black leading-none"
                style={{ ...riskLabelColor, fontSize: "28px" }}
              >
                {riskScoreLabel}%
              </span>
              <span
                className="text-[10px] font-bold uppercase tracking-wider mt-0.5"
                style={riskLabelColor}
              >
                RISK
              </span>
            </div>
          </div>

          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" style={riskLabelColor} />
              <span
                className="text-xs font-bold uppercase tracking-widest"
                style={riskLabelColor}
              >
                {riskTitle}
              </span>
            </div>

            <p className="text-slate-900 font-black leading-tight mb-2" style={{ fontSize: "18px" }}>
              <span style={riskLabelColor}>{riskScoreLabel}%</span> Risk of{" "}
              <span style={riskLabelColor}>{riskHeadline}</span>
            </p>

            <div
              className={`flex items-center gap-2 ${palette.estimateBg} border ${palette.estimateBorder} rounded-xl px-3 py-2`}
            >
              <Clock className={`w-3.5 h-3.5 ${palette.estimateIcon} flex-shrink-0`} />
              <span className={`${palette.estimateText} text-sm font-semibold`}>
                Estimated within the next{" "}
                <strong>{Math.max(1, Math.round(predictedWindowMinutes / 60))} hours</strong>
              </span>
            </div>

            <div className="mt-3 flex gap-1 items-center">
              <div className="flex-1 h-2 rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500 relative">
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 shadow-md"
                  style={{
                    left: `${riskMarkerLeft}%`,
                    borderColor: riskColor,
                  }}
                />
              </div>
              <span className="text-xs text-slate-400 ml-2 whitespace-nowrap">
                Low → Critical
              </span>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-2">
          AI decision-support tool · Does not replace physician judgment
        </p>
      </div>
    </div>
  );
}

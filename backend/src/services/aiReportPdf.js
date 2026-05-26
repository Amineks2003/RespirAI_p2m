import PDFDocument from "pdfkit";

const sanitizeFileName = (value) =>
  String(value || "report")
    .replace(/[^a-z0-9\-_. ]/gi, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

const formatDateTime = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString("en-GB");
  return date.toLocaleString("en-GB");
};

const toPercentValue = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, normalized));
};

const formatPercent = (value) => {
  const normalized = toPercentValue(value);
  return normalized === null ? "--" : `${normalized.toFixed(1)}%`;
};

const safeText = (value) => {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
};

const getModelOutputs = (insight) => {
  const outputs = insight?.modelOutputs;
  if (!outputs || typeof outputs !== "object") return [];
  return Object.values(outputs)
    .filter((output) => output && typeof output === "object")
    .map((output) => ({
      label: safeText(output.label || "Model"),
      score: output.score ?? output.riskScore ?? output.probabilityDeterioration ?? null,
      status: safeText(output.status || output.riskLabel || output.apneaLabel || output.prediction || ""),
      details: safeText(output.details || ""),
      confidence: output.confidence ?? null,
    }));
};

const getRagSummary = (insight) =>
  safeText(
    insight?.rag?.detailed_summary ||
    insight?.rag?.summary ||
    insight?.rag?.explanation ||
    insight?.explanation ||
    "No RAG summary available.",
  );

const writeSectionTitle = (doc, title) => {
  doc.moveDown(0.6);
  doc.fontSize(13).fillColor("#111").text(title);
  doc.fontSize(11).fillColor("#333");
};

export const streamAiInsightPdf = ({
  res,
  profile,
  insight,
  doctorInput,
  sentResult,
  fileNameSuffix = "ai-insight-report",
}) => {
  const doc = new PDFDocument({ margin: 50 });
  const fileName = `${sanitizeFileName(`${profile.patientCode}-${fileNameSuffix}`)}.pdf`;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=\"${fileName}\"`);

  doc.pipe(res);
  doc.fontSize(18).fillColor("#111").text(`AI Insight Report - ${profile.patientCode}`);
  doc.moveDown(0.3);
  doc.fontSize(11).fillColor("#333");

  const generatedAt = sentResult?.sentAt || insight?.generatedAt || new Date();
  doc.text(`Generated: ${formatDateTime(generatedAt)}`);

  if (doctorInput?.usedAt) {
    doc.text(`Model run: ${formatDateTime(doctorInput.usedAt)}`);
  }

  if (doctorInput?.model) {
    doc.text(`Model selection: ${safeText(doctorInput.model)}`);
  }

  writeSectionTitle(doc, "Global Risk");
  doc.text(`Score: ${formatPercent(insight?.score ?? sentResult?.score)}`);
  doc.text(`Confidence: ${formatPercent(insight?.confidence ?? sentResult?.confidence)}`);

  writeSectionTitle(doc, "Model Outputs");
  const outputs = getModelOutputs(insight);
  if (!outputs.length) {
    doc.text("No model outputs available.");
  } else {
    outputs.forEach((output) => {
      const statusText = output.status ? ` (${output.status})` : "";
      doc.text(`${output.label}: ${formatPercent(output.score)}${statusText}`);
      if (output.details && output.details !== "--") {
        doc.fontSize(10).fillColor("#555").text(`Details: ${output.details}`);
        doc.fontSize(11).fillColor("#333");
      }
      if (output.confidence !== null && output.confidence !== undefined) {
        doc.fontSize(10).fillColor("#555").text(`Confidence: ${formatPercent(output.confidence)}`);
        doc.fontSize(11).fillColor("#333");
      }
      doc.moveDown(0.2);
    });
  }

  writeSectionTitle(doc, "RAG Summary");
  doc.text(getRagSummary(insight));

  writeSectionTitle(doc, "Key Factors");
  const factors = Array.isArray(insight?.factors) ? insight.factors : [];
  if (!factors.length) {
    doc.text("No risk factors available.");
  } else {
    factors.forEach((factor) => {
      const label = safeText(factor.label || factor.key || "Factor");
      const value = safeText(factor.value ?? "n/a");
      const severity = safeText(factor.severity || "");
      doc.text(`- ${label}: ${value}${severity ? ` (${severity})` : ""}`);
    });
  }

  const guidelines = Array.isArray(insight?.guidelines) ? insight.guidelines : [];
  if (guidelines.length) {
    writeSectionTitle(doc, "Guidelines");
    doc.text(guidelines.map((item) => safeText(item)).join(", "));
  }

  doc.end();
};

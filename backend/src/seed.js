import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connectDatabase } from "./config/db.js";
import { User } from "./models/User.js";
import { DoctorProfile } from "./models/DoctorProfile.js";
import { PatientProfile } from "./models/PatientProfile.js";
import { VitalRecord } from "./models/VitalRecord.js";
import { EnvironmentSnapshot } from "./models/EnvironmentSnapshot.js";
import { RiskAssessment } from "./models/RiskAssessment.js";
import { Alert } from "./models/Alert.js";
import { Consultation } from "./models/Consultation.js";
import { Report } from "./models/Report.js";
import { Notification } from "./models/Notification.js";
import { MedicationSchedule } from "./models/MedicationSchedule.js";
import { ChatMessage } from "./models/ChatMessage.js";

dotenv.config();

const patientSeed = [
  { code: "#P-4821", firstName: "James", lastName: "Okafor", age: 67, condition: "COPD III + Asthma", status: "critical", spo2: 86, hr: 104, rr: 24, aqi: 168, humidity: 72, temperature: 25.4, riskBase: 86 },
  { code: "#P-3302", firstName: "Maria", lastName: "Vasquez", age: 54, condition: "Severe Asthma", status: "warning", spo2: 91, hr: 92, rr: 20, aqi: 141, humidity: 69, temperature: 23.1, riskBase: 66 },
  { code: "#P-6641", firstName: "Robert", lastName: "Kim", age: 63, condition: "Pulmonary Fibrosis", status: "warning", spo2: 92, hr: 88, rr: 19, aqi: 134, humidity: 65, temperature: 22.8, riskBase: 58 },
  { code: "#P-5510", firstName: "Ahmed", lastName: "Benali", age: 71, condition: "COPD Stage II", status: "moderate", spo2: 94, hr: 78, rr: 17, aqi: 112, humidity: 61, temperature: 22.2, riskBase: 42 },
  { code: "#P-2287", firstName: "Sophie", lastName: "Turner", age: 45, condition: "Bronchiectasis", status: "stable", spo2: 97, hr: 68, rr: 15, aqi: 84, humidity: 56, temperature: 21.4, riskBase: 24 },
  { code: "#P-1190", firstName: "Fatima", lastName: "Diallo", age: 38, condition: "Asthma (Moderate)", status: "stable", spo2: 98, hr: 72, rr: 14, aqi: 76, humidity: 54, temperature: 20.9, riskBase: 18 },
];

const now = Date.now();
const hoursAgo = (h) => new Date(now - h * 60 * 60 * 1000);

const run = async () => {
  await connectDatabase(process.env.MONGODB_URI);

  await Promise.all([
    User.deleteMany({}),
    DoctorProfile.deleteMany({}),
    PatientProfile.deleteMany({}),
    VitalRecord.deleteMany({}),
    EnvironmentSnapshot.deleteMany({}),
    RiskAssessment.deleteMany({}),
    Alert.deleteMany({}),
    Consultation.deleteMany({}),
    Report.deleteMany({}),
    Notification.deleteMany({}),
    MedicationSchedule.deleteMany({}),
    ChatMessage.deleteMany({}),
  ]);

  const doctorPassword = await bcrypt.hash("Doctor123!", 10);
  const doctor = await User.create({
    firstName: "Sarah",
    lastName: "Chen",
    email: "doctor@respir.ai",
    phone: "+44 7700 100200",
    role: "doctor",
    passwordHash: doctorPassword,
  });

  await DoctorProfile.create({
    user: doctor._id,
    licenseNo: "GMC-1234567",
    hospital: "City Hospital",
    specialty: "Pulmonology",
    department: "ICU",
  });

  const createdPatients = [];

  for (const [patientIndex, item] of patientSeed.entries()) {
    const passwordHash = await bcrypt.hash("Patient123!", 10);

    const user = await User.create({
      firstName: item.firstName,
      lastName: item.lastName,
      email: `${item.firstName.toLowerCase()}.${item.lastName.toLowerCase()}@respir.ai`,
      phone: "+44 7700 000000",
      role: "patient",
      passwordHash,
    });

    const birthYear = new Date().getFullYear() - item.age;
    const profile = await PatientProfile.create({
      user: user._id,
      patientCode: item.code,
      condition: item.condition,
      status: item.status,
      gender: "Prefer not to say",
      doctor: doctor._id,
      admittedAt: hoursAgo(24 * 4),
      dob: new Date(`${birthYear}-06-15`),
      emergencyContact: { name: "Family Contact", phone: "+44 7911 000000" },
      bloodType: "A+",
    });

    const vitals = Array.from({ length: 24 }).map((_, idx) => {
      const drift = item.status === "critical"
        ? -Math.max(0, Math.floor((12 - idx) / 6))
        : item.status === "warning"
          ? -Math.max(0, Math.floor((10 - idx) / 8))
          : Math.floor(idx / 12);

      return {
      patient: user._id,
      spo2: Math.max(82, Math.min(100, item.spo2 + drift + ((idx + patientIndex) % 3) - 1)),
      hr: Math.max(55, item.hr + ((idx + patientIndex) % 5) - 2),
      rr: Math.max(10, item.rr + ((idx + patientIndex) % 4) - 1),
      apneaLevel: Number((Math.max(0, Math.min(10, (item.status === "critical" ? 8 : item.status === "warning" ? 6 : item.status === "moderate" ? 3 : 1) + ((idx + patientIndex) % 3) - 1))).toFixed(1)),
      coughEvents: item.status === "critical"
        ? Math.max(6, 22 - Math.floor(idx / 2))
        : item.status === "warning"
          ? Math.max(3, 12 - Math.floor(idx / 3))
          : 2 + ((idx + patientIndex) % 3),
      wheezeDetected: item.status === "critical" || item.status === "warning",
      timestamp: hoursAgo(24 - idx),
      source: "wearable",
      };
    });

    await VitalRecord.insertMany(vitals);

    await EnvironmentSnapshot.insertMany(
      Array.from({ length: 8 }).map((_, idx) => ({
        patient: user._id,
        aqi: Math.max(45, item.aqi - idx * (item.status === "critical" ? 1 : 2) + ((idx + patientIndex) % 4)),
        temperature: Number((item.temperature + ((idx + patientIndex) % 3) * 0.4 - 0.5).toFixed(1)),
        humidity: Math.max(35, item.humidity + ((idx + patientIndex) % 5) - 2),
        pollen: idx % 3 === 0 ? "High" : "Medium",
        weather: idx % 2 === 0 ? "Partly Cloudy" : "Cloudy",
        timestamp: hoursAgo(8 - idx),
      })),
    );

    const riskHistory = Array.from({ length: 10 }).map((_, idx) => {
      const score = Math.max(5, Math.min(99, item.riskBase - (9 - idx) * (item.status === "critical" ? 1 : 2) + ((idx + patientIndex) % 4)));

      return {
        patient: user._id,
        score,
        confidence: Math.max(68, Math.min(98, 82 + idx + patientIndex)),
        predictedWindowMinutes: item.status === "critical" ? 120 : item.status === "warning" ? 240 : 420,
        factors: [
          { key: "spo2", label: "SpO₂ Trend", value: `${Math.max(82, item.spo2 - (9 - idx))}%`, severity: score > 75 ? "critical" : score > 55 ? "high" : "moderate" },
          { key: "cough", label: "Cough Frequency", value: `${Math.max(2, 3 + Math.floor(score / 8))} events/hr`, severity: score > 70 ? "high" : "moderate" },
          { key: "aqi", label: "Air Quality", value: `AQI ${Math.max(45, item.aqi - (9 - idx) * 2)}`, severity: item.aqi > 130 ? "high" : "moderate" },
        ],
        guidelines: ["GINA 2024", "WHO", "GOLD", "ATS"],
        status: idx === 9 ? "active" : "validated",
        createdAt: hoursAgo(10 - idx),
        updatedAt: hoursAgo(10 - idx),
      };
    });

    await RiskAssessment.insertMany(riskHistory);

    await MedicationSchedule.insertMany([
      { patient: user._id, name: "Salbutamol Inhaler", dose: "2 puffs when needed", time: "As required", icon: "💨", takenToday: true },
      { patient: user._id, name: "Fluticasone (ICS)", dose: "1 puff", time: "08:00", icon: "🫁", takenToday: true },
      { patient: user._id, name: "Montelukast 10mg", dose: "1 tablet", time: "20:00", icon: "💊", takenToday: false },
    ]);

    await Notification.insertMany([
      {
        user: user._id,
        type: "success",
        title: "Vitals stable",
        message: "Your breathing indicators are stable today.",
      },
      {
        user: user._id,
        type: "warning",
        title: "Air quality advisory",
        message: "AQI is elevated today. Prefer indoor activity.",
      },
    ]);

    createdPatients.push({ user, profile, seed: item });
  }

  const [james, maria, robert, ahmed, sophie, fatima] = createdPatients;

  await Alert.insertMany([
    { patient: james.user._id, doctor: doctor._id, type: "critical", message: "James Okafor — SpO₂ dropped to 86%", status: "open" },
    { patient: maria.user._id, doctor: doctor._id, type: "warning", message: "Maria Vasquez — Wheeze detected", status: "acknowledged" },
    { patient: createdPatients[3].user._id, doctor: doctor._id, type: "info", message: "Sensor offline: environment node 8", status: "resolved" },
  ]);

  await Consultation.insertMany([
    {
      patient: james.user._id,
      doctor: doctor._id,
      scheduledFor: hoursAgo(-0.5),
      type: "Emergency Review",
      status: "urgent",
      notes: [{ from: "ai", text: "Ready to assist with consultations. Select a patient to begin." }],
    },
    {
      patient: maria.user._id,
      doctor: doctor._id,
      scheduledFor: hoursAgo(-1),
      type: "Follow-up",
      status: "scheduled",
      notes: [{ from: "ai", text: "Ready to assist with consultations. Select a patient to begin." }],
    },
    {
      patient: robert.user._id,
      doctor: doctor._id,
      scheduledFor: hoursAgo(-1.75),
      type: "Apnea Review",
      status: "scheduled",
      notes: [{ from: "ai", text: "Apnea trend available for review." }],
    },
    {
      patient: ahmed.user._id,
      doctor: doctor._id,
      scheduledFor: hoursAgo(-2.5),
      type: "Medication Review",
      status: "pending",
      notes: [{ from: "ai", text: "Medication adherence check pending." }],
    },
    {
      patient: sophie.user._id,
      doctor: doctor._id,
      scheduledFor: hoursAgo(6),
      type: "Routine Check",
      status: "completed",
      notes: [{ from: "doctor", text: "Stable respiratory profile, no intervention needed." }],
    },
    {
      patient: fatima.user._id,
      doctor: doctor._id,
      scheduledFor: hoursAgo(24),
      type: "Asthma Education",
      status: "completed",
      notes: [{ from: "doctor", text: "Reviewed trigger avoidance and inhaler technique." }],
    },
  ]);

  await Report.insertMany([
    {
      doctor: doctor._id,
      title: "Daily Clinical Report — March 14",
      type: "Daily",
      summary: "Summary of alerts, interventions and patient vitals for today.",
      status: "ready",
      periodStart: hoursAgo(24),
      periodEnd: new Date(),
      includeVitals: true,
      includeAlerts: true,
      includeConsultations: true,
      notes: "Daily handover report generated by RespirAI backend seed.",
    },
    {
      doctor: doctor._id,
      title: "Weekly Outcomes — Week 11",
      type: "Weekly",
      summary: "Weekly outcomes across respiratory monitoring cohort.",
      status: "ready",
      periodStart: hoursAgo(24 * 7),
      periodEnd: new Date(),
      includeVitals: true,
      includeAlerts: true,
      includeConsultations: true,
      notes: "Weekly respiratory outcomes across all assigned patients.",
    },
    {
      doctor: doctor._id,
      patient: james.user._id,
      title: "James Okafor — Exacerbation Log",
      type: "Patient",
      summary: "Patient-specific exacerbation timeline and interventions.",
      status: "ready",
      periodStart: hoursAgo(72),
      periodEnd: new Date(),
      includeVitals: true,
      includeAlerts: true,
      includeConsultations: true,
      notes: "Critical deterioration trend with intervention checkpoints.",
    },
    {
      doctor: doctor._id,
      patient: maria.user._id,
      title: "Maria Vasquez — Air Trigger Analysis",
      type: "Patient",
      summary: "Correlation between AQI spikes and wheeze episodes.",
      status: "ready",
      periodStart: hoursAgo(48),
      periodEnd: new Date(),
      includeVitals: true,
      includeAlerts: true,
      includeConsultations: false,
      notes: "Use environmental mitigation plan before discharge.",
    },
    {
      doctor: doctor._id,
      patient: robert.user._id,
      title: "Robert Kim — Apnea Trend",
      type: "Patient",
      summary: "Progressive apnea severity trend with recommended follow-up.",
      status: "ready",
      periodStart: hoursAgo(96),
      periodEnd: new Date(),
      includeVitals: true,
      includeAlerts: false,
      includeConsultations: true,
      notes: "Review apnea pattern and night-time respiratory support plan.",
    },
  ]);

  await Notification.insertMany([
    {
      user: doctor._id,
      type: "critical",
      title: "Critical alert",
      message: "James Okafor — SpO₂ dropped to 86%",
      read: false,
    },
    {
      user: doctor._id,
      type: "warning",
      title: "Wheezing detected",
      message: "Maria Vasquez — acoustic anomaly detected",
      read: false,
    },
    {
      user: doctor._id,
      type: "info",
      title: "Daily report",
      message: "Daily report ready for March 14",
      read: true,
    },
  ]);

  await ChatMessage.insertMany([
    {
      patient: createdPatients[4].user._id,
      role: "ai",
      text: "Good morning! Your vitals are stable today.",
    },
    {
      patient: createdPatients[4].user._id,
      role: "user",
      text: "Can I go for a walk outside?",
    },
    {
      patient: createdPatients[4].user._id,
      role: "ai",
      text: "AQI is moderate today, prefer light indoor activity.",
    },
  ]);

  console.log("✅ Seed completed");
  console.log("Doctor login: doctor@respir.ai / Doctor123!");
  console.log("Patient login example: sophie.turner@respir.ai / Patient123!");

  process.exit(0);
};

run().catch((error) => {
  console.error("❌ Seed failed", error);
  process.exit(1);
});

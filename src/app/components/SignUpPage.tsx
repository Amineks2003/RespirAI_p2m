import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Activity, Shield, Lock, Eye, EyeOff, Mail, Stethoscope,
  Heart, CheckCircle, ArrowRight, User, Phone, ArrowLeft,
  Building, Hash, Sparkles,
} from "lucide-react";
import { ApiError } from "../lib/api";
import { register } from "../lib/auth";
import { getSession } from "../lib/session";

type Role = "patient" | "doctor" | null;
type Step = 1 | 2 | 3;

export function SignUpPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>(null);
  const [step, setStep] = useState<Step>(1);
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const session = getSession();
    if (!session) return;

    navigate(session.role === "doctor" ? "/doctor" : "/patient", { replace: true });
  }, [navigate]);

  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "", phone: "",
    password: "", confirmPw: "",
    // doctor-specific
    licenseNo: "", hospital: "", specialty: "",
    // patient-specific
    dob: "", gender: "", condition: "",
  });

  const set = (k: string, v: string) => {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: "" }));
  };

  const validateStep1 = () => {
    const e: Record<string, string> = {};
    if (!role) e.role = "Please select your role.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep2 = () => {
    const e: Record<string, string> = {};
    if (!form.firstName.trim()) e.firstName = "First name is required.";
    if (!form.lastName.trim()) e.lastName = "Last name is required.";
    if (!form.email.includes("@")) e.email = "Valid email is required.";
    if (form.phone.length < 8) e.phone = "Valid phone number required.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateStep3 = () => {
    const e: Record<string, string> = {};
    if (form.password.length < 8) e.password = "Password must be at least 8 characters.";
    if (form.password !== form.confirmPw) e.confirmPw = "Passwords do not match.";
    if (!agreed) e.agreed = "You must accept the terms.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = async () => {
    if (step === 1 && validateStep1()) setStep(2);
    else if (step === 2 && validateStep2()) setStep(3);
    else if (step === 3 && validateStep3()) {
      setLoading(true);

      try {
        const payload = {
          role,
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          phone: form.phone,
          password: form.password,
          ...(role === "doctor"
            ? {
                licenseNo: form.licenseNo,
                hospital: form.hospital,
                specialty: form.specialty,
              }
            : {
                dob: form.dob,
                gender: form.gender,
                condition: form.condition,
              }),
        };

        const response = await register(payload);
        navigate(response.user.role === "doctor" ? "/doctor" : "/patient");
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Unable to create account right now.";
        setErrors((previous) => ({ ...previous, form: message }));
      } finally {
        setLoading(false);
      }
    }
  };

  const steps = ["Role", "Personal Info", "Security"];
  const accent = role === "doctor" ? { from: "from-blue-500", to: "to-indigo-600", ring: "ring-blue-200", text: "text-blue-700", bg: "bg-blue-600", border: "border-blue-400", shadow: "shadow-blue-200" }
    : { from: "from-teal-400", to: "to-emerald-500", ring: "ring-teal-200", text: "text-teal-700", bg: "bg-teal-500", border: "border-teal-400", shadow: "shadow-teal-200" };

  const inputCls = (field: string) =>
    `w-full px-4 py-3.5 bg-white border rounded-xl text-slate-700 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 transition-all ${
      errors[field] ? "border-red-300 focus:ring-red-200" : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
    }`;

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex w-2/5 bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 flex-col items-center justify-center p-14 relative overflow-hidden">
        <div className="absolute w-80 h-80 rounded-full border border-white/5 top-[-60px] left-[-60px]" />
        <div className="absolute w-56 h-56 rounded-full bg-blue-600/20 bottom-20 right-10 blur-3xl" />
        <div className="relative z-10 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-blue-400 to-cyan-400 shadow-2xl shadow-blue-900/50 mb-6">
            <Activity className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-white text-3xl font-black mb-3">Join Respir<span className="text-cyan-400">AI</span></h1>
          <p className="text-blue-200 mb-10 leading-relaxed max-w-xs">
            Create your account in minutes and start monitoring your respiratory health with AI-powered insights.
          </p>
          {/* Step indicators */}
          <div className="space-y-4">
            {steps.map((s, i) => (
              <div key={s} className={`flex items-center gap-4 rounded-2xl p-4 border transition-all ${step === i + 1 ? "bg-white/15 border-white/20" : "bg-white/5 border-white/10"}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                  step > i + 1 ? "bg-emerald-500 text-white" : step === i + 1 ? "bg-white text-blue-900" : "bg-white/10 text-blue-300"
                }`}>
                  {step > i + 1 ? <CheckCircle className="w-4 h-4" /> : i + 1}
                </div>
                <span className={`font-semibold text-sm ${step === i + 1 ? "text-white" : "text-blue-300"}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-12 overflow-y-auto">
        <div className="w-full max-w-lg">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-slate-500 hover:text-slate-700 text-sm font-medium mb-8 transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Sign In
          </button>

          {/* Progress bar (mobile) */}
          <div className="lg:hidden mb-6">
            <div className="flex items-center gap-2 mb-2">
              {steps.map((s, i) => (
                <div key={s} className="flex items-center gap-2 flex-1">
                  <div className={`w-full h-1.5 rounded-full transition-all ${step > i ? "bg-blue-600" : "bg-slate-200"}`} />
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-500">Step {step} of 3 — {steps[step - 1]}</p>
          </div>

          <div className="mb-8">
            <h2 className="text-slate-900 text-3xl font-black mb-1">Create Account</h2>
            <p className="text-slate-500">Step {step} of 3 — {steps[step - 1]}</p>
          </div>

          {/* STEP 1: Role */}
          {errors.form && (
            <div className="mb-4 text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {errors.form}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <p className="text-slate-700 font-semibold">I am signing up as a…</p>
              {errors.role && <p className="text-red-500 text-sm">{errors.role}</p>}
              <div className="grid grid-cols-1 gap-4">
                <button
                  onClick={() => setRole("patient")}
                  className={`flex items-center gap-5 rounded-2xl border-2 p-6 text-left transition-all ${
                    role === "patient" ? "border-teal-400 bg-teal-50 shadow-lg shadow-teal-100" : "border-slate-200 bg-white hover:border-teal-200 hover:shadow-md"
                  }`}
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${role === "patient" ? "bg-gradient-to-br from-teal-400 to-emerald-500 shadow-md" : "bg-teal-100"}`}>
                    <Heart className={`w-7 h-7 ${role === "patient" ? "text-white" : "text-teal-600"}`} />
                  </div>
                  <div className="flex-1">
                    <p className={`font-bold text-lg ${role === "patient" ? "text-teal-800" : "text-slate-800"}`}>Patient</p>
                    <p className="text-slate-500 text-sm mt-0.5">Monitor my own vitals, get AI health insights and stay connected with my care team.</p>
                  </div>
                  {role === "patient" && <CheckCircle className="w-6 h-6 text-teal-500 flex-shrink-0" />}
                </button>

                <button
                  onClick={() => setRole("doctor")}
                  className={`flex items-center gap-5 rounded-2xl border-2 p-6 text-left transition-all ${
                    role === "doctor" ? "border-blue-500 bg-blue-50 shadow-lg shadow-blue-100" : "border-slate-200 bg-white hover:border-blue-200 hover:shadow-md"
                  }`}
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 ${role === "doctor" ? "bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md" : "bg-blue-100"}`}>
                    <Stethoscope className={`w-7 h-7 ${role === "doctor" ? "text-white" : "text-blue-600"}`} />
                  </div>
                  <div className="flex-1">
                    <p className={`font-bold text-lg ${role === "doctor" ? "text-blue-800" : "text-slate-800"}`}>Healthcare Professional</p>
                    <p className="text-slate-500 text-sm mt-0.5">Access clinical dashboards, AI predictions, patient management and RAG explainability.</p>
                  </div>
                  {role === "doctor" && <CheckCircle className="w-6 h-6 text-blue-500 flex-shrink-0" />}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Personal Info */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-slate-700 text-sm font-semibold block mb-1.5">First Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input value={form.firstName} onChange={e => set("firstName", e.target.value)} placeholder="Sarah" className={`pl-10 ${inputCls("firstName")}`} />
                  </div>
                  {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
                </div>
                <div>
                  <label className="text-slate-700 text-sm font-semibold block mb-1.5">Last Name</label>
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input value={form.lastName} onChange={e => set("lastName", e.target.value)} placeholder="Johnson" className={`pl-10 ${inputCls("lastName")}`} />
                  </div>
                  {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
                </div>
              </div>

              <div>
                <label className="text-slate-700 text-sm font-semibold block mb-1.5">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="sarah@email.com" className={`pl-10 ${inputCls("email")}`} />
                </div>
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
              </div>

              <div>
                <label className="text-slate-700 text-sm font-semibold block mb-1.5">Phone Number</label>
                <div className="relative">
                  <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+44 7700 000000" className={`pl-10 ${inputCls("phone")}`} />
                </div>
                {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
              </div>

              {/* Role-specific */}
              {role === "doctor" ? (
                <>
                  <div>
                    <label className="text-slate-700 text-sm font-semibold block mb-1.5">Medical License Number</label>
                    <div className="relative">
                      <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input value={form.licenseNo} onChange={e => set("licenseNo", e.target.value)} placeholder="GMC-1234567" className={`pl-10 ${inputCls("licenseNo")}`} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-slate-700 text-sm font-semibold block mb-1.5">Hospital / Clinic</label>
                      <div className="relative">
                        <Building className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input value={form.hospital} onChange={e => set("hospital", e.target.value)} placeholder="City Hospital" className={`pl-10 ${inputCls("hospital")}`} />
                      </div>
                    </div>
                    <div>
                      <label className="text-slate-700 text-sm font-semibold block mb-1.5">Specialty</label>
                      <select value={form.specialty} onChange={e => set("specialty", e.target.value)} className={inputCls("specialty")}>
                        <option value="">Select…</option>
                        <option>Pulmonology</option>
                        <option>Cardiology</option>
                        <option>General Medicine</option>
                        <option>Intensive Care</option>
                        <option>Emergency Medicine</option>
                        <option>Pediatrics</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-slate-700 text-sm font-semibold block mb-1.5">Date of Birth</label>
                      <input type="date" value={form.dob} onChange={e => set("dob", e.target.value)} className={inputCls("dob")} />
                    </div>
                    <div>
                      <label className="text-slate-700 text-sm font-semibold block mb-1.5">Gender</label>
                      <select value={form.gender} onChange={e => set("gender", e.target.value)} className={inputCls("gender")}>
                        <option value="">Select…</option>
                        <option>Female</option>
                        <option>Male</option>
                        <option>Non-binary</option>
                        <option>Prefer not to say</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-slate-700 text-sm font-semibold block mb-1.5">Primary Condition</label>
                    <select value={form.condition} onChange={e => set("condition", e.target.value)} className={inputCls("condition")}>
                      <option value="">Select your condition…</option>
                      <option>Asthma (Mild)</option>
                      <option>Asthma (Moderate)</option>
                      <option>Asthma (Severe)</option>
                      <option>COPD Stage I</option>
                      <option>COPD Stage II</option>
                      <option>COPD Stage III</option>
                      <option>Bronchiectasis</option>
                      <option>Pulmonary Fibrosis</option>
                      <option>Other</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: Security */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <label className="text-slate-700 text-sm font-semibold block mb-1.5">Create Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type={showPw ? "text" : "password"} value={form.password} onChange={e => set("password", e.target.value)} placeholder="At least 8 characters" className={`pl-10 pr-11 ${inputCls("password")}`} />
                  <button onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
                {/* Strength indicator */}
                {form.password && (
                  <div className="mt-2">
                    <div className="flex gap-1 mb-1">
                      {[1, 2, 3, 4].map(i => (
                        <div key={i} className={`h-1 flex-1 rounded-full transition-all ${
                          form.password.length >= i * 3
                            ? i <= 1 ? "bg-red-400" : i <= 2 ? "bg-amber-400" : i <= 3 ? "bg-blue-400" : "bg-emerald-500"
                            : "bg-slate-200"
                        }`} />
                      ))}
                    </div>
                    <p className="text-xs text-slate-400">
                      {form.password.length < 4 ? "Weak" : form.password.length < 8 ? "Fair" : form.password.length < 12 ? "Good" : "Strong"}
                    </p>
                  </div>
                )}
              </div>

              <div>
                <label className="text-slate-700 text-sm font-semibold block mb-1.5">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input type={showPw ? "text" : "password"} value={form.confirmPw} onChange={e => set("confirmPw", e.target.value)} placeholder="Re-enter password" className={`pl-10 ${inputCls("confirmPw")}`} />
                  {form.confirmPw && form.password === form.confirmPw && (
                    <CheckCircle className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-500" />
                  )}
                </div>
                {errors.confirmPw && <p className="text-red-500 text-xs mt-1">{errors.confirmPw}</p>}
              </div>

              {/* 2FA */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-blue-800 text-sm font-semibold">Two-Factor Authentication</p>
                  <p className="text-blue-600 text-xs mt-0.5">2FA via SMS will be enabled automatically. You can manage this in Settings.</p>
                </div>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <button
                  onClick={() => { setAgreed(!agreed); setErrors(e => ({ ...e, agreed: "" })); }}
                  className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0 mt-0.5 ${agreed ? "bg-blue-600 border-blue-600" : "border-slate-300"}`}
                >
                  {agreed && <CheckCircle className="w-3 h-3 text-white" />}
                </button>
                <span className="text-slate-600 text-sm leading-relaxed">
                  I agree to the <button className="text-blue-600 font-medium underline">Terms of Service</button> and{" "}
                  <button className="text-blue-600 font-medium underline">Privacy Policy</button>. I understand this platform is a clinical decision-support tool and does not replace physician judgment.
                </span>
              </label>
              {errors.agreed && <p className="text-red-500 text-xs">{errors.agreed}</p>}
            </div>
          )}

          {/* Navigation buttons */}
          <div className={`flex gap-3 mt-8 ${step > 1 ? "flex-row" : "flex-col"}`}>
            {step > 1 && (
              <button onClick={() => setStep((s) => (s - 1) as Step)}
                className="flex-1 py-3.5 border-2 border-slate-200 rounded-xl text-slate-600 font-semibold hover:bg-slate-100 transition-all flex items-center justify-center gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={loading}
              className={`flex-1 py-4 rounded-xl font-bold text-white flex items-center justify-center gap-2.5 transition-all active:scale-[0.99] ${
                role === "doctor"
                  ? "bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-200"
                  : "bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 shadow-lg shadow-teal-200"
              }`}
            >
              {loading ? (
                <><div className="w-4.5 h-4.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Creating account…</>
              ) : step < 3 ? (
                <>Continue <ArrowRight className="w-4 h-4" /></>
              ) : (
                <><Sparkles className="w-4 h-4" /> Create My Account</>
              )}
            </button>
          </div>

          <p className="text-center text-slate-500 text-sm mt-5">
            Already have an account?{" "}
            <button onClick={() => navigate("/")} className="text-blue-600 font-bold hover:text-blue-700">Sign In</button>
          </p>
        </div>
      </div>
    </div>
  );
}

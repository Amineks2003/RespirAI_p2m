import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  Activity, Shield, Lock, Eye, EyeOff, Mail, Stethoscope,
  Heart, CheckCircle, Wifi, ArrowRight, Sparkles,
} from "lucide-react";
import { ApiError } from "../lib/api";
import { login } from "../lib/auth";
import { getSession } from "../lib/session";

export function LoginPage() {
  const navigate = useNavigate();
  const [role, setRole] = useState<"patient" | "doctor" | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; role?: string; form?: string }>({});

  useEffect(() => {
    const session = getSession();
    if (!session) return;

    navigate(session.role === "doctor" ? "/doctor" : "/patient", { replace: true });
  }, [navigate]);

  const validate = () => {
    const e: typeof errors = {};
    if (!role) e.role = "Please select a portal to continue.";
    if (!email.includes("@")) e.email = "Please enter a valid email address.";
    if (password.length < 6) e.password = "Password must be at least 6 characters.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSignIn = async () => {
    if (!validate()) return;
    setLoading(true);

    try {
      const response = await login({
        email,
        password,
        role: role as "doctor" | "patient",
      });

      navigate(response.user.role === "doctor" ? "/doctor" : "/patient");
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Unable to sign in right now.";
      setErrors((previous) => ({ ...previous, form: message }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left decorative panel */}
      <div className="hidden lg:flex w-1/2 bg-gradient-to-br from-blue-950 via-blue-900 to-indigo-900 flex-col items-center justify-center p-14 relative overflow-hidden">
        {/* Animated circles */}
        <div className="absolute w-96 h-96 rounded-full border border-white/5 top-[-80px] left-[-80px]" />
        <div className="absolute w-72 h-72 rounded-full border border-white/5 bottom-[-40px] right-[-40px]" />
        <div className="absolute w-48 h-48 rounded-full bg-blue-600/20 top-20 right-20 blur-3xl" />
        <div className="absolute w-64 h-64 rounded-full bg-cyan-500/10 bottom-20 left-10 blur-3xl" />

        <div className="relative z-10 text-center max-w-md">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-3xl bg-gradient-to-br from-blue-400 to-cyan-400 shadow-2xl shadow-blue-900/50 mb-8">
            <Activity className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-white text-4xl font-black mb-4 leading-tight">
            Respir<span className="text-cyan-400">AI</span>
          </h1>
          <p className="text-blue-200 text-lg mb-10 leading-relaxed">
            Anticipate respiratory deterioration earlier with explainable multimodal risk intelligence.
          </p>

          <div className="grid grid-cols-1 gap-4 text-left">
            {[
              { icon: Sparkles, title: "Trend-Aware AI Insights", desc: "2-model fusion with explainable factors and risk re-evaluation" },
              { icon: Shield, title: "Security By Design", desc: "Role-based access, encrypted data flow and audit-ready trails" },
              { icon: Heart, title: "Actionable Monitoring", desc: "Continuous vitals + environment context with early warning windows" },
            ].map((f) => (
              <div key={f.title} className="flex items-start gap-4 bg-white/5 rounded-2xl p-4 border border-white/10">
                <div className="w-9 h-9 rounded-xl bg-blue-500/30 flex items-center justify-center flex-shrink-0">
                  <f.icon className="w-4.5 h-4.5 text-cyan-300" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{f.title}</p>
                  <p className="text-blue-300 text-xs mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-6 mt-10">
            {["2h Alerts", "2 Models", "RAG Explainability", "24/7 Tracking"].map((b) => (
              <div key={b} className="text-center">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-1 border border-white/10">
                  <CheckCircle className="w-4 h-4 text-emerald-400" />
                </div>
                <p className="text-blue-300 text-[10px] font-semibold">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center bg-slate-50 px-6 py-12">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center shadow-lg">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="text-blue-900 font-black text-xl">Respir<span className="text-cyan-500">AI</span></span>
          </div>

          <div className="mb-8">
            <h2 className="text-slate-900 text-3xl font-black mb-2">Welcome back</h2>
            <p className="text-slate-500">Sign in to your account to continue</p>
          </div>

          {/* Role Cards */}
          <div className="mb-6">
            {errors.role && <p className="text-red-500 text-xs mb-2">{errors.role}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setRole("patient"); setErrors(e => ({ ...e, role: undefined })); }}
                className={`relative rounded-2xl border-2 p-5 text-left transition-all duration-200 ${
                  role === "patient"
                    ? "border-teal-400 bg-gradient-to-br from-teal-50 to-emerald-50 shadow-lg shadow-teal-100"
                    : "border-slate-200 bg-white hover:border-teal-200 hover:shadow-md"
                }`}
              >
                {role === "patient" && (
                  <div className="absolute top-3 right-3 w-5 h-5 bg-teal-500 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${
                  role === "patient" ? "bg-gradient-to-br from-teal-400 to-emerald-500 shadow-md shadow-teal-200" : "bg-teal-100"
                }`}>
                  <Heart className={`w-5 h-5 ${role === "patient" ? "text-white" : "text-teal-600"}`} />
                </div>
                <p className={`font-bold text-sm ${role === "patient" ? "text-teal-800" : "text-slate-700"}`}>Patient</p>
                <p className="text-slate-500 text-xs mt-0.5">Personal health portal</p>
              </button>

              <button
                onClick={() => { setRole("doctor"); setErrors(e => ({ ...e, role: undefined })); }}
                className={`relative rounded-2xl border-2 p-5 text-left transition-all duration-200 ${
                  role === "doctor"
                    ? "border-blue-500 bg-gradient-to-br from-blue-50 to-indigo-50 shadow-lg shadow-blue-100"
                    : "border-slate-200 bg-white hover:border-blue-200 hover:shadow-md"
                }`}
              >
                {role === "doctor" && (
                  <div className="absolute top-3 right-3 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center">
                    <CheckCircle className="w-3.5 h-3.5 text-white" />
                  </div>
                )}
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${
                  role === "doctor" ? "bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md shadow-blue-200" : "bg-blue-100"
                }`}>
                  <Stethoscope className={`w-5 h-5 ${role === "doctor" ? "text-white" : "text-blue-600"}`} />
                </div>
                <p className={`font-bold text-sm ${role === "doctor" ? "text-blue-800" : "text-slate-700"}`}>Clinician</p>
                <p className="text-slate-500 text-xs mt-0.5">Clinical dashboard</p>
              </button>
            </div>
          </div>

          {/* Fields */}
          <div className="space-y-4 mb-5">
            {errors.form && (
              <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {errors.form}
              </div>
            )}
            <div>
              <label className="text-slate-700 text-sm font-semibold block mb-1.5">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErrors(ev => ({ ...ev, email: undefined })); }}
                  placeholder="you@hospital.com"
                  className={`w-full pl-10 pr-4 py-3.5 bg-white border rounded-xl text-slate-700 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 transition-all ${
                    errors.email ? "border-red-300 focus:ring-red-200" : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                  }`}
                />
              </div>
              {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-slate-700 text-sm font-semibold">Password</label>
                <button className="text-blue-600 text-xs font-medium hover:text-blue-700">Forgot password?</button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrors(ev => ({ ...ev, password: undefined })); }}
                  placeholder="••••••••"
                  className={`w-full pl-10 pr-11 py-3.5 bg-white border rounded-xl text-slate-700 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 transition-all ${
                    errors.password ? "border-red-300 focus:ring-red-200" : "border-slate-200 focus:ring-blue-200 focus:border-blue-400"
                  }`}
                />
                <button onClick={() => setShowPw(!showPw)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <button
                onClick={() => setRememberMe(!rememberMe)}
                className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-all ${rememberMe ? "bg-blue-600 border-blue-600" : "border-slate-300"}`}
              >
                {rememberMe && <CheckCircle className="w-3 h-3 text-white" />}
              </button>
              <span className="text-slate-600 text-sm">Remember me for 30 days</span>
            </label>
          </div>

          <button
            onClick={handleSignIn}
            disabled={loading}
            className={`w-full py-4 rounded-xl font-bold text-white flex items-center justify-center gap-2.5 transition-all duration-200 ${
              role === "doctor"
                ? "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg shadow-blue-200"
                : role === "patient"
                ? "bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 shadow-lg shadow-teal-200"
                : "bg-gradient-to-r from-slate-400 to-slate-500 shadow-sm"
            } active:scale-[0.99]`}
          >
            {loading ? (
              <>
                <div className="w-4.5 h-4.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Authenticating…
              </>
            ) : (
              <>
                <Shield className="w-4.5 h-4.5" />
                Sign In Securely
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <p className="text-center text-slate-500 text-sm mt-5">
            Don't have an account?{" "}
            <button onClick={() => navigate("/signup")} className="text-blue-600 font-bold hover:text-blue-700 transition-colors">
              Create account
            </button>
          </p>

          {/* Security footer */}
          <div className="mt-8 flex items-center justify-center gap-4 pt-6 border-t border-slate-200">
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Lock className="w-3 h-3" /> 256-bit AES
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Wifi className="w-3 h-3" /> TLS 1.3
            </div>
            <div className="w-px h-3 bg-slate-200" />
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <Shield className="w-3 h-3" /> 2FA Ready
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

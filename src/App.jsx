import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar, ReferenceLine } from "recharts";

// ==================== STORAGE (localStorage for PWA) ====================
const STORAGE_KEYS = {
  profile: "coach-profile-v2",
  weights: "coach-weights-v2",
  workouts: "coach-workouts-v2",
  program: "coach-program-v2",
  targets: "coach-targets-v2",
  checkins: "coach-checkins-v2",
  apiKey: "coach-api-key",
};

const loadStorage = (key) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
};

const saveStorage = (key, data) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) { console.error("Storage:", e); }
};

// ==================== THEME ====================
const FONTS = `'JetBrains Mono', 'SF Mono', 'Fira Code', monospace`;
const FONT_BODY = `'DM Sans', 'Helvetica Neue', sans-serif`;

const COLORS = {
  bg: "1e1e2a", surface: "#12121a", surfaceLight: "#1a1a26", surfaceDark: "#08080d",
  border: "#2a2a3a", borderLight: "#3a3a4e",
  accent: "#00e5a0", accentDim: "#00e5a033", accentMid: "#00e5a066",
  warning: "#ffb347", warningDim: "#ffb34733",
  danger: "#ff6b6b", dangerDim: "#ff6b6b33",
  text: "#e8e8f0", textDim: "#8888a0", textMuted: "#55556a",
  blue: "#4ecbff", blueDim: "#4ecbff33",
  purple: "#b388ff", purpleDim: "#b388ff33",
};

// ==================== UTILITIES ====================
const formatDate = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const formatDateFull = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const today = () => new Date().toISOString().split("T")[0];
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

const calcBMR = (sex, weightKg, heightCm, age) => {
  if (sex === "male") return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
};

const activityMultipliers = {
  sedentary: { label: "Sedentary (desk, <5k steps)", value: 1.2 },
  light: { label: "Light (5-7k steps)", value: 1.375 },
  moderate: { label: "Moderate (8-10k steps)", value: 1.55 },
  active: { label: "Active (10k+ steps)", value: 1.725 },
  very_active: { label: "Very Active (intense daily)", value: 1.9 },
};

const lbsToKg = (lbs) => lbs * 0.453592;
const cmToFeetInches = (cm) => { const ti = cm / 2.54; return `${Math.floor(ti / 12)}'${Math.round(ti % 12)}"`; };

const calcRollingAvg = (weights, days = 7) => {
  if (weights.length < 2) return weights;
  const sorted = [...weights].sort((a, b) => new Date(a.date) - new Date(b.date));
  return sorted.map((entry, i) => {
    const windowStart = Math.max(0, i - days + 1);
    const w = sorted.slice(windowStart, i + 1);
    const avg = w.reduce((sum, x) => sum + x.weight, 0) / w.length;
    return { ...entry, avg: Math.round(avg * 10) / 10 };
  });
};

const calcWeeklyLoss = (weights) => {
  if (weights.length < 7) return null;
  const sorted = [...weights].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recent7 = sorted.slice(-7);
  const prev7 = sorted.slice(-14, -7);
  if (prev7.length < 3) return null;
  const recentAvg = recent7.reduce((s, w) => s + w.weight, 0) / recent7.length;
  const prevAvg = prev7.reduce((s, w) => s + w.weight, 0) / prev7.length;
  return Math.round((prevAvg - recentAvg) * 10) / 10;
};

// ==================== ADHERENCE ENGINE ====================
const calcAdherence = (checkin, targets, profile) => {
  if (!checkin || !targets) return { total: 0, breakdown: {} };
  const scores = {};
  if (checkin.calories && targets.calories) {
    const pctOff = Math.abs(checkin.calories - targets.calories) / targets.calories;
    scores.calories = pctOff <= 0.05 ? 100 : pctOff <= 0.10 ? 75 : pctOff <= 0.15 ? 50 : 25;
  }
  if (checkin.protein && targets.protein) {
    const pctOff = Math.abs(checkin.protein - targets.protein) / targets.protein;
    scores.protein = pctOff <= 0.10 ? 100 : pctOff <= 0.20 ? 75 : pctOff <= 0.30 ? 50 : 25;
  }
  if (checkin.workoutCompleted !== undefined) scores.workout = checkin.workoutCompleted ? 100 : 0;
  if (checkin.steps) {
    const stepTarget = profile?.stepTarget || 8000;
    const pctHit = checkin.steps / stepTarget;
    scores.steps = pctHit >= 0.95 ? 100 : pctHit >= 0.80 ? 75 : pctHit >= 0.60 ? 50 : 25;
  }
  const vals = Object.values(scores);
  return { total: vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0, breakdown: scores };
};

const getAdherenceColor = (s) => s >= 85 ? COLORS.accent : s >= 65 ? COLORS.blue : s >= 45 ? COLORS.warning : COLORS.danger;
const getAdherenceLabel = (s) => s >= 90 ? "EXCELLENT" : s >= 75 ? "GOOD" : s >= 60 ? "FAIR" : s >= 40 ? "NEEDS WORK" : "OFF TRACK";

const calcRecovery = (checkin) => {
  if (!checkin) return { score: 0, status: "UNKNOWN" };
  let score = 50;
  if (checkin.sleepHours >= 7.5) score += 20; else if (checkin.sleepHours >= 6.5) score += 10; else if (checkin.sleepHours < 5.5) score -= 15;
  if (checkin.stress <= 3) score += 20; else if (checkin.stress <= 5) score += 10; else if (checkin.stress >= 8) score -= 15; else if (checkin.stress >= 6) score -= 5;
  if (checkin.energy >= 7) score += 10; else if (checkin.energy <= 3) score -= 10;
  score = Math.max(0, Math.min(100, score));
  return { score, status: score >= 80 ? "OPTIMAL" : score >= 60 ? "ADEQUATE" : score >= 40 ? "FATIGUED" : "RECOVERY NEEDED" };
};

// ==================== AI COACHING (uses user-provided API key) ====================
const getApiKey = () => localStorage.getItem(STORAGE_KEYS.apiKey)?.replace(/"/g, '') || '';

const callClaude = async (prompt) => {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      console.error("API error:", response.status, err);
      return null;
    }
    const data = await response.json();
    const text = data.content?.map(i => i.text || "").join("\n") || "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch (err) {
    console.error("AI call failed:", err);
    return null;
  }
};

const getAICoachingAnalysis = async (checkin, targets, profile, recentCheckins, weights) => {
  const sorted = [...weights].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recentWeight = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const weeklyLoss = calcWeeklyLoss(sorted);
  const adherence = calcAdherence(checkin, targets, profile);
  const recovery = calcRecovery(checkin);
  const last7 = recentCheckins.slice(-7);
  const avgAdherence = last7.length > 0 ? Math.round(last7.reduce((s, c) => s + calcAdherence(c, targets, profile).total, 0) / last7.length) : adherence.total;

  return callClaude(`You are an elite fat-loss coach. Analyze this daily check-in and give a BRIEF coaching response.

ATHLETE: ${profile.name}, Age ${profile.age}, Goal: ${profile.goalWeightLbs}lbs
Current weight: ${recentWeight?.weight || profile.weightLbs}lbs | Weekly loss: ${weeklyLoss !== null ? weeklyLoss + " lbs/wk" : "insufficient data"}
Training target: ${profile.trainingDays}/week

TARGETS: ${targets.calories} kcal | ${targets.protein}g P | ${targets.carbs}g C | ${targets.fat}g F

TODAY: Calories: ${checkin.calories || "—"} | Protein: ${checkin.protein}g | Carbs: ${checkin.carbs}g | Fat: ${checkin.fat}g
Workout: ${checkin.workoutCompleted ? "Yes" : "No/Rest"} | Steps: ${checkin.steps || "—"}
Sleep: ${checkin.sleepHours}hrs | Stress: ${checkin.stress}/10 | Energy: ${checkin.energy}/10
Notes: ${checkin.notes || "none"}
Adherence: Today ${adherence.total}% | 7-day avg: ${avgAdherence}% | Recovery: ${recovery.status} (${recovery.score}/100)

Respond ONLY in this JSON:
{"summary":"1-2 sentences","nutritionNote":"brief","recoveryNote":"brief","adjustment":"correction or None needed","tomorrowPriority":"single clear cue","concern":null}`);
};

const getWeeklyReview = async (checkins, weights, workouts, targets, profile, program) => {
  const last7 = checkins.slice(-7);
  const sorted = [...weights].sort((a, b) => new Date(a.date) - new Date(b.date));
  const weeklyLoss = calcWeeklyLoss(sorted);
  const avgCals = last7.length > 0 ? Math.round(last7.reduce((s, c) => s + (c.calories || 0), 0) / last7.length) : 0;
  const avgProtein = last7.length > 0 ? Math.round(last7.reduce((s, c) => s + (c.protein || 0), 0) / last7.length) : 0;
  const workoutCount = last7.filter(c => c.workoutCompleted).length;
  const avgAdherence = last7.length > 0 ? Math.round(last7.reduce((s, c) => s + calcAdherence(c, targets, profile).total, 0) / last7.length) : 0;
  const daysInDeficit = profile.createdAt ? daysBetween(profile.createdAt, today()) : 0;

  let plateauDetected = false;
  const recent14 = sorted.slice(-14);
  if (recent14.length >= 12) {
    const a1 = recent14.slice(0, 7).reduce((s, w) => s + w.weight, 0) / recent14.slice(0, 7).length;
    const a2 = recent14.slice(-7).reduce((s, w) => s + w.weight, 0) / recent14.slice(-7).length;
    if (Math.abs(a1 - a2) / a1 * 100 < 0.25 && avgAdherence >= 85) plateauDetected = true;
  }

  return callClaude(`Elite fat-loss coach WEEKLY REVIEW.

PROFILE: ${profile.name}, ${profile.age}yo, ${profile.sex}, ${profile.weightLbs}→${profile.goalWeightLbs}lbs goal
Current: ${sorted.length > 0 ? sorted[sorted.length - 1].weight : profile.weightLbs}lbs | Days in deficit: ${daysInDeficit} | Program: ${program?.type || "Full Body"}

THIS WEEK: Avg Cal: ${avgCals} (target ${targets.calories}) | Avg Protein: ${avgProtein}g (target ${targets.protein}g)
Workouts: ${workoutCount}/${profile.trainingDays} | Adherence: ${avgAdherence}%
Weekly loss: ${weeklyLoss !== null ? weeklyLoss + " lbs" : "—"} (target: ${targets.weeklyLossTarget} lbs)
Plateau: ${plateauDetected ? "YES" : "No"} | Diet break eligible: ${daysInDeficit >= 56 ? "YES" : "No (" + daysInDeficit + " days)"}

RULES: Loss slow + adherence≥80% → decrease 50-150kcal. Loss fast → increase slightly. Plateau → small cal reduction OR step increase OR conditioning. Never stack. Diet break at 8-12wks if declining.

Respond ONLY in this JSON:
{"weekSummary":"2-3 sentences","complianceRating":"EXCELLENT/GOOD/FAIR/POOR","weightAnalysis":"brief","calorieAdjustment":{"action":"maintain/decrease/increase","amount":0,"reason":"why"},"trainingNote":"brief","dietBreakRecommendation":null,"plateauAction":null,"nextWeekFocus":"1-2 priorities","flags":[]}`);
};

// ==================== UI COMPONENTS ====================
const Card = ({ children, style, glow }) => (
  <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "20px",
    ...(glow ? { boxShadow: `0 0 20px ${glow}22, inset 0 1px 0 ${glow}11` } : {}), ...style }}>{children}</div>
);

const StatBox = ({ label, value, unit, sub, color, small }) => (
  <div style={{ background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: small ? "12px" : "16px", flex: 1, minWidth: small ? 80 : 120 }}>
    <div style={{ fontFamily: FONTS, fontSize: small ? 9 : 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: small ? 4 : 6 }}>{label}</div>
    <div style={{ fontFamily: FONTS, fontSize: small ? 18 : 26, fontWeight: 700, color: color || COLORS.text, lineHeight: 1.1 }}>
      {value}<span style={{ fontSize: small ? 10 : 13, color: COLORS.textDim, marginLeft: 3 }}>{unit}</span>
    </div>
    {sub && <div style={{ fontFamily: FONTS, fontSize: small ? 9 : 11, color: COLORS.textMuted, marginTop: 4 }}>{sub}</div>}
  </div>
);

const Input = ({ label, ...props }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <label style={{ display: "block", fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</label>}
    <input {...props} style={{ width: "100%", background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px", color: COLORS.text, fontFamily: FONTS, fontSize: 14, outline: "none", boxSizing: "border-box", ...(props.style || {}) }} />
  </div>
);

const Select = ({ label, options, ...props }) => (
  <div style={{ marginBottom: 14 }}>
    {label && <label style={{ display: "block", fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 5 }}>{label}</label>}
    <select {...props} style={{ width: "100%", background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px", color: COLORS.text, fontFamily: FONTS, fontSize: 14, outline: "none", boxSizing: "border-box", ...(props.style || {}) }}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
);

const Btn = ({ children, variant = "primary", ...props }) => {
  const styles = {
    primary: { background: COLORS.accent, color: COLORS.bg, fontWeight: 700 },
    secondary: { background: COLORS.surfaceLight, color: COLORS.text, border: `1px solid ${COLORS.border}` },
    danger: { background: COLORS.dangerDim, color: COLORS.danger, border: `1px solid ${COLORS.danger}44` },
    ghost: { background: "transparent", color: COLORS.textDim },
    blue: { background: COLORS.blueDim, color: COLORS.blue, border: `1px solid ${COLORS.blue}44` },
    warning: { background: COLORS.warningDim, color: COLORS.warning, border: `1px solid ${COLORS.warning}44` },
  };
  return <button {...props} style={{ padding: "10px 18px", borderRadius: 8, border: "none", fontFamily: FONTS, fontSize: 13, cursor: "pointer", transition: "all 0.15s", letterSpacing: "0.02em", ...styles[variant], ...(props.style || {}) }}>{children}</button>;
};

const SectionHeader = ({ children, right }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
    <h2 style={{ fontFamily: FONTS, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em", color: COLORS.accent, margin: 0, fontWeight: 600 }}>{children}</h2>
    {right}
  </div>
);

const ScoreRing = ({ score, size = 80, strokeWidth = 6, color }) => {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const col = color || getAdherenceColor(score);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={COLORS.border} strokeWidth={strokeWidth} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={strokeWidth}
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.5s ease" }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{ transform: "rotate(90deg)", transformOrigin: "center", fontFamily: FONTS, fontSize: size*0.25, fontWeight: 700, fill: col }}>{score}</text>
    </svg>
  );
};

const DeltaTag = ({ value, unit = "", inverse = false }) => {
  const positive = inverse ? value < 0 : value > 0;
  const color = value === 0 ? COLORS.textMuted : positive ? COLORS.accent : COLORS.danger;
  return <span style={{ fontFamily: FONTS, fontSize: 11, color, fontWeight: 600 }}>{value > 0 ? "+" : ""}{value}{unit}</span>;
};

// ==================== TRAINING PROGRAM GENERATOR ====================
const generateProgram = (daysPerWeek, experience, equipment) => {
  const hasBarbell = equipment?.includes("barbell") || equipment === "full";
  const hasMachines = equipment?.includes("machine") || equipment === "full";
  const fullBodyA = { name: "Full Body A", exercises: [
    { name: hasBarbell ? "Barbell Squat" : "Goblet Squat", sets: 3, repsMin: 6, repsMax: 10, type: "primary", weight: 0 },
    { name: hasBarbell ? "Bench Press" : "DB Bench Press", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: hasBarbell ? "Barbell Row" : "DB Row", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: "Lateral Raise", sets: 3, repsMin: 12, repsMax: 15, type: "accessory", weight: 0 },
    { name: "Plank", sets: 3, repsMin: 30, repsMax: 60, type: "accessory", weight: 0 },
  ]};
  const fullBodyB = { name: "Full Body B", exercises: [
    { name: hasBarbell ? "Romanian Deadlift" : "DB RDL", sets: 3, repsMin: 8, repsMax: 12, type: "primary", weight: 0 },
    { name: hasBarbell ? "Overhead Press" : "DB Shoulder Press", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: hasMachines ? "Lat Pulldown" : "DB Pullover", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: "Leg Curl", sets: 3, repsMin: 10, repsMax: 15, type: "accessory", weight: 0 },
    { name: "Face Pull / Band Pull Apart", sets: 3, repsMin: 15, repsMax: 20, type: "accessory", weight: 0 },
  ]};
  const upperA = { name: "Upper A — Push", exercises: [
    { name: hasBarbell ? "Bench Press" : "DB Bench Press", sets: 4, repsMin: 6, repsMax: 10, type: "primary", weight: 0 },
    { name: hasBarbell ? "Barbell Row" : "DB Row", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: hasBarbell ? "Overhead Press" : "DB Shoulder Press", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: "Tricep Pushdown", sets: 3, repsMin: 10, repsMax: 15, type: "accessory", weight: 0 },
    { name: "Lateral Raise", sets: 3, repsMin: 12, repsMax: 15, type: "accessory", weight: 0 },
  ]};
  const upperB = { name: "Upper B — Pull", exercises: [
    { name: hasMachines ? "Lat Pulldown" : "Pull-Up / Assisted", sets: 4, repsMin: 6, repsMax: 10, type: "primary", weight: 0 },
    { name: "DB Bench Press", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: "Cable / DB Row", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: "Bicep Curl", sets: 3, repsMin: 10, repsMax: 15, type: "accessory", weight: 0 },
    { name: "Face Pull", sets: 3, repsMin: 15, repsMax: 20, type: "accessory", weight: 0 },
  ]};
  const lowerA = { name: "Lower A — Quad", exercises: [
    { name: hasBarbell ? "Barbell Squat" : "Goblet Squat", sets: 4, repsMin: 6, repsMax: 10, type: "primary", weight: 0 },
    { name: hasMachines ? "Leg Press" : "Bulgarian Split Squat", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: "Leg Curl", sets: 3, repsMin: 10, repsMax: 15, type: "accessory", weight: 0 },
    { name: "Calf Raise", sets: 3, repsMin: 12, repsMax: 20, type: "accessory", weight: 0 },
    { name: "Ab Rollout / Plank", sets: 3, repsMin: 10, repsMax: 15, type: "accessory", weight: 0 },
  ]};
  const lowerB = { name: "Lower B — Hinge", exercises: [
    { name: hasBarbell ? "Romanian Deadlift" : "DB RDL", sets: 4, repsMin: 6, repsMax: 10, type: "primary", weight: 0 },
    { name: "Bulgarian Split Squat", sets: 3, repsMin: 8, repsMax: 12, type: "compound", weight: 0 },
    { name: hasMachines ? "Leg Extension" : "Lunge", sets: 3, repsMin: 10, repsMax: 15, type: "accessory", weight: 0 },
    { name: "Hip Thrust", sets: 3, repsMin: 8, repsMax: 12, type: "accessory", weight: 0 },
    { name: "Hanging Leg Raise", sets: 3, repsMin: 10, repsMax: 15, type: "accessory", weight: 0 },
  ]};
  if (daysPerWeek <= 3) return { type: "Full Body", sessions: [fullBodyA, fullBodyB, fullBodyA] };
  if (daysPerWeek === 4) return { type: "Upper / Lower", sessions: [upperA, lowerA, upperB, lowerB] };
  return { type: "Upper / Lower (5-day)", sessions: [upperA, lowerA, upperB, lowerB, fullBodyA] };
};

// ==================== MAIN APP ====================
export default function EliteCoachApp() {
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("checkin");
  const [profile, setProfile] = useState(null);
  const [weights, setWeights] = useState([]);
  const [workouts, setWorkouts] = useState([]);
  const [program, setProgram] = useState(null);
  const [targets, setTargets] = useState(null);
  const [checkins, setCheckins] = useState([]);

  useEffect(() => {
    setProfile(loadStorage(STORAGE_KEYS.profile));
    setWeights(loadStorage(STORAGE_KEYS.weights) || []);
    setWorkouts(loadStorage(STORAGE_KEYS.workouts) || []);
    setProgram(loadStorage(STORAGE_KEYS.program));
    setTargets(loadStorage(STORAGE_KEYS.targets));
    setCheckins(loadStorage(STORAGE_KEYS.checkins) || []);
    setLoading(false);
  }, []);

  const s = {
    profile: (p) => { setProfile(p); saveStorage(STORAGE_KEYS.profile, p); },
    weights: (w) => { setWeights(w); saveStorage(STORAGE_KEYS.weights, w); },
    workouts: (w) => { setWorkouts(w); saveStorage(STORAGE_KEYS.workouts, w); },
    program: (p) => { setProgram(p); saveStorage(STORAGE_KEYS.program, p); },
    targets: (t) => { setTargets(t); saveStorage(STORAGE_KEYS.targets, t); },
    checkins: (c) => { setCheckins(c); saveStorage(STORAGE_KEYS.checkins, c); },
  };

  if (loading) return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ fontFamily: FONTS, color: COLORS.accent, fontSize: 14, letterSpacing: "0.1em" }}>LOADING...</div>
    </div>
  );

  if (!profile) return <OnboardingFlow onComplete={(p, t, pr) => { s.profile(p); s.targets(t); s.program(pr); }} />;

  const tabs = [
    { id: "checkin", label: "CHECK-IN" },
    { id: "dashboard", label: "DASH" },
    { id: "weight", label: "WEIGHT" },
    { id: "training", label: "TRAIN" },
    { id: "review", label: "REVIEW" },
    { id: "settings", label: "SETUP" },
  ];

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.text, fontFamily: FONT_BODY }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", position: "sticky", top: 0, zIndex: 100 }}>
        <div>
          <div style={{ fontFamily: FONTS, fontSize: 15, fontWeight: 700, color: COLORS.accent, letterSpacing: "0.12em" }}>ELITE COACH</div>
          <div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted, letterSpacing: "0.06em", marginTop: 2 }}>{profile.name?.toUpperCase()} — DAY {daysBetween(profile.createdAt, today()) + 1}</div>
        </div>
        <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim }}>{targets?.calories && `${targets.calories} KCAL`}</div>
      </div>

      <div style={{ display: "flex", background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: "0 4px", overflowX: "auto" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, minWidth: 56, padding: "11px 4px", background: "none", border: "none",
            borderBottom: tab === t.id ? `2px solid ${COLORS.accent}` : "2px solid transparent",
            color: tab === t.id ? COLORS.accent : COLORS.textMuted, fontFamily: FONTS, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", cursor: "pointer",
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: "20px", maxWidth: 600, margin: "0 auto", paddingBottom: 80 }}>
        {tab === "checkin" && <CheckInView checkins={checkins} onSave={s.checkins} weights={weights} onSaveWeights={s.weights} targets={targets} profile={profile} />}
        {tab === "dashboard" && <DashboardView profile={profile} weights={weights} workouts={workouts} targets={targets} checkins={checkins} />}
        {tab === "weight" && <WeightView weights={weights} onSave={s.weights} profile={profile} targets={targets} />}
        {tab === "training" && <TrainingView program={program} workouts={workouts} onSaveWorkouts={s.workouts} onSaveProgram={s.program} />}
        {tab === "review" && <WeeklyReviewView checkins={checkins} weights={weights} workouts={workouts} targets={targets} profile={profile} program={program} onSaveTargets={s.targets} />}
        {tab === "settings" && <SettingsView profile={profile} targets={targets} program={program} save={s} weights={weights} workouts={workouts} checkins={checkins} />}
      </div>
    </div>
  );
}

// ==================== ONBOARDING ====================
function OnboardingFlow({ onComplete }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState({ name: "", age: "", sex: "male", heightCm: "", weightLbs: "", goalWeightLbs: "", goalWeeks: "12", trainingDays: "3", sessionMin: "60", equipment: "full", experience: "intermediate", activity: "moderate", stepTarget: "8000" });
  const up = (f, v) => setData(d => ({ ...d, [f]: v }));

  const steps = [
    { title: "ABOUT YOU", fields: (<>
      <Input label="Name" value={data.name} onChange={e => up("name", e.target.value)} placeholder="Your name" />
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><Input label="Age" type="number" value={data.age} onChange={e => up("age", e.target.value)} /></div>
        <div style={{ flex: 1 }}><Select label="Sex at birth" value={data.sex} onChange={e => up("sex", e.target.value)} options={[{ value: "male", label: "Male" }, { value: "female", label: "Female" }]} /></div>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1 }}><Input label="Height (cm)" type="number" value={data.heightCm} onChange={e => up("heightCm", e.target.value)} /></div>
        <div style={{ flex: 1 }}><Input label="Weight (lbs)" type="number" value={data.weightLbs} onChange={e => up("weightLbs", e.target.value)} /></div>
      </div>
    </>), valid: data.name && data.age && data.heightCm && data.weightLbs },
    { title: "YOUR GOAL", fields: (<>
      <Input label="Goal Weight (lbs)" type="number" value={data.goalWeightLbs} onChange={e => up("goalWeightLbs", e.target.value)} />
      <Select label="Timeframe" value={data.goalWeeks} onChange={e => up("goalWeeks", e.target.value)} options={[8,10,12,16,20,24].map(n => ({ value: String(n), label: `${n} weeks` }))} />
      <Select label="Activity Level" value={data.activity} onChange={e => up("activity", e.target.value)} options={Object.entries(activityMultipliers).map(([k, v]) => ({ value: k, label: v.label }))} />
      <Input label="Daily Step Target" type="number" value={data.stepTarget} onChange={e => up("stepTarget", e.target.value)} />
    </>), valid: data.goalWeightLbs },
    { title: "TRAINING", fields: (<>
      <Select label="Training Days / Week" value={data.trainingDays} onChange={e => up("trainingDays", e.target.value)} options={[2,3,4,5,6].map(n => ({ value: String(n), label: `${n} days` }))} />
      <Select label="Session Length" value={data.sessionMin} onChange={e => up("sessionMin", e.target.value)} options={[30,45,60,75,90].map(n => ({ value: String(n), label: `${n} min` }))} />
      <Select label="Equipment" value={data.equipment} onChange={e => up("equipment", e.target.value)} options={[{ value: "full", label: "Full Gym" }, { value: "barbell", label: "Barbell + Rack" }, { value: "dumbbell", label: "Dumbbells Only" }, { value: "minimal", label: "Minimal / Home" }]} />
      <Select label="Experience" value={data.experience} onChange={e => up("experience", e.target.value)} options={[{ value: "beginner", label: "Beginner" }, { value: "intermediate", label: "Intermediate" }, { value: "advanced", label: "Advanced" }]} />
    </>), valid: true },
  ];

  const finalize = () => {
    const wKg = lbsToKg(parseFloat(data.weightLbs)), hCm = parseFloat(data.heightCm), age = parseInt(data.age);
    const bmr = calcBMR(data.sex, wKg, hCm, age);
    const tdee = Math.round(bmr * activityMultipliers[data.activity].value);
    const toLose = parseFloat(data.weightLbs) - parseFloat(data.goalWeightLbs);
    const weeks = parseInt(data.goalWeeks), wl = toLose / weeks;
    const dd = Math.round((wl * 3500) / 7);
    const cal = Math.max(1200, Math.round(tdee - dd));
    const pG = Math.round(parseFloat(data.goalWeightLbs) * 0.85);
    const fG = Math.round((cal * 0.25) / 9);
    const cG = Math.round((cal - (pG * 4) - (fG * 9)) / 4);
    onComplete(
      { name: data.name, age, sex: data.sex, heightCm: hCm, weightLbs: parseFloat(data.weightLbs), goalWeightLbs: parseFloat(data.goalWeightLbs), goalWeeks: weeks, activity: data.activity, trainingDays: parseInt(data.trainingDays), sessionMin: parseInt(data.sessionMin), equipment: data.equipment, experience: data.experience, bmr: Math.round(bmr), tdee, stepTarget: parseInt(data.stepTarget) || 8000, createdAt: today() },
      { calories: cal, protein: pG, carbs: cG, fat: fG, weeklyLossTarget: Math.round(wl * 10) / 10, dailyDeficit: dd, tdee },
      generateProgram(parseInt(data.trainingDays), data.experience, data.equipment)
    );
  };

  const cur = steps[step];
  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", color: COLORS.text, fontFamily: FONT_BODY, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ fontFamily: FONTS, fontSize: 18, fontWeight: 700, color: COLORS.accent, letterSpacing: "0.14em", marginBottom: 6 }}>ELITE COACH</div>
      <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textMuted, letterSpacing: "0.08em", marginBottom: 32 }}>PROFILE SETUP</div>
      <Card style={{ maxWidth: 420, width: "100%" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>{steps.map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? COLORS.accent : COLORS.border }} />)}</div>
        <div style={{ fontFamily: FONTS, fontSize: 12, color: COLORS.accent, letterSpacing: "0.1em", marginBottom: 16, fontWeight: 600 }}>STEP {step + 1} — {cur.title}</div>
        {cur.fields}
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          {step > 0 && <Btn variant="secondary" onClick={() => setStep(s => s - 1)}>BACK</Btn>}
          <Btn style={{ flex: 1, opacity: cur.valid ? 1 : 0.4 }} onClick={() => { if (!cur.valid) return; step < steps.length - 1 ? setStep(s => s + 1) : finalize(); }}>
            {step === steps.length - 1 ? "BUILD MY PLAN" : "CONTINUE"}
          </Btn>
        </div>
      </Card>
    </div>
  );
}

// ==================== DAILY CHECK-IN ====================
function CheckInView({ checkins, onSave, weights, onSaveWeights, targets, profile }) {
  const todayCheckin = checkins.find(c => c.date === today());
  const [form, setForm] = useState(todayCheckin || { date: today(), weight: "", calories: "", protein: "", carbs: "", fat: "", fiber: "", workoutCompleted: false, steps: "", sleepHours: "", stress: 5, energy: 5, notes: "" });
  const [aiResponse, setAiResponse] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [saved, setSaved] = useState(!!todayCheckin);
  const up = (f, v) => setForm(d => ({ ...d, [f]: v }));

  const handleSave = async () => {
    const entry = { ...form, calories: parseInt(form.calories)||0, protein: parseInt(form.protein)||0, carbs: parseInt(form.carbs)||0, fat: parseInt(form.fat)||0, fiber: parseInt(form.fiber)||0, steps: parseInt(form.steps)||0, sleepHours: parseFloat(form.sleepHours)||0, stress: parseInt(form.stress)||5, energy: parseInt(form.energy)||5, weight: parseFloat(form.weight)||0 };
    const ex = checkins.findIndex(c => c.date === today());
    const updated = ex >= 0 ? checkins.map((c, i) => i === ex ? entry : c) : [...checkins, entry];
    onSave(updated);
    if (entry.weight > 0) {
      const wEx = weights.findIndex(w => w.date === today());
      onSaveWeights(wEx >= 0 ? weights.map((w, i) => i === wEx ? { date: today(), weight: entry.weight } : w) : [...weights, { date: today(), weight: entry.weight }]);
    }
    setSaved(true);
    if (getApiKey()) {
      setAiLoading(true);
      const analysis = await getAICoachingAnalysis(entry, targets, profile, updated, weights);
      setAiResponse(analysis);
      setAiLoading(false);
    }
  };

  const adherence = calcAdherence(form, targets, profile);
  const recovery = calcRecovery(form);
  const hasApiKey = !!getApiKey();

  return (
    <div>
      <SectionHeader>Check-In — {formatDate(today())}</SectionHeader>

      {saved && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column" }}>
            <ScoreRing score={adherence.total} size={90} />
            <div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted, marginTop: 6 }}>{getAdherenceLabel(adherence.total)}</div>
          </div>
          <div style={{ flex: 1.5 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {[{ l: "Calories", v: adherence.breakdown.calories, c: COLORS.accent }, { l: "Protein", v: adherence.breakdown.protein, c: COLORS.blue }, { l: "Workout", v: adherence.breakdown.workout, c: COLORS.purple }, { l: "Steps", v: adherence.breakdown.steps, c: COLORS.warning }].map(item => (
                <div key={item.l} style={{ background: COLORS.surfaceLight, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.textMuted }}>{item.l}</div>
                  <div style={{ fontFamily: FONTS, fontSize: 16, fontWeight: 700, color: item.v >= 75 ? item.c : item.v >= 50 ? COLORS.warning : COLORS.danger }}>{item.v !== undefined ? `${item.v}%` : "—"}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>NUTRITION — MFP TOTALS</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Input label={`Calories (target: ${targets?.calories||"—"})`} type="number" value={form.calories} onChange={e => up("calories", e.target.value)} />
          <Input label={`Protein (target: ${targets?.protein||"—"}g)`} type="number" value={form.protein} onChange={e => up("protein", e.target.value)} />
          <Input label={`Carbs (target: ${targets?.carbs||"—"}g)`} type="number" value={form.carbs} onChange={e => up("carbs", e.target.value)} />
          <Input label={`Fat (target: ${targets?.fat||"—"}g)`} type="number" value={form.fat} onChange={e => up("fat", e.target.value)} />
        </div>
        {form.calories && targets && (
          <div style={{ display: "flex", gap: 16, padding: "10px 0", borderTop: `1px solid ${COLORS.border}`, marginTop: 8 }}>
            {[{ l:"Cal", d:parseInt(form.calories)-targets.calories }, { l:"Pro", d:parseInt(form.protein||0)-targets.protein, u:"g" }, { l:"Carb", d:parseInt(form.carbs||0)-targets.carbs, u:"g" }, { l:"Fat", d:parseInt(form.fat||0)-targets.fat, u:"g" }].map(i => (
              <div key={i.l} style={{ textAlign: "center" }}><div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.textMuted }}>{i.l}</div><DeltaTag value={i.d||0} unit={i.u||""} inverse={i.l==="Cal"||i.l==="Fat"} /></div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>BODY & ACTIVITY</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Input label="Morning Weight (lbs)" type="number" value={form.weight} onChange={e => up("weight", e.target.value)} step="0.1" />
          <Input label={`Steps (target: ${profile?.stepTarget||8000})`} type="number" value={form.steps} onChange={e => up("steps", e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>Workout Completed?</label>
          <div style={{ display: "flex", gap: 8 }}>
            {[{ l: "YES", v: true }, { l: "NO / REST", v: false }].map(opt => (
              <button key={opt.l} onClick={() => up("workoutCompleted", opt.v)} style={{ flex: 1, padding: "10px", borderRadius: 8, border: `1px solid ${form.workoutCompleted === opt.v ? COLORS.accent : COLORS.border}`, background: form.workoutCompleted === opt.v ? COLORS.accentDim : COLORS.surfaceLight, color: form.workoutCompleted === opt.v ? COLORS.accent : COLORS.textDim, fontFamily: FONTS, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{opt.l}</button>
            ))}
          </div>
        </div>
      </Card>

      <Card style={{ marginBottom: 12 }}>
        <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>RECOVERY</div>
        <Input label="Sleep (hours)" type="number" value={form.sleepHours} onChange={e => up("sleepHours", e.target.value)} step="0.5" />
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", justifyContent: "space-between", fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}><span>Stress</span><span style={{ color: form.stress <= 3 ? COLORS.accent : form.stress <= 6 ? COLORS.warning : COLORS.danger }}>{form.stress}/10</span></label>
          <input type="range" min="1" max="10" value={form.stress} onChange={e => up("stress", parseInt(e.target.value))} style={{ width: "100%", accentColor: COLORS.accent }} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", justifyContent: "space-between", fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}><span>Energy</span><span style={{ color: form.energy >= 7 ? COLORS.accent : form.energy >= 4 ? COLORS.warning : COLORS.danger }}>{form.energy}/10</span></label>
          <input type="range" min="1" max="10" value={form.energy} onChange={e => up("energy", parseInt(e.target.value))} style={{ width: "100%", accentColor: COLORS.accent }} />
        </div>
        <Input label="Notes (optional)" value={form.notes} onChange={e => up("notes", e.target.value)} placeholder="How did today feel?" />
        {form.sleepHours && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: `1px solid ${COLORS.border}`, marginTop: 8 }}>
            <div style={{ fontFamily: FONTS, fontSize: 10, padding: "4px 10px", borderRadius: 20, background: recovery.score >= 70 ? COLORS.accentDim : recovery.score >= 40 ? COLORS.warningDim : COLORS.dangerDim, color: recovery.score >= 70 ? COLORS.accent : recovery.score >= 40 ? COLORS.warning : COLORS.danger }}>{recovery.status}</div>
            <span style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textMuted }}>Recovery: {recovery.score}/100</span>
          </div>
        )}
      </Card>

      <Btn onClick={handleSave} style={{ width: "100%", padding: 14, fontSize: 14, marginBottom: 16 }}>{saved ? "UPDATE CHECK-IN" : "SUBMIT CHECK-IN"}</Btn>

      {!hasApiKey && saved && (
        <Card style={{ marginBottom: 16, borderColor: COLORS.warning + "44" }}>
          <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.warning, marginBottom: 4 }}>AI COACHING DISABLED</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.textDim }}>Add your Anthropic API key in Settings → API Key to enable AI coaching analysis.</div>
        </Card>
      )}

      {aiLoading && <Card style={{ marginBottom: 16 }} glow={COLORS.accent}><div style={{ fontFamily: FONTS, fontSize: 12, color: COLORS.accent, textAlign: "center", padding: 20 }}>ANALYZING...</div></Card>}

      {aiResponse && (
        <Card style={{ marginBottom: 16 }} glow={COLORS.accent}>
          <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.accent, letterSpacing: "0.08em", marginBottom: 12 }}>AI COACHING ANALYSIS</div>
          <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.text, lineHeight: 1.6, marginBottom: 14 }}>{aiResponse.summary}</div>
          {[{ icon: "🍽", label: "NUTRITION", text: aiResponse.nutritionNote, color: COLORS.blue }, { icon: "💤", label: "RECOVERY", text: aiResponse.recoveryNote, color: COLORS.purple }, { icon: "⚙", label: "ADJUSTMENT", text: aiResponse.adjustment, color: COLORS.warning }].map(item => item.text && (
            <div key={item.label} style={{ marginBottom: 10, padding: "10px 12px", background: COLORS.surfaceLight, borderRadius: 8, borderLeft: `3px solid ${item.color}` }}>
              <div style={{ fontFamily: FONTS, fontSize: 9, color: item.color, letterSpacing: "0.06em", marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.textDim, lineHeight: 1.5 }}>{item.text}</div>
            </div>
          ))}
          {aiResponse.tomorrowPriority && (
            <div style={{ marginTop: 12, padding: "12px", background: COLORS.accentDim, borderRadius: 8, border: `1px solid ${COLORS.accent}33` }}>
              <div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.accent, letterSpacing: "0.08em", marginBottom: 4 }}>TOMORROW'S PRIORITY</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.accent, fontWeight: 600 }}>{aiResponse.tomorrowPriority}</div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ==================== DASHBOARD ====================
function DashboardView({ profile, weights, workouts, targets, checkins }) {
  const sorted = useMemo(() => [...weights].sort((a, b) => new Date(a.date) - new Date(b.date)), [weights]);
  const withAvg = useMemo(() => calcRollingAvg(sorted), [sorted]);
  const weeklyLoss = useMemo(() => calcWeeklyLoss(sorted), [sorted]);
  const currentWeight = sorted.length > 0 ? sorted[sorted.length - 1].weight : profile.weightLbs;
  const totalLost = Math.round((profile.weightLbs - currentWeight) * 10) / 10;
  const remaining = Math.round((currentWeight - profile.goalWeightLbs) * 10) / 10;
  const progressPct = profile.weightLbs !== profile.goalWeightLbs ? Math.min(100, Math.max(0, Math.round((totalLost / (profile.weightLbs - profile.goalWeightLbs)) * 100))) : 0;
  const last7 = checkins.filter(c => daysBetween(c.date, today()) < 7);
  const avgAdherence = last7.length > 0 ? Math.round(last7.reduce((s, c) => s + calcAdherence(c, targets, profile).total, 0) / last7.length) : 0;
  const thisWeekWorkouts = last7.filter(c => c.workoutCompleted).length;
  const adherenceTrend = useMemo(() => [...checkins].sort((a, b) => new Date(a.date) - new Date(b.date)).slice(-14).map(c => ({ date: c.date, score: calcAdherence(c, targets, profile).total })), [checkins, targets, profile]);

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}><span style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim }}>PROGRESS</span><span style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.accent }}>{progressPct}%</span></div>
        <div style={{ background: COLORS.border, borderRadius: 6, height: 8, overflow: "hidden" }}><div style={{ background: `linear-gradient(90deg, ${COLORS.accent}, ${COLORS.blue})`, height: "100%", borderRadius: 6, width: `${progressPct}%`, transition: "width 0.5s" }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}><span style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted }}>{profile.weightLbs} lbs</span><span style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted }}>{profile.goalWeightLbs} lbs</span></div>
      </Card>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <StatBox label="Current" value={currentWeight} unit="lbs" />
        <StatBox label="Lost" value={totalLost > 0 ? `-${totalLost}` : "0"} unit="lbs" color={totalLost > 0 ? COLORS.accent : COLORS.text} />
        <StatBox label="To Go" value={remaining > 0 ? remaining : "0"} unit="lbs" />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <StatBox label="Rate" value={weeklyLoss ?? "—"} unit={weeklyLoss !== null ? "lbs/wk" : ""} sub={targets ? `Target: ${targets.weeklyLossTarget}` : ""} />
        <StatBox label="Adherence" value={avgAdherence} unit="%" color={getAdherenceColor(avgAdherence)} />
        <StatBox label="Workouts" value={`${thisWeekWorkouts}/${profile.trainingDays}`} unit="wk" />
      </div>
      {targets && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>TARGETS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
            {[{ l: "KCAL", v: targets.calories, c: COLORS.accent }, { l: "PROT", v: `${targets.protein}g`, c: COLORS.blue }, { l: "CARBS", v: `${targets.carbs}g`, c: COLORS.purple }, { l: "FAT", v: `${targets.fat}g`, c: COLORS.warning }].map(m => (
              <div key={m.l} style={{ textAlign: "center" }}><div style={{ fontFamily: FONTS, fontSize: 18, fontWeight: 700, color: m.c }}>{m.v}</div><div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.textMuted, marginTop: 2 }}>{m.l}</div></div>
            ))}
          </div>
        </Card>
      )}
      {withAvg.length > 2 && (
        <Card style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>WEIGHT TREND</div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={withAvg.slice(-30)} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <defs><linearGradient id="wgD" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.2} /><stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} /><XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textMuted, fontFamily: FONTS }} tickFormatter={formatDate} /><YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 9, fill: COLORS.textMuted, fontFamily: FONTS }} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontFamily: FONTS, fontSize: 11 }} />
              <ReferenceLine y={profile.goalWeightLbs} stroke={COLORS.accent} strokeDasharray="5 5" />
              <Area type="monotone" dataKey="avg" stroke={COLORS.accent} fill="url(#wgD)" strokeWidth={2} name="7-day Avg" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}
      {adherenceTrend.length > 3 && (
        <Card>
          <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>ADHERENCE</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={adherenceTrend} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} /><XAxis dataKey="date" tick={{ fontSize: 8, fill: COLORS.textMuted, fontFamily: FONTS }} tickFormatter={formatDate} /><YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: COLORS.textMuted, fontFamily: FONTS }} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontFamily: FONTS, fontSize: 11 }} />
              <ReferenceLine y={80} stroke={COLORS.accent} strokeDasharray="3 3" /><Bar dataKey="score" fill={COLORS.blue} radius={[3, 3, 0, 0]} name="Adherence %" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}

// ==================== WEIGHT ====================
function WeightView({ weights, onSave, profile, targets }) {
  const [nw, setNw] = useState(""); const [nd, setNd] = useState(today());
  const sorted = useMemo(() => [...weights].sort((a, b) => new Date(a.date) - new Date(b.date)), [weights]);
  const withAvg = useMemo(() => calcRollingAvg(sorted), [sorted]);
  const add = () => { const w = parseFloat(nw); if (!w||w<50||w>500) return; const ex = weights.findIndex(e => e.date === nd); onSave(ex >= 0 ? weights.map((x,i) => i===ex ? {date:nd,weight:w} : x) : [...weights, {date:nd,weight:w}]); setNw(""); };

  return (
    <div>
      <SectionHeader>Log Weight</SectionHeader>
      <Card style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}><Input label="Weight (lbs)" type="number" value={nw} onChange={e => setNw(e.target.value)} step="0.1" /></div>
          <div style={{ flex: 1 }}><Input label="Date" type="date" value={nd} onChange={e => setNd(e.target.value)} /></div>
          <Btn onClick={add} style={{ marginBottom: 14 }}>LOG</Btn>
        </div>
      </Card>
      {withAvg.length > 2 && (
        <Card style={{ marginBottom: 20 }}>
          <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>TREND</div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={withAvg.slice(-60)} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
              <defs><linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={COLORS.accent} stopOpacity={0.2} /><stop offset="95%" stopColor={COLORS.accent} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} /><XAxis dataKey="date" tick={{ fontSize: 9, fill: COLORS.textMuted, fontFamily: FONTS }} tickFormatter={formatDate} /><YAxis domain={["dataMin - 2", "dataMax + 2"]} tick={{ fontSize: 9, fill: COLORS.textMuted, fontFamily: FONTS }} />
              <Tooltip contentStyle={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 8, fontFamily: FONTS, fontSize: 11 }} />
              <ReferenceLine y={profile.goalWeightLbs} stroke={COLORS.accent} strokeDasharray="5 5" label={{ value: "Goal", fill: COLORS.accent, fontSize: 10 }} />
              <Area type="monotone" dataKey="avg" stroke={COLORS.accent} fill="url(#wg2)" strokeWidth={2} name="7-day Avg" /><Line type="monotone" dataKey="weight" stroke={COLORS.textMuted} strokeWidth={1} dot={{ r: 2 }} name="Daily" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>
      )}
      <SectionHeader>Entries</SectionHeader>
      <Card>{sorted.length === 0 ? <div style={{ fontFamily: FONTS, fontSize: 12, color: COLORS.textMuted, textAlign: "center", padding: 20 }}>No entries</div> : sorted.slice(-14).reverse().map(w => (
        <div key={w.date} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COLORS.border}` }}>
          <span style={{ fontFamily: FONTS, fontSize: 12, color: COLORS.textDim }}>{formatDate(w.date)}</span>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}><span style={{ fontFamily: FONTS, fontSize: 13, fontWeight: 600 }}>{w.weight} lbs</span><button onClick={() => onSave(weights.filter(x => x.date !== w.date))} style={{ background: "none", border: "none", color: COLORS.textMuted, cursor: "pointer", fontSize: 14 }}>×</button></div>
        </div>
      ))}</Card>
    </div>
  );
}

// ==================== TRAINING ====================
function TrainingView({ program, workouts, onSaveWorkouts, onSaveProgram }) {
  const [sel, setSel] = useState(0); const [logging, setLogging] = useState(false); const [logData, setLogData] = useState([]);
  const startLog = (i) => { setLogData(program.sessions[i].exercises.map(e => ({ name: e.name, sets: Array.from({length: e.sets}, () => ({weight: e.weight||"", reps: ""})), targetReps: `${e.repsMin}-${e.repsMax}` }))); setSel(i); setLogging(true); };
  const updateSet = (ei, si, f, v) => setLogData(d => { const c = d.map(e => ({...e, sets: e.sets.map(s => ({...s}))})); c[ei].sets[si][f] = v; return c; });
  const saveWo = () => {
    const entry = { date: today(), sessionName: program.sessions[sel].name, sessionIdx: sel, exercises: logData.map(e => ({ name: e.name, sets: e.sets.map(s => ({ weight: parseFloat(s.weight)||0, reps: parseInt(s.reps)||0 })) })) };
    onSaveWorkouts([...workouts, entry]);
    onSaveProgram({ ...program, sessions: program.sessions.map((s,i) => { if (i!==sel) return s; return {...s, exercises: s.exercises.map((ex,j) => { const l=logData[j]; if(!l) return ex; const mw=Math.max(...l.sets.map(s=>parseFloat(s.weight)||0)); return mw>0?{...ex,weight:mw}:ex; })}; }) });
    setLogging(false);
  };
  const getHist = (name) => workouts.filter(w => w.exercises.some(e => e.name===name)).map(w => { const e=w.exercises.find(e=>e.name===name); const ts=e.sets.reduce((b,s)=>s.weight*s.reps>b.weight*b.reps?s:b,{weight:0,reps:0}); return {date:w.date,topWeight:ts.weight,topReps:ts.reps,volume:e.sets.reduce((s,x)=>s+x.weight*x.reps,0)}; }).sort((a,b)=>new Date(a.date)-new Date(b.date));

  if (logging) return (
    <div>
      <SectionHeader right={<Btn variant="ghost" onClick={() => setLogging(false)}>CANCEL</Btn>}>{program.sessions[sel].name}</SectionHeader>
      {logData.map((ex, ei) => (
        <Card key={ei} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><div style={{ fontFamily: FONTS, fontSize: 13, fontWeight: 600 }}>{ex.name}</div><div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted }}>Target: {ex.targetReps}</div></div>
          {ex.sets.map((set, si) => (
            <div key={si} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textMuted, width: 30 }}>S{si+1}</span>
              <input type="number" placeholder="kg" value={set.weight} onChange={e => updateSet(ei, si, "weight", e.target.value)} style={{ flex: 1, background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "8px 10px", color: COLORS.text, fontFamily: FONTS, fontSize: 13 }} />
              <span style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textMuted }}>×</span>
              <input type="number" placeholder="reps" value={set.reps} onChange={e => updateSet(ei, si, "reps", e.target.value)} style={{ flex: 1, background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "8px 10px", color: COLORS.text, fontFamily: FONTS, fontSize: 13 }} />
            </div>
          ))}
        </Card>
      ))}
      <Btn onClick={saveWo} style={{ width: "100%", padding: 14, fontSize: 14 }}>SAVE WORKOUT</Btn>
    </div>
  );

  return (
    <div>
      <SectionHeader>Program: {program?.type}</SectionHeader>
      {program?.sessions.map((session, si) => { const recent=[...workouts].reverse().find(w=>w.sessionIdx===si); return (
        <Card key={si} style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <div><div style={{ fontFamily: FONTS, fontSize: 14, fontWeight: 600 }}>{session.name}</div><div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted, marginTop: 3 }}>{recent?`Last: ${formatDate(recent.date)}`:"Not logged"}</div></div>
            <Btn onClick={() => startLog(si)} style={{ fontSize: 11, padding: "8px 14px" }}>LOG</Btn>
          </div>
          {session.exercises.map((ex,ei) => { const h=getHist(ex.name); const last=h.length>0?h[h.length-1]:null; return (
            <div key={ei} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: ei>0?`1px solid ${COLORS.border}`:"none" }}>
              <div><span style={{ fontSize: 13 }}>{ex.name}</span><span style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted, marginLeft: 8 }}>{ex.sets}×{ex.repsMin}-{ex.repsMax}</span></div>
              <span style={{ fontFamily: FONTS, fontSize: 11, color: last?COLORS.accent:COLORS.textMuted }}>{last?`${last.topWeight}kg × ${last.topReps}`:"—"}</span>
            </div>
          ); })}
        </Card>
      ); })}
    </div>
  );
}

// ==================== WEEKLY REVIEW ====================
function WeeklyReviewView({ checkins, weights, workouts, targets, profile, program, onSaveTargets }) {
  const [review, setReview] = useState(null); const [loading, setLoading] = useState(false); const [applied, setApplied] = useState(false);
  const last7 = useMemo(() => [...checkins].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 7), [checkins]);
  const hasData = last7.length >= 5;
  const avgCals = last7.length>0 ? Math.round(last7.reduce((s,c) => s+(c.calories||0), 0)/last7.length) : 0;
  const avgProtein = last7.length>0 ? Math.round(last7.reduce((s,c) => s+(c.protein||0), 0)/last7.length) : 0;
  const woDays = last7.filter(c => c.workoutCompleted).length;
  const avgAdh = last7.length>0 ? Math.round(last7.reduce((s,c) => s+calcAdherence(c,targets,profile).total, 0)/last7.length) : 0;
  const wl = calcWeeklyLoss([...weights].sort((a,b) => new Date(a.date)-new Date(b.date)));
  const hasKey = !!getApiKey();

  const run = async () => { setLoading(true); const r = await getWeeklyReview(checkins, weights, workouts, targets, profile, program); setReview(r); setLoading(false); };
  const applyAdj = () => {
    if (!review?.calorieAdjustment?.amount || review.calorieAdjustment.action === "maintain") return;
    const delta = review.calorieAdjustment.action === "decrease" ? -Math.abs(review.calorieAdjustment.amount) : Math.abs(review.calorieAdjustment.amount);
    const nc = Math.max(1200, targets.calories + delta);
    const fg = Math.round((nc * 0.25) / 9); const cg = Math.round((nc - (targets.protein * 4) - (fg * 9)) / 4);
    onSaveTargets({ ...targets, calories: nc, fat: fg, carbs: cg }); setApplied(true);
  };

  return (
    <div>
      <SectionHeader>Weekly Review</SectionHeader>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 12 }}>THIS WEEK</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[{ l:"Avg Cal", v:avgCals, t:targets?.calories, u:"kcal" }, { l:"Avg Protein", v:avgProtein, t:targets?.protein, u:"g" }, { l:"Workouts", v:`${woDays}/${profile.trainingDays}` }, { l:"Adherence", v:`${avgAdh}%`, c:getAdherenceColor(avgAdh) }, { l:"Weekly Loss", v:wl!==null?`${wl} lbs`:"—" }, { l:"Check-ins", v:`${last7.length}/7` }].map(i => (
            <div key={i.l} style={{ background: COLORS.surfaceLight, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.textMuted }}>{i.l}</div>
              <div style={{ fontFamily: FONTS, fontSize: 16, fontWeight: 700, color: i.c||COLORS.text, marginTop: 2 }}>{i.v} <span style={{ fontSize: 10, color: COLORS.textMuted }}>{i.t?`/ ${i.t}${i.u||""}`:(i.u||"")}</span></div>
            </div>
          ))}
        </div>
      </Card>

      {!hasKey && <Card style={{ marginBottom: 16, borderColor: COLORS.warning+"44" }}><div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.warning, marginBottom: 4 }}>API KEY REQUIRED</div><div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.textDim }}>Add your Anthropic API key in Settings to run AI weekly reviews.</div></Card>}

      {hasKey && (!hasData ? (
        <Card><div style={{ fontFamily: FONTS, fontSize: 12, color: COLORS.textMuted, textAlign: "center", padding: 20 }}>Need 5+ check-ins this week ({last7.length}/5)</div></Card>
      ) : (
        <>
          <Btn onClick={run} disabled={loading} style={{ width: "100%", padding: 14, fontSize: 14, marginBottom: 16, opacity: loading?0.6:1 }}>{loading ? "ANALYZING..." : "RUN AI REVIEW"}</Btn>
          {review && (
            <Card glow={COLORS.blue} style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.blue, letterSpacing: "0.08em", marginBottom: 14 }}>AI WEEKLY REVIEW</div>
              <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.text, lineHeight: 1.6, marginBottom: 16 }}>{review.weekSummary}</div>
              <div style={{ display: "inline-block", fontFamily: FONTS, fontSize: 10, padding: "4px 10px", borderRadius: 20, marginBottom: 14, background: review.complianceRating==="EXCELLENT"?COLORS.accentDim:review.complianceRating==="GOOD"?COLORS.blueDim:COLORS.warningDim, color: review.complianceRating==="EXCELLENT"?COLORS.accent:review.complianceRating==="GOOD"?COLORS.blue:COLORS.warning }}>{review.complianceRating}</div>
              {[{ l:"WEIGHT", t:review.weightAnalysis, c:COLORS.accent }, { l:"TRAINING", t:review.trainingNote, c:COLORS.purple }].map(i => i.t && (
                <div key={i.l} style={{ marginBottom: 10, padding: "10px 12px", background: COLORS.surfaceLight, borderRadius: 8, borderLeft: `3px solid ${i.c}` }}>
                  <div style={{ fontFamily: FONTS, fontSize: 9, color: i.c, letterSpacing: "0.06em", marginBottom: 4 }}>{i.l}</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.textDim, lineHeight: 1.5 }}>{i.t}</div>
                </div>
              ))}
              {review.calorieAdjustment && review.calorieAdjustment.action !== "maintain" && (
                <div style={{ marginTop: 12, padding: "14px", background: COLORS.warningDim, borderRadius: 8, border: `1px solid ${COLORS.warning}33` }}>
                  <div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.warning, letterSpacing: "0.08em", marginBottom: 6 }}>CALORIE ADJUSTMENT</div>
                  <div style={{ fontFamily: FONTS, fontSize: 16, color: COLORS.warning, fontWeight: 700, marginBottom: 4 }}>{review.calorieAdjustment.action==="decrease"?"↓":"↑"} {review.calorieAdjustment.amount} kcal</div>
                  <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.textDim, marginBottom: 10 }}>{review.calorieAdjustment.reason}</div>
                  {!applied ? <Btn variant="warning" onClick={applyAdj}>APPLY</Btn> : <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.accent }}>APPLIED</div>}
                </div>
              )}
              {review.plateauAction && <div style={{ marginTop: 10, padding: "12px", background: COLORS.dangerDim, borderRadius: 8 }}><div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.danger, marginBottom: 4 }}>PLATEAU</div><div style={{ fontFamily: FONT_BODY, fontSize: 13, color: COLORS.danger }}>{review.plateauAction}</div></div>}
              <div style={{ marginTop: 14, padding: "12px", background: COLORS.accentDim, borderRadius: 8, border: `1px solid ${COLORS.accent}33` }}>
                <div style={{ fontFamily: FONTS, fontSize: 9, color: COLORS.accent, letterSpacing: "0.08em", marginBottom: 4 }}>NEXT WEEK</div>
                <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: COLORS.accent, fontWeight: 600 }}>{review.nextWeekFocus}</div>
              </div>
            </Card>
          )}
        </>
      ))}
    </div>
  );
}

// ==================== SETTINGS ====================
function SettingsView({ profile, targets, program, save, weights, workouts, checkins }) {
  const [editTargets, setEditTargets] = useState(false);
  const [tmp, setTmp] = useState(targets || {});
  const [showReset, setShowReset] = useState(false);
  const [apiKey, setApiKey] = useState(getApiKey());
  const [keyVisible, setKeyVisible] = useState(false);

  const sorted = useMemo(() => [...weights].sort((a, b) => new Date(a.date) - new Date(b.date)), [weights]);
  const recalc = useMemo(() => {
    if (sorted.length<14||!targets) return null;
    const l14=sorted.slice(-14); const a1=l14.slice(0,7).reduce((s,w)=>s+w.weight,0)/l14.slice(0,7).length; const a2=l14.slice(-7).reduce((s,w)=>s+w.weight,0)/l14.slice(-7).length;
    return { tdee: Math.round(targets.calories+(a1-a2)*3500/7), loss: Math.round((a1-a2)*10)/10 };
  }, [sorted, targets]);

  return (
    <div>
      {/* API Key Section */}
      <SectionHeader>AI Coaching</SectionHeader>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ fontFamily: FONTS, fontSize: 11, color: COLORS.textDim, letterSpacing: "0.08em", marginBottom: 8 }}>ANTHROPIC API KEY</div>
        <div style={{ fontFamily: FONT_BODY, fontSize: 12, color: COLORS.textMuted, marginBottom: 12 }}>Required for AI coaching analysis. Get one at console.anthropic.com. Stored locally on your device only.</div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <input type={keyVisible ? "text" : "password"} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-ant-..." style={{ width: "100%", background: COLORS.surfaceLight, border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: "10px 12px", color: COLORS.text, fontFamily: FONTS, fontSize: 12, outline: "none", boxSizing: "border-box" }} />
          </div>
          <Btn variant="ghost" onClick={() => setKeyVisible(!keyVisible)} style={{ fontSize: 10 }}>{keyVisible ? "HIDE" : "SHOW"}</Btn>
          <Btn onClick={() => { localStorage.setItem(STORAGE_KEYS.apiKey, JSON.stringify(apiKey)); }} style={{ fontSize: 11 }}>SAVE</Btn>
        </div>
        {apiKey && <div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.accent, marginTop: 8 }}>KEY SET — AI coaching enabled</div>}
      </Card>

      <SectionHeader>Profile</SectionHeader>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[{ l:"Name", v:profile.name }, { l:"Age", v:profile.age }, { l:"Height", v:`${profile.heightCm}cm (${cmToFeetInches(profile.heightCm)})` }, { l:"Start", v:`${profile.weightLbs} lbs` }, { l:"Goal", v:`${profile.goalWeightLbs} lbs` }, { l:"Training", v:`${profile.trainingDays}×/wk` }, { l:"Steps", v:profile.stepTarget }, { l:"Started", v:formatDate(profile.createdAt) }].map(i => (
            <div key={i.l} style={{ padding: "6px 0" }}><div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted }}>{i.l}</div><div style={{ fontFamily: FONTS, fontSize: 12, marginTop: 2 }}>{i.v}</div></div>
          ))}
        </div>
      </Card>

      <SectionHeader>Metabolic</SectionHeader>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div><div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted }}>BMR</div><div style={{ fontFamily: FONTS, fontSize: 14 }}>{profile.bmr} kcal</div></div>
          <div><div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted }}>TDEE</div><div style={{ fontFamily: FONTS, fontSize: 14 }}>{targets?.tdee||profile.tdee} kcal</div></div>
        </div>
        {recalc && (
          <div style={{ background: COLORS.bg, borderRadius: 8, padding: 12 }}>
            <div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.warning, marginBottom: 6 }}>DATA-DRIVEN TDEE</div>
            <div style={{ fontFamily: FONTS, fontSize: 16, fontWeight: 700 }}>{recalc.tdee} kcal</div>
            <div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted, marginTop: 4 }}>14-day: {recalc.loss} lbs/wk</div>
            <Btn variant="secondary" style={{ marginTop: 8, fontSize: 10 }} onClick={() => {
              const dd=Math.round((targets.weeklyLossTarget*3500)/7); const cal=Math.max(1200,recalc.tdee-dd);
              const fg=Math.round((cal*0.25)/9); const cg=Math.round((cal-(targets.protein*4)-(fg*9))/4);
              save.targets({...targets, calories:cal, fat:fg, carbs:cg, tdee:recalc.tdee});
            }}>APPLY</Btn>
          </div>
        )}
      </Card>

      <SectionHeader>Targets</SectionHeader>
      <Card style={{ marginBottom: 16 }}>
        {!editTargets ? (<>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            {targets && [{ l:"Calories", v:`${targets.calories} kcal` }, { l:"Protein", v:`${targets.protein}g` }, { l:"Carbs", v:`${targets.carbs}g` }, { l:"Fat", v:`${targets.fat}g` }].map(i => (
              <div key={i.l}><div style={{ fontFamily: FONTS, fontSize: 10, color: COLORS.textMuted }}>{i.l}</div><div style={{ fontFamily: FONTS, fontSize: 13, marginTop: 2 }}>{i.v}</div></div>
            ))}
          </div>
          <Btn variant="secondary" onClick={() => { setTmp({...targets}); setEditTargets(true); }}>EDIT</Btn>
        </>) : (<>
          <Input label="Calories" type="number" value={tmp.calories} onChange={e => setTmp(t => ({...t, calories:parseInt(e.target.value)}))} />
          <Input label="Protein (g)" type="number" value={tmp.protein} onChange={e => setTmp(t => ({...t, protein:parseInt(e.target.value)}))} />
          <Input label="Carbs (g)" type="number" value={tmp.carbs} onChange={e => setTmp(t => ({...t, carbs:parseInt(e.target.value)}))} />
          <Input label="Fat (g)" type="number" value={tmp.fat} onChange={e => setTmp(t => ({...t, fat:parseInt(e.target.value)}))} />
          <div style={{ display: "flex", gap: 8 }}><Btn onClick={() => { save.targets(tmp); setEditTargets(false); }}>SAVE</Btn><Btn variant="secondary" onClick={() => setEditTargets(false)}>CANCEL</Btn></div>
        </>)}
      </Card>

      <SectionHeader>Data</SectionHeader>
      <Card>
        <div style={{ fontFamily: FONTS, fontSize: 12, color: COLORS.textDim, marginBottom: 8 }}>{weights.length} weigh-ins · {workouts.length} workouts · {checkins.length} check-ins</div>
        {!showReset ? <Btn variant="danger" onClick={() => setShowReset(true)}>RESET ALL</Btn> : (
          <div><div style={{ fontFamily: FONTS, fontSize: 12, color: COLORS.danger, marginBottom: 8 }}>Delete everything?</div>
          <div style={{ display: "flex", gap: 8 }}><Btn variant="danger" onClick={() => { Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k)); window.location.reload(); }}>CONFIRM</Btn><Btn variant="secondary" onClick={() => setShowReset(false)}>CANCEL</Btn></div></div>
        )}
      </Card>
    </div>
  );
}

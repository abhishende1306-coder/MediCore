const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the static frontend from the same server to avoid file:// + CORS quirks.
app.use("/assets", express.static(path.join(__dirname, "assets")));

const FRONTEND_PAGES = new Set([
  "doctors.html",
  "register.html",
  "login.html",
  "token.html",
  "queue.html",
  "admin-dashboard.html",
  "feedback.html",
  "doctor-login.html",
  "doctor-dashboard.html"
]);
function serveFrontendPage(page) {
  return (req, res) => res.sendFile(path.join(__dirname, page));
}

app.get("/", (req, res) => res.redirect("/doctors.html"));
for (const page of FRONTEND_PAGES) {
  app.get(`/${page}`, serveFrontendPage(page));
}

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
const TOKENS_FILE = path.join(DATA_DIR, "tokens.json");
const QUEUE_FILE = path.join(DATA_DIR, "queue.json");
const OTPS_FILE = path.join(DATA_DIR, "otps.json");
const LOGIN_SESSIONS_FILE = path.join(DATA_DIR, "login_sessions.json");
const DOCTOR_SESSIONS_FILE = path.join(DATA_DIR, "doctor_sessions.json");
const DOCTORS_FILE = path.join(DATA_DIR, "doctors.json");
const FEEDBACK_FILE = path.join(DATA_DIR, "feedback.json");

const PORT = process.env.PORT || 3000;

const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 5);
const OTP_RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 30);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const SESSION_TOKEN_TTL_MINUTES = Number(process.env.SESSION_TOKEN_TTL_MINUTES || 120);
const LOGIN_SESSION_TTL_MINUTES = Number(process.env.LOGIN_SESSION_TTL_MINUTES || 30);
const DOCTOR_SESSION_TTL_MINUTES = Number(process.env.DOCTOR_SESSION_TTL_MINUTES || 480);
const DOCTOR_ADMIN_KEY = String(process.env.DOCTOR_ADMIN_KEY || "admin123");

const MEDICORE_DOCTORS = [
  { id: "dr-rajesh-sharma", name: "Dr. Rajesh Sharma", specialization: "Cardiologist", experienceYears: 15, timing: "10:00 AM - 1:00 PM", availability: "Available" },
  { id: "dr-anjali-mehta", name: "Dr. Anjali Mehta", specialization: "Dermatologist", experienceYears: 10, timing: "12:00 PM - 3:00 PM", availability: "Available" },
  { id: "dr-amit-kulkarni", name: "Dr. Amit Kulkarni", specialization: "Orthopedic", experienceYears: 12, timing: "4:00 PM - 7:00 PM", availability: "Limited" },
  { id: "dr-priya-nair", name: "Dr. Priya Nair", specialization: "Gynecologist", experienceYears: 9, timing: "9:00 AM - 12:00 PM", availability: "Available" },
  { id: "dr-vikram-singh", name: "Dr. Vikram Singh", specialization: "Neurologist", experienceYears: 14, timing: "2:00 PM - 5:00 PM", availability: "Available" },
  { id: "dr-sneha-deshpande", name: "Dr. Sneha Deshpande", specialization: "Pediatrician", experienceYears: 8, timing: "11:00 AM - 2:00 PM", availability: "Available" }
];

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(TOKENS_FILE)) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(QUEUE_FILE)) {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(OTPS_FILE)) {
    fs.writeFileSync(OTPS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(LOGIN_SESSIONS_FILE)) {
    fs.writeFileSync(LOGIN_SESSIONS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(DOCTOR_SESSIONS_FILE)) {
    fs.writeFileSync(DOCTOR_SESSIONS_FILE, JSON.stringify([], null, 2));
  }
  if (!fs.existsSync(DOCTORS_FILE)) {
    fs.writeFileSync(DOCTORS_FILE, JSON.stringify(MEDICORE_DOCTORS, null, 2));
  }
  if (!fs.existsSync(FEEDBACK_FILE)) {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify([], null, 2));
  }
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw || JSON.stringify(fallback));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizePhone(phone) {
  return String(phone || "").trim();
}

function isValidPhone(phone) {
  return /^[0-9]{10}$/.test(String(phone || "").trim());
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isValidOtp(otp) {
  return /^[0-9]{6}$/.test(String(otp || "").trim());
}

function isValidRating(value) {
  return /^[1-5]$/.test(String(value || "").trim());
}

function maskEmail(email) {
  const value = String(email || "").trim();
  const at = value.indexOf("@");
  if (at <= 1) return "***";
  const name = value.slice(0, at);
  const domain = value.slice(at);
  const visible = name.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(1, name.length - 2))}${domain}`;
}

function readDoctors() {
  const doctors = readJson(DOCTORS_FILE, MEDICORE_DOCTORS);
  if (!Array.isArray(doctors) || doctors.length === 0) return MEDICORE_DOCTORS;
  return doctors;
}

function isAdminRequest(req) {
  const key = String(req.headers["x-admin-key"] || req.query.key || "").trim();
  return Boolean(key && key === DOCTOR_ADMIN_KEY);
}

function requireAdmin(req, res) {
  if (!isAdminRequest(req)) {
    res.status(401).json({ success: false, message: "Unauthorized. Provide doctor admin key." });
    return false;
  }
  return true;
}

function getOtpSecret() {
  return String(process.env.OTP_SECRET || "dev-otp-secret");
}

function hashOtp(otp, salt) {
  return crypto
    .createHmac("sha256", getOtpSecret())
    .update(`${String(otp)}:${String(salt)}`)
    .digest("hex");
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function nowIso() {
  return new Date().toISOString();
}

function addMinutesToNow(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function buildMailTransport() {
  const smtpUrl = process.env.SMTP_URL;
  if (smtpUrl) {
    return nodemailer.createTransport(smtpUrl);
  }

  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function sendOtpEmail(email, otp) {
  const transport = buildMailTransport();
  if (!transport) {
    console.log(`[DEV OTP] OTP for ${email}: ${otp}`);
    return { sent: false, via: "console", otp: String(otp) };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  const appName = process.env.APP_NAME || "MediCore";

  await transport.sendMail({
    from,
    to: email,
    subject: `${appName} verification code`,
    text: `Your ${appName} verification code is ${otp}. It expires in ${OTP_TTL_MINUTES} minutes.`
  });

  return { sent: true, via: "smtp" };
}

function shouldExposeDevOtp(status) {
  if (!status || status.sent) return false;
  if (String(status.via) !== "console") return false;
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") return false;

  // Default to true in local/dev so the demo works without reading server logs.
  const configured = process.env.EXPOSE_DEV_OTP;
  if (configured == null || configured === "") return true;
  return String(configured).toLowerCase() === "true";
}

function findUserByPhone(users, phone) {
  const normalized = normalizePhone(phone);
  return users.find((user) => user.phone === normalized);
}

function cleanupExpiredOtps(otps) {
  const now = Date.now();
  return otps.filter((otp) => Date.parse(otp.expiresAt) > now);
}

function cleanupExpiredTokens(tokens) {
  const now = Date.now();
  return tokens.filter((token) => !token.expiresAt || Date.parse(token.expiresAt) > now);
}

function cleanupExpiredLoginSessions(sessions) {
  const now = Date.now();
  return sessions.filter((session) => session && Date.parse(session.expiresAt) > now);
}

function cleanupExpiredDoctorSessions(sessions) {
  const now = Date.now();
  return sessions.filter((session) => session && Date.parse(session.expiresAt) > now);
}

function getDoctorSessionFromRequest(req) {
  const header = req.get("X-Doctor-Session");
  if (header) return String(header).trim();
  const fromQuery = req.query?.session;
  if (fromQuery) return String(fromQuery).trim();
  const fromBody = req.body?.doctorSession;
  if (fromBody) return String(fromBody).trim();
  return "";
}

function normalizeDoctorUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function findDoctorForLogin(doctors, username) {
  const normalized = normalizeDoctorUsername(username);
  if (!normalized) return null;

  return (
    doctors.find((d) => normalizeDoctorUsername(d.username) === normalized) ||
    doctors.find((d) => normalizeDoctorUsername(d.id) === normalized) ||
    doctors.find((d) => normalizeDoctorUsername(d.name) === normalized)
  );
}

function getDoctorPassword(doctor) {
  if (doctor && doctor.password != null && String(doctor.password) !== "") {
    return String(doctor.password);
  }
  return String(process.env.DOCTOR_DEFAULT_PASSWORD || "doctor123");
}

function requireDoctorSession(req, res) {
  const session = getDoctorSessionFromRequest(req);
  if (!session) {
    res.status(401).json({ success: false, message: "Doctor login required." });
    return null;
  }

  const sessions = cleanupExpiredDoctorSessions(readJson(DOCTOR_SESSIONS_FILE, []));
  const match = sessions.find((s) => s.session === session);
  if (!match) {
    writeJson(DOCTOR_SESSIONS_FILE, sessions.slice(0, 500));
    res.status(401).json({ success: false, message: "Doctor session expired. Please login again." });
    return null;
  }

  writeJson(DOCTOR_SESSIONS_FILE, sessions.slice(0, 500));
  return match;
}

function getLoginSessionFromRequest(req) {
  const header = req.get("X-Login-Session");
  if (header) return String(header).trim();
  const bodyValue = req.body?.loginSession;
  if (bodyValue) return String(bodyValue).trim();
  return "";
}

function requireLoginSession(req, res) {
  const loginSession = getLoginSessionFromRequest(req);
  if (!loginSession) {
    res.status(401).json({ success: false, message: "Login required before generating a token." });
    return null;
  }

  const sessions = cleanupExpiredLoginSessions(readJson(LOGIN_SESSIONS_FILE, []));
  const match = sessions.find((s) => s.session === loginSession);
  if (!match) {
    writeJson(LOGIN_SESSIONS_FILE, sessions.slice(0, 500));
    res.status(401).json({ success: false, message: "Login session expired. Please login again." });
    return null;
  }

  writeJson(LOGIN_SESSIONS_FILE, sessions.slice(0, 500));
  return match;
}

function requireLoginSessionForPhone(req, res, phone) {
  if (!isValidPhone(phone)) {
    res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number." });
    return null;
  }

  const normalized = normalizePhone(phone);
  const match = requireLoginSession(req, res);
  if (!match) {
    return null;
  }

  if (match.phone !== normalized) {
    res.status(403).json({ success: false, message: "Login session does not match this phone number." });
    return null;
  }

  return match;
}

function isValidSessionToken(phone, token) {
  if (!isValidPhone(phone) || !token) return false;
  const tokens = cleanupExpiredTokens(readJson(TOKENS_FILE, []));
  const normalized = normalizePhone(phone);
  const match = tokens.find((t) => t.phone === normalized && t.token === token);
  if (!match) return false;
  // Persist cleanup
  writeJson(TOKENS_FILE, tokens.slice(0, 200));
  return true;
}

app.use((req, res, next) => {
  ensureDataFiles();
  next();
});

app.get("/api/health", (req, res) => {
  res.json({ success: true, status: "ok", time: nowIso() });
});

app.get("/api/doctors", (req, res) => {
  res.json({ success: true, data: readDoctors() });
});

app.post("/api/doctor/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required." });
  }

  const doctors = readDoctors();
  const doctor = findDoctorForLogin(doctors, username);
  if (!doctor) {
    return res.status(401).json({ success: false, message: "Invalid doctor username or password." });
  }

  if (password !== getDoctorPassword(doctor)) {
    return res.status(401).json({ success: false, message: "Invalid doctor username or password." });
  }

  const sessions = cleanupExpiredDoctorSessions(readJson(DOCTOR_SESSIONS_FILE, []));
  const session = crypto.randomBytes(16).toString("hex");
  sessions.unshift({
    session,
    doctorId: String(doctor.id),
    doctorName: String(doctor.name),
    createdAt: nowIso(),
    expiresAt: addMinutesToNow(DOCTOR_SESSION_TTL_MINUTES)
  });
  writeJson(DOCTOR_SESSIONS_FILE, sessions.slice(0, 500));

  return res.json({
    success: true,
    message: "Doctor login successful.",
    data: { doctorId: doctor.id, doctorName: doctor.name, doctorSession: session }
  });
});

app.get("/api/doctor/appointments/today", (req, res) => {
  const auth = requireDoctorSession(req, res);
  if (!auth) return;

  const doctorId = String(auth.doctorId || "").trim();
  const todayUtc = new Date().toISOString().slice(0, 10);

  const queue = readJson(QUEUE_FILE, []);
  const users = readJson(USERS_FILE, []);

  const todays = queue.filter((item) => item && item.doctorId === doctorId && String(item.joinedAt || "").slice(0, 10) === todayUtc);
  const appointments = todays.map((item, index) => {
    const user = users.find((u) => u.phone === item.phone);
    return {
      position: index + 1,
      phone: item.phone,
      patientName: user ? user.name : "Unknown",
      joinedAt: item.joinedAt,
      status: item.status || "waiting"
    };
  });

  const stats = {
    date: todayUtc,
    total: appointments.length,
    waiting: appointments.filter((a) => a.status === "waiting").length,
    served: appointments.filter((a) => a.status === "served").length,
    cancelled: appointments.filter((a) => a.status === "cancelled").length
  };

  return res.json({ success: true, doctor: { id: doctorId, name: auth.doctorName }, appointments, stats });
});

app.get("/api/admin/doctors", (req, res) => {
  if (!requireAdmin(req, res)) return;
  return res.json({ success: true, data: readDoctors() });
});

app.put("/api/admin/doctors/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = String(req.params.id || "").trim();
  if (!id) {
    return res.status(400).json({ success: false, message: "Doctor id is required." });
  }

  const allowedAvailability = new Set(["Available", "Limited", "Unavailable"]);
  const availability = req.body?.availability != null ? String(req.body.availability).trim() : null;
  const timing = req.body?.timing != null ? String(req.body.timing).trim() : null;

  if (availability != null && !allowedAvailability.has(availability)) {
    return res.status(400).json({ success: false, message: "Invalid availability value." });
  }

  if (timing != null && timing.length > 80) {
    return res.status(400).json({ success: false, message: "Timing is too long." });
  }

  const doctors = readDoctors();
  const index = doctors.findIndex((d) => d.id === id);
  if (index < 0) {
    return res.status(404).json({ success: false, message: "Doctor not found." });
  }

  const updated = { ...doctors[index] };
  if (availability != null) updated.availability = availability;
  if (timing != null) updated.timing = timing;

  const next = doctors.slice();
  next[index] = updated;
  writeJson(DOCTORS_FILE, next);

  return res.json({ success: true, message: "Doctor updated.", data: updated });
});

app.get("/api/admin/queue", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const queue = readJson(QUEUE_FILE, []);
  const users = readJson(USERS_FILE, []);

  const enrichedQueue = queue.map((item, index) => {
    const user = users.find((u) => u.phone === item.phone);
    return {
      ...item,
      position: index + 1,
      patientName: user ? user.name : "Unknown",
      estimatedWaitTime: `${(index + 1) * 15} minutes`
    };
  });

  return res.json({ success: true, queue: enrichedQueue });
});

app.put("/api/admin/queue/:phone/status", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const phone = normalizePhone(req.params.phone);
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number." });
  }

  const status = String(req.body?.status || "").trim();
  const allowed = new Set(["waiting", "served", "cancelled"]);
  if (!allowed.has(status)) {
    return res.status(400).json({ success: false, message: "Invalid status." });
  }

  const queue = readJson(QUEUE_FILE, []);
  const index = queue.findIndex((q) => q.phone === phone);
  if (index < 0) {
    return res.status(404).json({ success: false, message: "Patient not found in queue." });
  }

  const updated = { ...queue[index], status };
  const next = queue.slice();
  next[index] = updated;
  writeJson(QUEUE_FILE, next);

  return res.json({ success: true, message: "Queue status updated.", data: updated });
});

app.delete("/api/admin/queue/:phone", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const phone = normalizePhone(req.params.phone);
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number." });
  }

  const queue = readJson(QUEUE_FILE, []);
  const next = queue.filter((q) => q.phone !== phone);
  if (next.length === queue.length) {
    return res.status(404).json({ success: false, message: "Patient not found in queue." });
  }

  writeJson(QUEUE_FILE, next);
  return res.json({ success: true, message: "Removed patient from queue." });
});

app.post("/api/admin/queue/clear", (req, res) => {
  if (!requireAdmin(req, res)) return;
  writeJson(QUEUE_FILE, []);
  return res.json({ success: true, message: "Queue cleared." });
});

app.post("/api/feedback", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const phone = normalizePhone(req.body?.phone);
  const rating = String(req.body?.rating || "").trim();
  const message = String(req.body?.message || "").trim();

  if (!isValidRating(rating)) {
    return res.status(400).json({ success: false, message: "Please provide a rating from 1 to 5." });
  }

  if (!message || message.length < 5 || message.length > 800) {
    return res.status(400).json({ success: false, message: "Please enter feedback (5 to 800 characters)." });
  }

  if (phone && !isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: "Phone must be a valid 10-digit number (or leave blank)." });
  }

  const feedback = readJson(FEEDBACK_FILE, []);
  feedback.unshift({
    id: crypto.randomBytes(8).toString("hex"),
    name: name ? name.slice(0, 60) : "",
    phone: phone || "",
    rating: Number(rating),
    message,
    createdAt: nowIso()
  });

  writeJson(FEEDBACK_FILE, feedback.slice(0, 500));
  return res.json({ success: true, message: "Thanks! Your feedback has been submitted." });
});

app.get("/api/admin/feedback", (req, res) => {
  if (!requireAdmin(req, res)) return;
  const feedback = readJson(FEEDBACK_FILE, []);
  return res.json({ success: true, data: feedback });
});

app.post("/api/register", (req, res) => {
  const { name, username, password, age, gender, phone, email, address } = req.body;

  if (
    !name ||
    !username ||
    !password ||
    String(password).length < 6 ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 120 ||
    !gender ||
    !isValidPhone(phone) ||
    !email ||
    !isValidEmail(email) ||
    !address
  ) {
    return res.status(400).json({ success: false, message: "Please provide valid registration details." });
  }

  const users = readJson(USERS_FILE, []);

  const duplicateUsername = users.some((user) => user.username.toLowerCase() === String(username).toLowerCase() && user.phone !== phone);
  if (duplicateUsername) {
    return res.status(400).json({ success: false, message: "Username already taken. Use a different username." });
  }

  const duplicatePhone = users.some((user) => user.phone === normalizePhone(phone) && user.username.toLowerCase() !== String(username).toLowerCase());
  if (duplicatePhone) {
    return res.status(400).json({ success: false, message: "Phone number already registered. Please login or use a different phone." });
  }

  const patient = {
    name: String(name).trim(),
    username: String(username).trim(),
    password: String(password),
    age: Number(age),
    gender: String(gender).trim(),
    phone: normalizePhone(phone),
    email: String(email).trim(),
    address: String(address).trim(),
    updatedAt: nowIso()
  };

  const existingIndex = users.findIndex((user) => user.phone === patient.phone);
  if (existingIndex >= 0) {
    users[existingIndex] = patient;
  } else {
    users.unshift(patient);
  }

  writeJson(USERS_FILE, users);
  res.json({ success: true, message: "Registered successfully." });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Username and password are required." });
  }

  const users = readJson(USERS_FILE, []);
  const user = users.find((item) => item.username.toLowerCase() === String(username).toLowerCase() && item.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: "Invalid username or password." });
  }

  const sessions = cleanupExpiredLoginSessions(readJson(LOGIN_SESSIONS_FILE, []));
  const session = crypto.randomBytes(16).toString("hex");
  sessions.unshift({
    session,
    phone: normalizePhone(user.phone),
    username: user.username,
    createdAt: nowIso(),
    expiresAt: addMinutesToNow(LOGIN_SESSION_TTL_MINUTES)
  });
  writeJson(LOGIN_SESSIONS_FILE, sessions.slice(0, 500));

  return res.json({
    success: true,
    data: { username: user.username, name: user.name, phone: user.phone, email: user.email, loginSession: session }
  });
});

app.post("/api/token/request", async (req, res) => {
  const session = requireLoginSession(req, res);
  if (!session) return;

  const phone = String(session.phone || "").trim();
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: "Your login session is missing a valid phone number. Please login again." });
  }

  const users = readJson(USERS_FILE, []);
  const user = findUserByPhone(users, phone);
  if (!user) {
    return res.status(404).json({ success: false, message: "Phone number not registered. Please register first." });
  }

  const email = String(user.email || "").trim();
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "No valid email found for this phone. Please update your registration." });
  }

  let otps = cleanupExpiredOtps(readJson(OTPS_FILE, []));
  const normalized = normalizePhone(phone);

  const existing = otps.find((o) => o.phone === normalized);
  if (existing) {
    const secondsSince = Math.floor((Date.now() - Date.parse(existing.createdAt)) / 1000);
    if (secondsSince < OTP_RESEND_COOLDOWN_SECONDS) {
      return res.status(429).json({
        success: false,
        message: `Please wait ${OTP_RESEND_COOLDOWN_SECONDS - secondsSince}s before requesting a new OTP.`
      });
    }
    otps = otps.filter((o) => o.phone !== normalized);
  }

  const otp = generateOtp();
  const salt = crypto.randomBytes(16).toString("hex");

  otps.unshift({
    phone: normalized,
    email,
    salt,
    otpHash: hashOtp(otp, salt),
    attempts: 0,
    createdAt: nowIso(),
    expiresAt: addMinutesToNow(OTP_TTL_MINUTES)
  });

  writeJson(OTPS_FILE, otps.slice(0, 200));

  try {
    const status = await sendOtpEmail(email, otp);
    const destination = status.sent ? maskEmail(email) : "server console";
    const payload = {
      success: true,
      message: `OTP sent to ${destination}. It expires in ${OTP_TTL_MINUTES} minutes.`
    };

    if (shouldExposeDevOtp(status)) {
      payload.devOtp = String(status.otp || otp);
    }

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Failed to send OTP. Please try again later." });
  }
});

app.post("/api/token/verify", (req, res) => {
  const { otp } = req.body;
  if (!isValidOtp(otp)) {
    return res.status(400).json({ success: false, message: "Enter a valid 6-digit OTP." });
  }

  const session = requireLoginSession(req, res);
  if (!session) return;

  const phone = String(session.phone || "").trim();
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: "Your login session is missing a valid phone number. Please login again." });
  }

  const users = readJson(USERS_FILE, []);
  const user = findUserByPhone(users, phone);
  if (!user) {
    return res.status(404).json({ success: false, message: "Phone number not registered. Please register first." });
  }

  const normalized = normalizePhone(phone);
  let otps = cleanupExpiredOtps(readJson(OTPS_FILE, []));
  const record = otps.find((o) => o.phone === normalized);
  if (!record) {
    return res.status(400).json({ success: false, message: "OTP not found or expired. Please request a new OTP." });
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    otps = otps.filter((o) => o.phone !== normalized);
    writeJson(OTPS_FILE, otps.slice(0, 200));
    return res.status(429).json({ success: false, message: "Too many incorrect attempts. Please request a new OTP." });
  }

  const submittedHash = hashOtp(otp, record.salt);
  if (submittedHash !== record.otpHash) {
    otps = otps.map((o) => (o.phone === normalized ? { ...o, attempts: (o.attempts || 0) + 1 } : o));
    writeJson(OTPS_FILE, otps.slice(0, 200));
    return res.status(401).json({ success: false, message: "Invalid OTP. Please try again." });
  }

  // OTP verified -> create a short-lived session token
  otps = otps.filter((o) => o.phone !== normalized);
  writeJson(OTPS_FILE, otps.slice(0, 200));

  const token = crypto.randomBytes(5).toString("hex").toUpperCase();
  const tokens = cleanupExpiredTokens(readJson(TOKENS_FILE, []));
  tokens.unshift({
    phone: normalized,
    token,
    createdAt: nowIso(),
    expiresAt: addMinutesToNow(SESSION_TOKEN_TTL_MINUTES)
  });
  writeJson(TOKENS_FILE, tokens.slice(0, 200));

  return res.json({ success: true, token, message: "OTP verified. Session token generated." });
});

app.get("/api/queue", (req, res) => {
  const queue = readJson(QUEUE_FILE, []);
  const users = readJson(USERS_FILE, []);

  const enrichedQueue = queue.map((item, index) => {
    const user = users.find((u) => u.phone === item.phone);
    return {
      ...item,
      position: index + 1,
      patientName: user ? user.name : "Unknown",
      estimatedWaitTime: `${(index + 1) * 15} minutes`
    };
  });

  const stats = {
    totalPatients: queue.length,
    averageWaitTime: queue.length > 0 ? `${queue.length * 15} minutes` : "0 minutes",
    doctorsAvailable: readDoctors().filter((d) => d.availability === "Available").length
  };

  res.json({ success: true, queue: enrichedQueue, stats });
});

app.post("/api/queue/join", (req, res) => {
  const { phone, doctorId, token } = req.body;
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number." });
  }

  if (!token || !isValidSessionToken(phone, token)) {
    return res.status(401).json({ success: false, message: "Invalid or expired session token. Please generate a new token." });
  }

  const users = readJson(USERS_FILE, []);
  const user = findUserByPhone(users, phone);
  if (!user) {
    return res.status(404).json({ success: false, message: "Phone number not registered. Please register first." });
  }

  const queue = readJson(QUEUE_FILE, []);
  const normalized = normalizePhone(phone);
  const alreadyInQueue = queue.some((item) => item.phone === normalized);
  if (alreadyInQueue) {
    return res.status(400).json({ success: false, message: "You are already in the queue." });
  }

  const doctor = readDoctors().find((d) => d.id === doctorId);
  if (!doctor) {
    return res.status(400).json({ success: false, message: "Invalid doctor selected." });
  }

  if (String(doctor.availability) === "Unavailable") {
    return res.status(400).json({ success: false, message: "Doctor is currently unavailable. Please choose another doctor." });
  }

  const queueItem = {
    phone: normalized,
    doctorId,
    doctorName: doctor.name,
    joinedAt: nowIso(),
    status: "waiting"
  };

  queue.push(queueItem);
  writeJson(QUEUE_FILE, queue);

  return res.json({ success: true, message: `Added to queue for ${doctor.name}. Your position: ${queue.length}` });
});

app.post("/api/queue/leave", (req, res) => {
  const { phone, token } = req.body;
  if (!isValidPhone(phone)) {
    return res.status(400).json({ success: false, message: "Enter a valid 10-digit phone number." });
  }

  if (!token || !isValidSessionToken(phone, token)) {
    return res.status(401).json({ success: false, message: "Invalid or expired session token. Please generate a new token." });
  }

  const queue = readJson(QUEUE_FILE, []);
  const filteredQueue = queue.filter((item) => item.phone !== normalizePhone(phone));

  if (filteredQueue.length === queue.length) {
    return res.status(404).json({ success: false, message: "You are not in the queue." });
  }

  writeJson(QUEUE_FILE, filteredQueue);
  return res.json({ success: true, message: "Removed from queue." });
});

app.listen(PORT, () => {
  console.log(`MediCore backend running on http://localhost:${PORT}`);
});

# MediCore Frontend + Backend

A demo medical application with frontend and backend components.

## Features

- Patient registration and login
- Email OTP-based token generation (free via SMTP/Gmail)
- Doctor directory listing
- **Patient queue management** - View waiting patients, estimated wait times, and join queues
- Persistent data storage (JSON files in `data/`)

## Setup (Node backend + static frontend)

1. Install dependencies:
   ```bash
   npm install
   ```
2. (Recommended) Configure OTP email (SMTP).

   Set these environment variables before starting the server:
   - `SMTP_HOST` (example: `smtp.gmail.com`)
   - `SMTP_PORT` (example: `587`)
   - `SMTP_USER` (your email)
   - `SMTP_PASS` (your app password)
   - `SMTP_FROM` (optional, defaults to `SMTP_USER`)
   - `OTP_SECRET` (optional, defaults to `dev-otp-secret`)

   Notes:
   - If SMTP is **not** configured, OTPs are printed to the server console so the demo still works locally.

3. Start the backend server:
   ```bash
   npm start
   ```
   Backend runs on `http://localhost:3000`.

4. Open the frontend via the backend server (recommended):
   - `http://localhost:3000/` (redirects to `doctors.html`)
   - `http://localhost:3000/register.html` → create patient
   - `http://localhost:3000/login.html` → username/password login
   - `http://localhost:3000/token.html` → request + verify OTP, get session token
   - `http://localhost:3000/doctors.html` → join queue (requires session token)
   - `http://localhost:3000/queue.html` → view queue
   - `http://localhost:3000/admin-dashboard.html` → admin dashboard (doctors + queue maintenance)
   - `http://localhost:3000/feedback.html` → user feedback form
   - `http://localhost:3000/doctor-login.html` → doctor login
   - `http://localhost:3000/doctor-dashboard.html` → doctor dashboard (today’s appointments)

   (You can still open the `.html` files directly, but serving them avoids file:// + fetch quirks in some browsers.)

## API Endpoints

- `GET /api/health` - Health check
- `GET /api/doctors` - Get list of doctors
- `GET /api/admin/doctors` - Doctor admin list (requires key)
- `PUT /api/admin/doctors/:id` - Update doctor timing/availability (requires key)
- `GET /api/admin/queue` - Admin queue list (requires key)
- `PUT /api/admin/queue/:phone/status` - Update queue status (requires key)
- `DELETE /api/admin/queue/:phone` - Remove patient from queue (requires key)
- `POST /api/admin/queue/clear` - Clear queue (requires key)
- `POST /api/feedback` - Submit feedback
- `GET /api/admin/feedback` - List feedback (requires key)
- `POST /api/register` - Register a new patient
- `POST /api/login` - Login with username/password
- `POST /api/token/request` - Request OTP (sent to the registered email)
- `POST /api/token/verify` - Verify OTP and generate session token
- `GET /api/queue` - Get current patient queue with stats
- `POST /api/queue/join` - Join queue for a specific doctor (requires `{ token }`)
- `POST /api/queue/leave` - Leave the queue (requires `{ token }`)

## Data Storage

User data, OTP requests, session tokens, and queue information are stored in JSON files in the `data/` directory.
Doctor availability and timing are stored in `data/doctors.json`.
Feedback submissions are stored in `data/feedback.json`.

## Dev OTP convenience (local demo)

If SMTP is not configured, OTPs are printed to the server console. For easier local testing, the backend also returns `devOtp` in the `/api/token/request` response (and the UI will prefill it) when `NODE_ENV` is not `production`. You can control this with:

- `EXPOSE_DEV_OTP=true|false` (default: `true` in dev)

## Admin key

Admin requests require an admin key (query param `?key=...` or header `X-Admin-Key`).

- Default: `admin123`
- Change with env var: `DOCTOR_ADMIN_KEY`

## Email OTP

Token generation uses OTP sent to the patient’s registered email (not SMS). The token page (`token.html`) requires a successful login first, then sends OTP to the email on file.

## Doctor portal

- Doctor login username: doctor `id` (example: `dr-rajesh-sharma`)
- Default password: `doctor123` (override with env var `DOCTOR_DEFAULT_PASSWORD`)
- Session TTL (minutes): `DOCTOR_SESSION_TTL_MINUTES` (default: `480`)

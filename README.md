# eHealth Platform UI Design

README global du projet (frontend + backend + service AI), avec commandes de lancement, configuration, architecture et endpoints.

## 1) Vue d ensemble

Cette plateforme contient 3 briques principales:

- Frontend: React + Vite (UI medecin/patient)
- Backend: Node.js + Express + MongoDB + JWT
- AI Service: FastAPI (prediction du risque respiratoire + explication + base de recommandations)

Flux principal:

1. Le frontend appelle le backend sur `http://localhost:4000/api` (ou `VITE_API_BASE_URL`).
2. Le backend appelle le service AI sur `http://127.0.0.1:8100` (via `AI_SERVICE_URL`).
3. Le service AI calcule un score de risque et retourne prediction + explication.

## 2) Structure du monorepo

- `src/` -> frontend React
- `backend/` -> API Express
- `ai-service/` -> microservice FastAPI + pipeline ML

Fichiers utiles:

- Frontend bootstrap: `src/main.tsx`
- Frontend API client: `src/app/lib/api.ts`
- Backend server: `backend/src/server.js`
- Backend app: `backend/src/app.js`
- Backend route index: `backend/src/routes/index.js`
- AI app entrypoint: `ai-service/app/main.py`
- AI routes: `ai-service/app/api/routes.py`
- AI dev script (Windows): `ai-service/scripts/run_dev.ps1`
- AI smoke test (Windows): `ai-service/scripts/smoke_test.ps1`

## 3) Prerequis

- Node.js 18+ (recommande: Node 20 LTS)
- npm
- Python 3.11 (recommande pour `ai-service`)
- MongoDB local (ou URI distante)
- Windows PowerShell (si tu utilises les scripts `.ps1`)

## 4) Installation

Depuis la racine du projet:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design"
npm install
```

Installer aussi les dependances backend:

```powershell
cd backend
npm install
```

Le service AI utilise l environnement Python local. Si FastAPI ou Uvicorn manquent, installe les dependances avec:

```powershell
cd ai-service
..\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## 5) Configuration (.env)

### Backend (`backend/.env`)

Exemple minimum:

```env
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/ehealth_platform
JWT_SECRET=replace-with-strong-secret
JWT_EXPIRES_IN=7d
FRONTEND_ORIGIN=http://localhost:5173
AI_SERVICE_URL=http://127.0.0.1:8100
AI_SERVICE_TIMEOUT_MS=4000
```

### AI service (`ai-service/.env`)

Variables principales:

```env
AI_SERVICE_HOST=0.0.0.0
AI_SERVICE_PORT=8100
AI_MODELS_DIR=../models
GUIDELINES_DIR=./data/guidelines
MAX_SERIES_LENGTH=48
DISTRESS_THRESHOLD=0.55
```

Notes:

- `AI_MODELS_DIR` pointe par defaut vers `../models`, donc les artefacts finaux restent dans le dossier racine `models/`.
- Si TensorFlow/PyTorch ne sont pas installes, l app verifie quand meme les artefacts et utilise un mode de prediction deterministe pour garder les boutons Run AI + RAG fonctionnels en local.

### Frontend (optionnel)

Le frontend lit `VITE_API_BASE_URL` et fallback sur `http://localhost:4000/api`.

## 6) Lancement local complet (3 terminaux)

### Terminal A - AI service

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design\ai-service"
.\scripts\run_dev.ps1
```

Si PowerShell bloque les scripts:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

### Terminal B - Backend

Depuis la racine:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design"
npm run dev:backend
```

Ou depuis `backend/`:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design\backend"
npm run dev
```

### Terminal C - Frontend

Depuis la racine:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design"
npm run dev
```

Acces local:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:4000/health`
- AI health: `http://127.0.0.1:8100/health`

## 7) Verifications rapides

### AI

```powershell
Invoke-RestMethod http://127.0.0.1:8100/health
```

Smoke test AI:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design\ai-service"
.\scripts\smoke_test.ps1
```

### Backend

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/api
```

## 8) Seed base de donnees et comptes demo

Pour initialiser des donnees demo backend:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design"
npm run seed:backend
```

Comptes seed:

- Docteur: `doctor@respir.ai` / `Doctor123!`
- Patients: `prenom.nom@respir.ai` / `Patient123!`

Exemple patient seed:

- `sophie.turner@respir.ai` / `Patient123!`

## 9) Scripts utiles

### Racine

- `npm run dev` -> frontend Vite
- `npm run dev:ai` -> service FastAPI AI
- `npm run build` -> build frontend
- `npm run dev:backend` -> backend en mode dev
- `npm run start:backend` -> backend en mode start
- `npm run seed:backend` -> seed MongoDB

### Backend

- `npm run dev`
- `npm run start`
- `npm run seed`
- `npm run dedupe:doctor-ai-results`
- `npm run dedupe:doctor-ai-results:apply`

### AI service

- `./scripts/run_dev.ps1`
- `./scripts/smoke_test.ps1`

## 10) API map

Base backend: `http://localhost:4000/api`

### Auth (`/api/auth`)

- `POST /register`
- `POST /login`
- `GET /me`
- `POST /logout`

### Doctor (`/api/doctor`)

- `GET /dashboard/summary`
- `GET /patients`
- `POST /patients`
- `GET /patients/:patientIdentifier`
- `POST /patients/:patientIdentifier/upload`
- `GET /patients/:patientIdentifier/ai-insights`
- `GET /patients/:patientIdentifier/vitals`
- `GET /patients/:patientIdentifier/environment`
- `GET /patients/:patientIdentifier/risk-history`
- `POST /patients/:patientIdentifier/risk/validate`
- `POST /patients/:patientIdentifier/risk/dismiss`
- `GET /patient-chats`
- `GET /patient-chats/:patientIdentifier/messages`
- `POST /patient-chats/:patientIdentifier/messages`
- `POST /patients/:patientIdentifier/ai-insights/manual`
- `POST /patients/:patientIdentifier/ai-insights/send-to-patient`
- `GET /patients/:patientIdentifier/intake-form/pdf`
- `GET /consultations`
- `POST /consultations`
- `POST /consultations/:consultationId/notes`
- `GET /reports`
- `POST /reports/generate`
- `GET /reports/:reportId`
- `GET /reports/:reportId/pdf`
- `GET /notifications`
- `PATCH /notifications/read-all`
- `PATCH /notifications/:notificationId/read`
- `GET /analytics/weekly`
- `GET /knowledge-base`

### Patient (`/api/patient`)

- `GET /me/home`
- `GET /me/intake-form`
- `PATCH /me/intake-form`
- `GET /me/history`
- `GET /me/medications`
- `PATCH /me/medications/:medicationId/taken`
- `GET /me/notifications`
- `PATCH /me/notifications/:notificationId/read`
- `GET /me/settings`
- `PATCH /me/settings`
- `GET /me/profile`
- `PATCH /me/profile`
- `GET /me/chat`
- `POST /me/chat`
- `GET /me/doctor`

### AI service

Base AI: `http://127.0.0.1:8100`

- `GET /health`
- `POST /api/v1/predict`
- `POST /api/v1/explain`
- `GET /api/v1/guidelines`

## 11) Exemple appel AI

```powershell
$payload = @{
  patient_id = "demo"
  physiology = @(
    @{ spo2 = 95; rr = 20; hr = 86; cough_events_per_hour = 4; wheezing_detected = $false },
    @{ spo2 = 93; rr = 23; hr = 94; cough_events_per_hour = 8; wheezing_detected = $true }
  )
  environment = @{ aqi = 125; temperature = 30; humidity = 70 }
  top_k_guidelines = 3
}

Invoke-RestMethod -Uri "http://127.0.0.1:8100/api/v1/explain" `
  -Method Post `
  -ContentType "application/json" `
  -Body ($payload | ConvertTo-Json -Depth 8)
```

## 12) Entrainement modeles AI

Depuis `ai-service/`:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design\ai-service"
python -m app.training.run_training --data-dir data --models-dir models --seed 42
```

Artefacts generes dans `ai-service/models`:

- `vital_signs_model.pkl`
- `symptoms_model.pkl`
- `history_model.pkl`
- `environment_model.pkl`
- `preprocessor.pkl`
- `training_metrics.json`
- `unified_dataset_preview.csv`

## 13) Option Docker pour AI

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design"
docker build -t ehealth-ai ./ai-service
docker run --rm -p 8100:8100 --env-file ./ai-service/.env ehealth-ai
```

## 14) Troubleshooting

1. `MONGODB_URI is not defined`
- Verifier `backend/.env` et la variable `MONGODB_URI`.

2. `AI service unavailable` cote backend
- Verifier que l AI tourne sur `127.0.0.1:8100`.
- Verifier `AI_SERVICE_URL` dans `backend/.env`.

3. Erreur CORS frontend
- Verifier `FRONTEND_ORIGIN=http://localhost:5173` dans `backend/.env`.

4. Erreur auth `401 Authentication required`
- Verifier le token Bearer envoye par le frontend.

5. Script PowerShell bloque
- Executer `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.

## 15) Build et run production (minimal)

Frontend:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design"
npm run build
```

Backend:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design\backend"
npm run start
```

AI:

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design\ai-service"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8100
```

---

Si tu veux, je peux aussi te generer une version "README rapide" (1 page) et garder ce fichier comme doc complete.

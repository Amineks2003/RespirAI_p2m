# eHealth Platform UI Design

README global (frontend + backend + AI service) avec installation, configuration, commandes et endpoints.

## 1) Vue d ensemble

La plateforme contient 3 briques:

- Frontend: React + Vite (UI medecin/patient)
- Backend: Node.js + Express + MongoDB + JWT
- AI Service: FastAPI (prediction du risque + explication + RAG)

Flux principal:

1. Le frontend appelle le backend sur `http://localhost:4000/api` (ou `VITE_API_BASE_URL`).
2. Le backend appelle le service AI sur `http://127.0.0.1:8100` (via `AI_SERVICE_URL`).
3. Le service AI renvoie les scores, la fusion des 2 modeles et les explications.

### Explication du projet

Ce projet simule une plateforme e-sante centre sur la prediction du risque respiratoire. Il combine un portail clinicien, une app patient et un microservice AI pour evaluer des signaux vitaux, produire un score de risque et proposer des explications et recommandations.

- Portail clinicien: dashboard, suivi patients, historiques vitaux/environnement, validation ou rejet des alertes, rapports PDF.
- Portail patient: profil, medicaments, historique, notifications et chat avec le soignant.
- AI service: inference multi-modele (2 modeles), explications RAG, execution manuelle sur fichiers (apnea/CSV) et endpoints de health.

### Cas d usage (clinicien/patient/AI)

- Clinicien: surveiller les risques, consulter les tendances vitaux, valider ou rejeter une alerte, générer un rapport PDF à partir du lancement des prédictions et analyse des deux modèles ai et contacter un patient.
- Patient: consulter son profil, recevoir les notifications, suivre ses medicaments, partager des données et discuter avec le soignant.
- AI service: exécuter les prédictions, générer les explications RAG, traiter des fichiers (apnea/CSV) et alimenter le backend en scores.

## 2) Structure du monorepo

- `src/` -> frontend React
- `backend/` -> API Express
- `ai-service/` -> microservice FastAPI
- `models/` -> artefacts AI (apnea + spo2)

Fichiers utiles:

- Frontend bootstrap: `src/main.tsx`
- Frontend API client: `src/app/lib/api.ts`
- Backend server: `backend/src/server.js`
- Backend app: `backend/src/app.js`
- Backend route index: `backend/src/routes/index.js`
- AI app entrypoint: `ai-service/app/main.py`
- AI config: `ai-service/app/config.py`
- AI model manager: `ai-service/app/model_service.py`
- AI dev script (Windows): `ai-service/scripts/run_dev.ps1`
- AI smoke test (Windows): `ai-service/scripts/smoke_test.ps1`

## 3) Prerequis

- Node.js 18+ (recommande: Node 20 LTS)
- npm
- Python 3.11 (recommande pour `ai-service`)
- MongoDB local (ou URI distante)
- PowerShell (si tu utilises les scripts `.ps1`)

## 4) Installation

Depuis la racine du projet:

```powershell
npm install
```

Installer aussi les dependances backend:

```powershell
cd backend
npm install
```

Installer les dependances AI:

```powershell

cd ai-service
python -m venv .venv
.\.venv\Scripts\Activate
pip install -r requirements.txt

```
**** REMARQUE ****
Si python n'est pas reconnue, installe la à partir de ce lien https://www.python.org/downloads/

## 5) Lancement local complet (3 terminaux)

### Terminal A - AI service

```powershell
cd ai-service
python -m uvicorn app.main:app --host 0.0.0.0 --port 8100 
```

### Terminal B - Backend

Depuis la racine:

```powershell
npm run dev:backend
```

Ou depuis `backend/`:

```powershell
cd backend
npm run dev
```

### Terminal C - Frontend

Depuis la racine:

```powershell
npm run dev
```

Acces local:

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:4000/health`
- AI health: `http://127.0.0.1:8100/health`

## 6) Verifications rapides

### AI

```powershell
Invoke-RestMethod http://127.0.0.1:8100/health
```

### Backend

```powershell
Invoke-RestMethod http://localhost:4000/health
Invoke-RestMethod http://localhost:4000/api
```

## 7) Seed base de donnees et comptes demo

```powershell
npm run seed:backend
```

Comptes seed:

- Docteur: `doctor@respir.ai` / `Doctor123!`
- Patients: `prenom.nom@respir.ai` / `Patient123!`

Exemple:

- `sophie.turner@respir.ai` / `Patient123!`

## 8) Scripts utiles

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
- `npm run dedupe:doctor-ai-results`
- `npm run dedupe:doctor-ai-results:apply`
- `npm run backfill:model-inputs`

### AI service

- `./scripts/run_dev.ps1`
- `./scripts/smoke_test.ps1`

## 9) API map

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
- `POST /api/v1/manual/run`
- `POST /api/v1/spo2-lstm/predict-csv`
- `POST /api/v1/rag/rebuild`
- `GET /api/v1/rag/status`
- `GET /api/v1/rag/web-test`
- `GET /api/v1/guidelines`

## 10) Exemple appel AI

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

## 11) Modeles AI

Deux modeles sont attendus dans `models/`:

- `models/spo2/lstm_SPO2_model.keras`
- `models/apnea/cnn_bilstm_model.keras`

Le service supporte aussi un modele audio optionnel si present dans `models/respiratory/model_best.pth`.

## 12) Option Docker pour AI

```powershell
docker build -t ehealth-ai ./ai-service
docker run --rm -p 8100:8100 --env-file ./ai-service/.env ehealth-ai
```

## 13) Troubleshooting

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

## 14) Build et run production (minimal)

Frontend:

```powershell
npm run dev
```

Backend:

```powershell
cd backend
npm run dev
```

AI:

```powershell
cd ai-service
python -m uvicorn app.main:app --host 0.0.0.0 --port 8100
```

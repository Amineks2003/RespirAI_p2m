# MCP Testing Commands — eHealth Platform

Ce README regroupe les commandes utilisées pour tester l’intégration **MCP** du projet eHealth.

Architecture testée :

```text
MCP Host Demo
   ↓
MCP Client
   ↓
MCP Server
   ↓
AI-service
   ├── Model 1 · CNN-BiLSTM Apnea Signals
   ├── Model 2 · LSTM SpO2 Deterioration
   └── Adaptive RAG local + web search contrôlé
```

---

## 1. Se placer dans le dossier AI-service

```powershell
cd "C:\Users\ksont\Desktop\eHealth Platform UI Design\ai-service"
```

Activer l’environnement virtuel si nécessaire :

```powershell
..\.venv\Scripts\activate
```

---

## 2. Tester le statut MCP complet

Cette commande vérifie que le **MCP Host Demo** peut appeler le serveur MCP et récupérer l’état des modèles et du RAG.

```powershell
python -m app.mcp_host_demo --mode health
```

Résultat attendu :

```text
status: ok
Model 1 CNN-BiLSTM Apnea loaded
Model 2 LSTM SpO2 loaded
Adaptive RAG available
Web search controlled available
```

Remarque : si `model_best.pth` affiche `No module named 'torch'`, ce n’est pas bloquant si le Model 3 n’est pas utilisé.

---

## 3. Tester les documents RAG disponibles

Cette commande vérifie que le MCP peut accéder aux documents médicaux indexés.

```powershell
python -m app.mcp_host_demo --mode documents
```

Résultat attendu : affichage des 7 documents :

```text
BTS_Oxygen_Guideline.pdf
GINA_2025_Asthma.pdf
GOLD_2025_COPD.pdf
NEWS2_RCP.pdf
NICE_Acutely_Ill_Adults.pdf
Surviving_Sepsis_2021.pdf
WHO_Oxygen_Therapy.pdf
```

---

## 4. Tester le Model 2 · LSTM SpO2 Deterioration

Si le fichier `patient_data.csv` est dans le dossier `ai-service` :

```powershell
python -m app.mcp_host_demo --mode spo2 --csv .\patient_data.csv
```

Si le fichier `patient_data.csv` est dans la racine du projet, c’est-à-dire dans :

```text
C:\Users\ksont\Desktop\eHealth Platform UI Design\patient_data.csv
```

alors depuis `ai-service`, utiliser :

```powershell
python -m app.mcp_host_demo --mode spo2 --csv ..\patient_data.csv
```

Avec un chemin absolu :

```powershell
python -m app.mcp_host_demo --mode spo2 --csv "C:\Users\ksont\Desktop\eHealth Platform UI Design\patient_data.csv"
```

Cette commande teste :

```text
MCP Host Demo
→ MCP Client
→ MCP Server
→ Model 2 LSTM SpO2
→ Adaptive RAG model-aware
```

---

## 5. Tester le Model 1 · CNN-BiLSTM Apnea Signals

Depuis `ai-service`, si les fichiers apnea sont dans :

```text
data/apnea/
```

utiliser :

```powershell
python -m app.mcp_host_demo --mode apnea --patient-id "#P-2287" --apn ..\data\apnea\a01.apn --dat ..\data\apnea\a01.dat --hea ..\data\apnea\a01.hea
```

Cette commande teste :

```text
MCP Host Demo
→ MCP Client
→ MCP Server
→ Model 1 CNN-BiLSTM Apnea
→ Adaptive RAG model-aware lié à l’apnée
```

---

## 6. Tester le mode multimodal complet

Cette commande lance les modèles disponibles selon les fichiers fournis.

Si `patient_data.csv` est dans `ai-service` :

```powershell
python -m app.mcp_host_demo --mode all --patient-id "#P-2287" --csv .\patient_data.csv --apn ..\data\apnea\a01.apn --dat ..\data\apnea\a01.dat --hea ..\data\apnea\a01.hea
```

Si `patient_data.csv` est dans la racine du projet :

```powershell
python -m app.mcp_host_demo --mode all --patient-id "#P-2287" --csv ..\patient_data.csv --apn ..\data\apnea\a01.apn --dat ..\data\apnea\a01.dat --hea ..\data\apnea\a01.hea
```

---

## 7. Tester directement le statut RAG via FastAPI

D’abord lancer l’AI-service dans un terminal :

```powershell
uvicorn app.main:app --reload --port 8100
```

Puis dans un autre terminal :

```powershell
curl.exe http://localhost:8100/api/v1/rag/status
```

Résultat attendu :

```text
available: true
index_exists: true
pdf_count: 7
web_search_enabled: true
web_search.available: true
```

---

## 8. Erreur fréquente : fichier CSV introuvable

Erreur possible :

```text
FileNotFoundError: No such file or directory: 'patient_data.csv'
```

Cause : le fichier n’est pas dans le dossier courant `ai-service`.

Solutions :

```powershell
dir
dir ..
```

Si le fichier est dans le dossier parent :

```powershell
python -m app.mcp_host_demo --mode spo2 --csv ..\patient_data.csv
```

Ou utiliser le chemin absolu :

```powershell
python -m app.mcp_host_demo --mode spo2 --csv "C:\chemin\vers\patient_data.csv"
```

---

## 9. Résumé des commandes principales

```powershell
python -m app.mcp_host_demo --mode health
python -m app.mcp_host_demo --mode documents
python -m app.mcp_host_demo --mode spo2 --csv .\patient_data.csv
python -m app.mcp_host_demo --mode apnea --patient-id "#P-2287" --apn ..\data\apnea\a01.apn --dat ..\data\apnea\a01.dat --hea ..\data\apnea\a01.hea
python -m app.mcp_host_demo --mode all --patient-id "#P-2287" --csv .\patient_data.csv --apn ..\data\apnea\a01.apn --dat ..\data\apnea\a01.dat --hea ..\data\apnea\a01.hea
curl.exe http://localhost:8100/api/v1/rag/status
```

---

## Conclusion

Ces commandes valident que le projet contient bien une architecture MCP complète :

```text
MCP Host Demo
MCP Client
MCP Server
Models IA multimodaux
Adaptive RAG local
Web search contrôlé
```

Cette architecture permet à un agent externe médical d’interagir avec les modèles IA et le RAG via des outils MCP standardisés.

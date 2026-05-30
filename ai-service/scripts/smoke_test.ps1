$ErrorActionPreference = "Stop"

$baseUrl = if ($env:AI_SERVICE_URL) { $env:AI_SERVICE_URL } else { "http://127.0.0.1:8100" }

Invoke-RestMethod "$baseUrl/health"

$payload = @{
  patient_id = "smoke"
  model = "all_models"
  intake_form = @{
    age = 58
    sex = "female"
    spo2 = 92
    heart_rate = 104
    respiratory_rate = 24
    cough = $true
    shortness_of_breath = $true
    wheezing = $true
    # environment fields removed
  }
  physiology = @(
    @{ spo2 = 94; rr = 21; hr = 96; cough_events_per_hour = 4; wheezing_detected = $false },
    @{ spo2 = 92; rr = 24; hr = 104; cough_events_per_hour = 9; wheezing_detected = $true }
  )
  top_k_guidelines = 4
}

Invoke-RestMethod -Uri "$baseUrl/api/v1/explain" -Method Post -ContentType "application/json" -Body ($payload | ConvertTo-Json -Depth 8)

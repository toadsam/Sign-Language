# Backend (Gradle)

## 1) Prerequisites
- Java 17
- Gradle (or Gradle Wrapper)

## 2) Environment Variables
Set these before running:
- `GOOGLE_CLIENT_ID` (recommended)
- `GOOGLE_WEB_CLIENT_ID` (fallback alias)
- `JWT_SECRET` (32+ chars)

Example (PowerShell):
```powershell
$env:GOOGLE_CLIENT_ID="987382520137-r0bo3q42ednnk7rs9ofjm44cnsk5in40.apps.googleusercontent.com"
$env:GOOGLE_WEB_CLIENT_ID="987382520137-r0bo3q42ednnk7rs9ofjm44cnsk5in40.apps.googleusercontent.com"
$env:JWT_SECRET="replace_with_a_long_random_secret_min_32_chars"
```

## 3) Run
If Gradle is installed:
```powershell
gradle bootRun
```

If Gradle Wrapper exists:
```powershell
.\gradlew.bat bootRun
```

## 4) Build Top-300 Dictionary From AI-Hub Morphology JSON
This command scans AI-Hub morphology JSON files, counts token frequencies, and rewrites
`src/main/resources/sign_dictionary.json` with top-k words.

```powershell
node .\scripts\build-top-dictionary.mjs `
  --data-root "C:\path\to\aihub\morph-json" `
  --top-k 300 `
  --output "src\main\resources\sign_dictionary.json"
```

Optional:
- `--min-len 1` minimum token length filter.

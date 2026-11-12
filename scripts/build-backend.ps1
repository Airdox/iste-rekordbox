$ErrorActionPreference = 'Stop'
$fixture = 'build/synthetic_test_master.db'
if (-not (Test-Path -LiteralPath $fixture)) {
    New-Item -ItemType Directory -Path build -Force | Out-Null
    & .\.venv\Scripts\python.exe tests/generate_synthetic_db.py $fixture
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& .\.venv\Scripts\python.exe -c "from comtypes.client import GetModule; GetModule('UIAutomationCore.dll')"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& .\.venv\Scripts\python.exe -m PyInstaller --noconfirm --onedir --hidden-import comtypes.gen.UIAutomationClient --name cuepoint-core --distpath build/python --workpath build/pyinstaller --specpath build backend/main.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

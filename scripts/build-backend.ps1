$ErrorActionPreference = 'Stop'
$py = if (Test-Path -LiteralPath .\.venv\Scripts\python.exe) { '.\.venv\Scripts\python.exe' } else { (Get-Command python).Source }
$fixture = 'build/synthetic_test_master.db'
if (-not (Test-Path -LiteralPath $fixture)) {
    New-Item -ItemType Directory -Path build -Force | Out-Null
    & $py tests/generate_synthetic_db.py $fixture
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
& $py -c "from comtypes.client import GetModule; GetModule('UIAutomationCore.dll')"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
& $py -m PyInstaller --noconfirm --onedir --hidden-import comtypes.gen.UIAutomationClient --name cuepoint-core --distpath build/python --workpath build/pyinstaller --specpath build backend/main.py
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Cuepoint

Cuepoint liest Rekordbox-Bibliotheken, kombiniert Metadatenfilter und mehrstufige Sortierungen und findet Anschlusstracks anhand von Tonart und Tempo.

## Windows

Starte die aktuelle `Cuepoint-*-Windows-x64.exe` aus `release`. Beim ersten Start sucht Cuepoint unter `E:\PIONEER\Master` nach `master.db` oder `exportLibrary.db`. Über **Datenquelle** lässt sich eine andere Datei oder ein Ordner wählen. Wenn die Quelle beim Start fehlt, öffnet Cuepoint die gekennzeichnete synthetische Testbibliothek.

Die Originaldateien werden mit `rb` gelesen. Cuepoint prüft die temporäre Kopie anhand von Dateistand und SHA-256 und öffnet SQLite oder SQLCipher ausschließlich auf dieser Kopie. Die Momentaufnahme berücksichtigt vorhandene WAL-Dateien. Abfragen und Indizes laufen danach in einer separaten SQLite-Datenbank im Arbeitsspeicher. **Bibliothek neu laden** erstellt eine neue Momentaufnahme.

## Bedienung

- **Filter hinzufügen** kombiniert Bedingungen für Metadaten. Die Schnellwahl und der linke Filterbereich zeigen die häufigsten Genres, BPM-Grenzen und Camelot-Tonarten. **Harmonische Nachbarn** nimmt pro gewählter Tonart die beiden angrenzenden Positionen und die relative Dur- oder Molltonart hinzu.
- **Sortierung hinzufügen** ergänzt eine Stufe. Ein Klick auf die Sortier-Pill kehrt ihre Richtung um. Ziehen oder `Alt` plus Pfeiltasten ändern die Reihenfolge. Über Rechtsklick auf einen Tabellenkopf oder **Spalten** lässt sich das gespeicherte Spaltenlayout ändern.
- Rechtsklick auf einen Track setzt ihn als Referenz. **Live Match** übernimmt BPM und Tonart aus dem Radar oder der manuellen Referenz. **Auto-Follow** aktualisiert die Treffer mit dem gewählten Deck. Die BPM-Toleranz ist relativ zum Tempo der Referenz.
- Wähle im Tab **Live Match** die Netzwerkschnittstelle für Pro DJ Link. Der passive Modus empfängt verfügbare Statuspakete. Für Player, die Status erst nach einer Präsenzmeldung senden, wähle den Ankündigungsmodus. USB-/SD-Track-IDs werden anhand des Quellplayers, des Slots und der zugeordneten `exportLibrary.db` oder `export.pdb` aufgelöst. Bei Medienwechsel die Zuordnung aktualisieren. **Demo starten** verwendet einen Track aus der geladenen Bibliothek.
- Läuft Rekordbox auf demselben Windows-PC, kann Cuepoint die Deck-Anzeigen über die Windows-Barrierefreiheit lesen. Der Deck-Radar verwendet das laufende Deck mit seiner aktuellen Tonart und seinem Tempo. Dafür genügt ein geöffnetes Rekordbox-Fenster mit Deck-Anzeigen im Performance-Modus.

## Entwicklung und Prüfung

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
npm ci
.\.venv\Scripts\python tests/generate_synthetic_db.py
npm run build
npm start
```

Der Generator erstellt `build\synthetic_test_master.db` mit 15.500 Tracks im Rekordbox-Schema. Die Dateien in den Track-Pfaden sind synthetische Metadatenwerte.

```powershell
.\.venv\Scripts\python -m pytest tests -q -s
npm run test:ui
npm run package:win
```

Die kombinatorische Suite vergleicht jede Abfrage mit einer unabhängigen Python-Berechnung. Sie schreibt die Anzahl der geprüften Fälle und die unbereinigten Laufzeiten nach `reports/combinatorial-metrics.json`. Der Electron-Test verwendet standardmäßig ein eigenes Profil und die synthetische Testbibliothek. Mit `CUEPOINT_BENCHMARK_UI=1` misst er zusätzlich die Zeit zwischen Scroll-Frames.

Die [Freigabeprüfung](docs/quality-gate.md) beschreibt die Nachweise für CI, das Windows-Paket und die interaktive Rekordbox-Abnahme.

Die Implementierung verwendet die [Camelot-Farben und Tonartbeziehungen von Mixed In Key](https://mixedinkey.com/camelot-wheel/), das [Rekordbox-Schema aus pyrekordbox](https://github.com/dylanljones/pyrekordbox) und die [Statuspaket-Dokumentation von Deep Symmetry](https://djl-analysis.deepsymmetry.org/djl-analysis/vcdj.html).

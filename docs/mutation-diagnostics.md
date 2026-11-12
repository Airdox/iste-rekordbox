# Frontend-Mutationsdiagnose

Der historische GitHub-Actions-Lauf für `ff6885b8a96b778746d5fff714ae500f49426c48` enthält 497 Mutanten. Stryker meldete 303 `Killed`, 176 `Timeout`, 16 `Survived` und 2 `RuntimeError`. Der ausgewiesene Score von 96,77 % schließt die Timeouts ein. [Workflow-Lauf](https://github.com/Airdox/iste-rekordbox/actions/runs/43276734530) · [Stryker-Artefakt](https://github.com/Airdox/iste-rekordbox/actions/runs/43276734530/artifacts/13976406423)

## Gezielte Prüfung der historischen Mutanten

Die drei Quelldateien aus dem Bericht stimmen mit den Dateien in `4ba5a26` überein. Die Diagnose ersetzte für jeden Mutanten ausschließlich die archivierte Quelltextspanne, transpilierte das betroffene Modul und führte die zugehörigen Assertions aus. Die Assertions bestanden auf dem Originalcode.

| Modul | Historische IDs | Ergebnis der Substitution |
| --- | --- | --- |
| `src/api.ts` | 8, 50, 104 | 3 fehlgeschlagene Assertions für Fehlerpräfix, zweistellige Camelot-Farbpalette und Blob-Bytes |
| `src/camelot-wheel.tsx` | 302, 305, 308, 310, 329, 343, 344, 345, 346 | 9 fehlgeschlagene Assertions für Tastaturaktivierung, Modifier, Browser-Standardaktion und Klassen der Schnellwahl |
| `src/metadata.ts` | 444, 466, 494, 497 | 4 fehlgeschlagene Assertions für Preset-Regeln, gespeicherte Preset-Form und Array-Grenzen |
| `src/api.ts` | 12 | `RangeError` beim Laden des Moduls, da `Intl.NumberFormat('')` ein ungültiges Locale erhält |
| `src/metadata.ts` | 353 | `TypeError` beim Laden des Moduls, da `new Map(...)` durch den mutierten Mapper `undefined` als Eintrag erhält |

Die erweiterten Vitest-Tests prüfen dieselben Verträge sowie die tatsächliche Auswahl im App-Zustand. Der vollständige Stryker-Lauf liefert den verbindlichen aktuellen Score. Die gezielte Substitution weist das Verhalten der 18 historischen Mutanten nach.

## Timeouts und Windows-Ressourcen

Der historische Bericht enthält 71 Timeouts bei statischen und 105 bei zur Laufzeit aktivierten Mutanten. Beim Camelot-Mutanten mit `Hit limit reached (250802/250800)` hat Stryker die Ausführung wegen der Aufrufzahl beendet. Für die übrigen 175 Timeouts fehlt `statusReason`.

Eine Node-22-Messung auf dem Windows-Host mit vier logischen Prozessoren und rund 19,4 GiB RAM startete für jede Stichprobe frische Prozesse und lud dieselbe installierte jsdom-Version. Sie misst Prozessstart, Import und eine einfache DOM-Initialisierung ohne App-Tests.

| Gleichzeitige Prozesse | Gesamtdauer | jsdom-Import pro Prozess | CPU-Zeit pro Prozess | RSS pro Prozess |
| --- | --- | --- | --- | --- |
| 1 | 26,65 s | 23,55 s | 3,27 s | 95,2 MiB |
| 4 | 69,78 s | 51,77–64,75 s | 3,20–3,31 s | 78,5–90,6 MiB |

Unter Last stieg vor allem die verstrichene Start- und Importzeit. Der Stryker-Timeout berücksichtigt neben `timeoutMS` auch im Trockenlauf gemessene Test- und Startzeiten. Ein schneller Trockenlauf kann spätere Lastspitzen deshalb unterschätzen. Die Messung erklärt ein plausibles Zeitlimit auf dem lokalen Host. Sie erlaubt keine Zuordnung der 175 historischen Timeouts zu einzelnen Runner-Ursachen. [Stryker-Timeout-Berechnung](https://stryker-mutator.io/docs/stryker-js/configuration/#timeoutms-number)

Der instrumentierte lokale Lauf mit Debug-Logging scheiterte vor der Testausführung. Stryker 10.1.1 serialisiert im Debugpfad die Vitest-5.1-Konfiguration, die zyklische Verweise enthält. Der normale Info-Logpfad vermeidet diese Serialisierung. Die Windows-Versuche mit einer Junction als Abhängigkeitspfad benötigten zudem einen expliziten Link im Stryker-Sandboxverzeichnis.

Die neue Stryker-Konfiguration begrenzt die Parallelität auf zwei Prozesse und verwendet den von Vitest und Stryker unterstützten `vmThreads`-Pool. Vitest kann damit die jsdom-Umgebung wiederverwenden und behält getrennte VM-Kontexte pro Testdatei. Mutationsumfang, statische Mutanten und `timeoutMS: 20000` bleiben erhalten. Die vollständige Messung mit der neuen Konfiguration steht aus. [Stryker-Vitest-Konfiguration](https://stryker-mutator.io/docs/stryker-js/vitest-runner/) · [Vitest-Testumgebungen](https://vitest.dev/guide/improving-performance#test-environments)

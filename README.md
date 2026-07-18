# Catan Online — Hex-Aufbau-Strategie (Live-Multiplayer)

Eine Online-Multiplayer-Webapp im Catan-Genre. Mehrere Personen
spielen an verschiedenen Geräten in Echtzeit zusammen, treten über einen
**Lobby-Code** bei, und ein versehentlicher Verbindungsabbruch zerstört die
Partie nicht (Reconnect + Bot-Übernahme).

## Schnellstart

```bash
npm install
npm run dev
```

Das startet **Server** (WebSocket, Port 8787) und **Client** (Vite, Port 5173)
zusammen. Dann im Browser öffnen:

- **http://localhost:5173** — Raum erstellen → Code teilen → im zweiten Tab/Gerät
  über den Code beitreten → Host startet das Spiel.
- Teilbarer Link: `http://localhost:5173/?room=CODE` füllt den Code vorab aus.

Weitere Skripte:

```bash
npm test          # Shared-, Server- und Client-Tests
npm run test:e2e  # echter Zwei-Browser-Ablauf inkl. Disconnect/Reconnect
npm run gate      # alle Tests + Typecheck aller Pakete + Produktions-Build
npm run build     # Produktions-Build aller Pakete
npm start         # nur den Server starten (nach build)
```

Vor dem ersten E2E-Lauf einmal den reproduzierbaren Chromium-Testbrowser laden:

```bash
npm run test:e2e:install
```

In einer Linux-CI installiert `npm run test:e2e:install:ci` zusätzlich die benötigten
Systembibliotheken.

**Ports:** Client 5173, WebSocket-Server 8787. Der Server-Port lässt sich per
Umgebungsvariable `CATAN_SERVER_PORT` überschreiben (bewusst nicht `PORT`, damit ein
generisch gesetztes `PORT` — etwa für den Vite-Client — den Server nicht umleitet).

## Architektur (autoritativer Server)

Der **Server ist die einzige Wahrheit** — Clients senden nur serialisierbare
Actions, der Server validiert jede gegen die Spiellogik, wendet sie an und sendet
jedem Spieler eine **redigierte Sicht** (eigene Hand voll, von Gegnern nur
Kartenanzahlen).

```
shared/   Reine Spiellogik & Typen (kein React/Node/DOM). Deterministisch via
          seed-basiertem PRNG. Läuft identisch auf Client (Vorschau/Highlights)
          und Server (autoritativ). Reducer: apply(state, action) → {events}|{error}.
server/   Node + ws. Räume (Code, Join/Leave), Reconnect-Grace, Bot-Übernahme,
          Host-Migration, Action-Validierung, State-Broadcast, Chat, Latenz.
client/   Vite + React + TS. SVG-Board (statische Ebene memoisiert), Lobby,
          HUD, Handel, Dev-Karten, Räuber, WebSocket mit Auto-Reconnect.
```

## Live-Features & Robustheit

- **Lobby:** 6-stelliger Code (keine mehrdeutigen Zeichen), Farbwahl, Bereit-Status,
  Host-Krone, Kartenauswahl (5 feste Maps + Zufallskarte) mit Live-Board-Vorschau,
  Siegpunkte-Ziel, **Bank-Größe pro Rohstoff**, Kick.
- **Solo/Bots:** Host kann Bot-Sitze hinzufügen und **allein gegen Bots** spielen.
  Bots wählen ihre Startpositionen, würfeln, bauen, handeln, spielen
  Entwicklungskarten, versetzen den Räuber und verfolgen eigenständig Bauziele.
- **Bank:** endlicher Kartenpool je Rohstoff (in der Lobby einstellbar, Standard 19),
  im Spiel sichtbar. Ist die Bank leer, bekommt bei der Ausschüttung niemand diesen
  Rohstoff (fordern mehrere und es reicht nicht → niemand; fordert genau einer → Rest).
- **Reconnect:** dauerhafte `sessionId` in `localStorage`; bei Reload/Netzverlust
  verbindet der Client automatisch neu (Exponential-Backoff) und wird auf seinen
  Sitz mit voller Hand zurückgesetzt.
- **Versehentliches Verlassen:** Sitz bleibt reserviert, Grace-Frist (180 s). Ist
  der Getrennte am Zug, pausiert das Spiel sichtbar; nach Ablauf übernimmt die
  vollständige **Bot-Logik** den Sitz, damit niemand blockiert. Host kann getrennte
  Spieler sofort durch einen Bot ersetzen.
- **Host-Migration:** verlässt der Host, wandert die Rolle automatisch weiter.
  Leere Räume werden aufgeräumt.

## Spielregeln

Vollständig: Startaufstellung (Schlangenreihenfolge, 2. Siedlung schüttet aus),
Würfeln/Ertrag, 7er-Abwerfen + Räuber + Stehlen, Bauen (Straße/Siedlung/Stadt),
Bank-/Hafen-/Spielerhandel mit Bestätigungs-Flow, Entwicklungskarten (25er-Deck,
max. 1/Zug, nicht im Kaufzug), Längste Straße & Größte Rittermacht (wandernd),
verdeckte Siegpunktkarten, Sieg bei 10 (konfigurierbar).

## Performance

- Statisches Terrain (Hexes, Motive, Chips, Häfen) wird einmal memoisiert; nur die
  dynamische Ebene (Gebäude, Straßen, Räuber, Highlights) reagiert auf State.
- Reducer O(n); Board-Geometrie einmalig berechnet; gültige Bauplätze werden aus
  derselben reinen Logik client- wie serverseitig abgeleitet.

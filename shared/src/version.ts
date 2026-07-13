// Zentrale App-Version — die EINZIGE Quelle der Wahrheit.
// Nicht von Hand in mehreren Dateien pflegen: `npm run bump[:patch|:minor|:major]`
// erhöht diese Zahl und zieht sie automatisch durch package.json + SPRINTS.md.
// Überall in der UI (Boot-Splash, Spielstart-Intro, Info-Dialog, Lobby) wird
// APP_VERSION importiert, damit nie eine veraltete Nummer irgendwo hängen bleibt.
export const APP_VERSION = '3.1.4';

/** Für die Anzeige: mit führendem „v" (z. B. „v3.1.0"). */
export const APP_VERSION_LABEL = `v${APP_VERSION}`;

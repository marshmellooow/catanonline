import type { ReactNode } from 'react';
import { COSTS, PLAYER_COLORS, type ResourceType, type ResourceCounts } from '@catan/shared';
import { ResChip } from './ResChip';
import { RESOURCE_ORDER, resLabel } from './ui';
import { Settlement, RoadPiece } from '../board/pieces';
import { Route, Swords, ScrollText } from '../../icons';

// Anfänger-Erklärbereich im Info-Dialog: Siegpunkte + Baukosten, möglichst simpel
// mit kleinen Zeichnungen. Nutzt die echten Spielfiguren (Wiedererkennung auf dem Brett),
// ResChip für Kosten und die zentrale COSTS-Konstante — kein Dupl-Code, kein neues CSS.

const C = PLAYER_COLORS[0]; // feste Spielerfarbe (Rot) für die Mini-Figuren

/** Kleine SVG-Bühne für die Bau-Figuren (reine <g>, brauchen einen <svg>-Rahmen). */
function Mini({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 40 40" width={30} height={30} style={{ display: 'block', flexShrink: 0 }}>
      {children}
    </svg>
  );
}

const HOUSE = <Mini><Settlement x={20} y={20} w={120} color={C} /></Mini>;
const CITY = <Mini><Settlement x={20} y={20} w={100} color={C} city /></Mini>;
const ROAD = <Mini><RoadPiece x1={6} y1={20} x2={34} y2={20} w={44} color={C} /></Mini>;

/** Eine Zeile: Symbol links (feste Breite), Name, rechts Wert/Kosten. */
function Row({ icon, name, right }: { icon: ReactNode; name: ReactNode; right: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: 'center', gap: 10, padding: '5px 0' }}>
      <div className="center" style={{ width: 34, flexShrink: 0 }}>{icon}</div>
      <span style={{ flex: 1, fontSize: 14 }}>{name}</span>
      <span className="row" style={{ alignItems: 'center', gap: 5 }}>{right}</span>
    </div>
  );
}

/** Siegpunkt-Wert als Gold-Badge. */
function VP({ n }: { n: string }) {
  return <b style={{ color: 'var(--gold)', fontVariantNumeric: 'tabular-nums' }}>{n}</b>;
}

/** Kosten als Farbchips (nur Nicht-Null), Muster wie im Bau-Tooltip (CostPop). */
function Cost({ cost }: { cost: Partial<ResourceCounts> }) {
  return (
    <>
      {RESOURCE_ORDER.filter((r) => (cost[r] ?? 0) > 0).map((r) => (
        <ResChip key={r} res={r} count={cost[r]} />
      ))}
    </>
  );
}

const ICON_SIZE = 22;
const iconStyle = { color: 'var(--gold)' };

export function InfoBasics() {
  return (
    <>
      <section className="info-sec">
        <h3>Siegpunkte — so gewinnst du</h3>
        <p className="muted">Als Erster das Ziel erreichen (Standard 10, in der Lobby einstellbar: 8 / 10 / 12).</p>
        <Row icon={HOUSE} name="Siedlung" right={<VP n="+1" />} />
        <Row icon={CITY} name="Stadt" right={<VP n="+2" />} />
        <Row icon={<Route size={ICON_SIZE} style={iconStyle} />} name="Längste Straße (ab 5 am Stück)" right={<VP n="+2" />} />
        <Row icon={<Swords size={ICON_SIZE} style={iconStyle} />} name="Größte Rittermacht (ab 3 Rittern)" right={<VP n="+2" />} />
        <Row icon={<ScrollText size={ICON_SIZE} style={iconStyle} />} name="Siegpunkt-Karte" right={<VP n="+1" />} />
      </section>

      <section className="info-sec">
        <h3>Bauen — was kostet was?</h3>
        {/* Rohstoff-Legende: welche Farbe ist welcher Rohstoff */}
        <div className="row" style={{ flexWrap: 'wrap', gap: 12, margin: '2px 0 8px' }}>
          {RESOURCE_ORDER.map((r: ResourceType) => (
            <span key={r} className="row" style={{ alignItems: 'center', gap: 5 }}>
              <ResChip res={r} />
              <span className="muted" style={{ fontSize: 12.5 }}>{resLabel(r)}</span>
            </span>
          ))}
        </div>
        <Row icon={ROAD} name="Straße" right={<Cost cost={COSTS.road} />} />
        <Row icon={HOUSE} name="Siedlung" right={<Cost cost={COSTS.settlement} />} />
        <Row icon={CITY} name={<>Stadt <span className="muted" style={{ fontSize: 12.5 }}>(ersetzt eine Siedlung)</span></>} right={<Cost cost={COSTS.city} />} />
        <Row icon={<ScrollText size={ICON_SIZE} style={iconStyle} />} name="Entwicklungskarte" right={<Cost cost={COSTS.devCard} />} />
      </section>
    </>
  );
}

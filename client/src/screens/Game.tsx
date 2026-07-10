import { useCallback, useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import { Board } from '../components/board/Board';
import { PanZoom } from '../components/board/PanZoom';
import { PlayerRail } from '../components/game/PlayerRail';
import { Hand } from '../components/game/Hand';
import { ActionBar, type BuildIntent } from '../components/game/ActionBar';
import { Dice } from '../components/game/Dice';
import { DiscardDialog } from '../components/game/DiscardDialog';
import { TradeDialog } from '../components/game/TradeDialog';
import { TradeOfferPanel } from '../components/game/TradeOfferPanel';
import { DevPlayDialog } from '../components/game/DevPlayDialog';
import { WinnerOverlay } from '../components/game/WinnerOverlay';
import { BankPanel } from '../components/game/BankPanel';
import { FlyingCards } from '../components/game/FlyingCards';
import { BuildPopups } from '../components/game/BuildPopups';
import { LongestRoadBanner } from '../components/game/LongestRoadBanner';
import { EventLog } from '../components/game/EventLog';
import { ChatPanel } from '../components/ChatPanel';
import { makeColorOf, phaseLabel } from '../components/game/ui';
import { validSettlementCorners, validRoadEdges, type GameState, type DevCardType } from '@catan/shared';
import { MessageCircle, X, LogOut, Users, Landmark } from '../icons';
import '../components/game/game.css';

export function Game() {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const act = useStore((s) => s.act);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const [buildIntent, setBuildIntent] = useState<BuildIntent>(null);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [devPrompt, setDevPrompt] = useState<'yearOfPlenty' | 'monopoly' | null>(null);
  const [showChat, setShowChat] = useState(false);
  // Mobil: Spieler-/Bank-Panel als ausklappbares Bottom-Sheet (statt Dauer-Overlay).
  // Nur eins gleichzeitig offen; auf Desktop per CSS unwirksam (Chips ausgeblendet).
  const [mobileSheet, setMobileSheet] = useState<'players' | 'bank' | null>(null);

  const colorOf = useMemo(() => makeColorOf(game), [game?.players.map((p) => p.colorIndex).join()]);

  // Stabile Board-Referenz: die Geometrie (Terrain/Häfen/Ecken/Kanten) ändert sich
  // während eines Spiels nie. So rekonziliert der StaticLayer nicht bei jeder gameState-Nachricht.
  const board = useMemo(
    () => game?.board,
    [game?.board.width, game?.board.height, game?.board.hexes.length, game?.board.ports.length],
  );

  // Highlights je nach Phase/Absicht — memoisiert, damit sie nur bei State-/Absichts-Wechsel
  // neu berechnet werden (nicht bei reinen UI-Toggles wie Chat) und stabile Array-Refs liefern.
  const highlights = useMemo(() => {
    const h = { corners: [] as number[], edges: [] as number[], hexes: [] as number[] };
    if (!game || !me || game.activePlayer !== me) return h;
    const gs = game as unknown as GameState;
    if (game.phase === 'setupSettlement') h.corners = validSettlementCorners(gs, me, true);
    else if (game.phase === 'setupRoad') h.edges = validRoadEdges(gs, me, game.setupLastSettlement);
    else if (game.phase === 'moveRobber') h.hexes = game.board.hexes.filter((hx) => hx.terrain !== 'W' && hx.id !== game.robberHex).map((hx) => hx.id);
    else if (game.phase === 'roadBuilding') h.edges = validRoadEdges(gs, me, null);
    else if (game.phase === 'main') {
      if (buildIntent === 'road') h.edges = validRoadEdges(gs, me, null);
      else if (buildIntent === 'settlement') h.corners = validSettlementCorners(gs, me, false);
      else if (buildIntent === 'city')
        h.corners = Object.keys(game.buildings)
          .map(Number)
          .filter((cid) => game.buildings[cid].owner === me && game.buildings[cid].type === 'settlement');
    }
    return h;
  }, [game, me, buildIntent]);

  const onCorner = useCallback((id: number) => {
    if (!game) return;
    if (game.phase === 'setupSettlement') act({ type: 'placeSetupSettlement', corner: id });
    else if (game.phase === 'main' && buildIntent === 'settlement') { act({ type: 'buildSettlement', corner: id }); setBuildIntent(null); }
    else if (game.phase === 'main' && buildIntent === 'city') { act({ type: 'buildCity', corner: id }); setBuildIntent(null); }
  }, [game, buildIntent, act]);
  const onEdge = useCallback((id: number) => {
    if (!game) return;
    if (game.phase === 'setupRoad') act({ type: 'placeSetupRoad', edge: id });
    else if (game.phase === 'roadBuilding') act({ type: 'buildRoad', edge: id });
    else if (game.phase === 'main' && buildIntent === 'road') { act({ type: 'buildRoad', edge: id }); setBuildIntent(null); }
  }, [game, buildIntent, act]);
  const onHex = useCallback((id: number) => {
    if (game?.phase === 'moveRobber') act({ type: 'moveRobber', hex: id });
  }, [game, act]);

  // Bau-Modus zurücksetzen, wenn nicht mehr mein Zug / andere Phase
  useEffect(() => {
    if (!game) return;
    if (game.activePlayer !== me || game.phase !== 'main') setBuildIntent(null);
  }, [game?.activePlayer, game?.phase, me]);

  if (!game || !me || !board) return null;
  const yourTurn = game.activePlayer === me;

  const onPlayDev = (card: DevCardType) => {
    if (card === 'knight') act({ type: 'playKnight' });
    else if (card === 'roadBuilding') act({ type: 'playRoadBuilding' });
    else if (card === 'yearOfPlenty') setDevPrompt('yearOfPlenty');
    else if (card === 'monopoly') setDevPrompt('monopoly');
  };

  const activeName = game.players.find((p) => p.id === game.activePlayer)?.name ?? '';
  const activeDisconnected = game.players.find((p) => p.id === game.activePlayer && !p.connected && !p.isBot);
  const waitingPause = !!activeDisconnected && (game.phase !== 'discard');

  return (
    <div className="game" data-sheet={mobileSheet ?? undefined}>
      <div className="game-header">
        <div className="row gap-3">
          <span className={`phase-pill ${yourTurn ? 'mine' : ''}`}>{phaseLabel(game, me)}</span>
        </div>
        <div className="row gap-2">
          <span className="muted turn-meta" style={{ fontSize: 13 }}>Zug {game.turnCount} · {activeName}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowChat((v) => !v)}><MessageCircle size={15} /> Chat</button>
          <button className="btn btn-red btn-sm" onClick={leaveRoom}><LogOut size={15} /> Verlassen</button>
        </div>
      </div>

      <div className="game-main">
        {/* Mobile-Steuerleiste: Spieler/Bank ein-/ausklappen (auf Desktop ausgeblendet) */}
        <div className="mobile-bar">
          <button
            type="button"
            className={`m-chip ${mobileSheet === 'players' ? 'active' : ''}`}
            aria-pressed={mobileSheet === 'players'}
            onClick={() => setMobileSheet((s) => (s === 'players' ? null : 'players'))}
          >
            <Users size={16} /> Spieler <span className="m-chip-n">{game.players.length}</span>
          </button>
          <button
            type="button"
            className={`m-chip ${mobileSheet === 'bank' ? 'active' : ''}`}
            aria-pressed={mobileSheet === 'bank'}
            onClick={() => setMobileSheet((s) => (s === 'bank' ? null : 'bank'))}
          >
            <Landmark size={16} /> Bank
          </button>
        </div>

        <div className="board-wrap">
          <PanZoom>
            <Board
              board={board}
              buildings={game.buildings}
              roads={game.roads}
              robberHex={game.robberHex}
              colorOf={colorOf}
              highlightCorners={highlights.corners}
              highlightEdges={highlights.edges}
              highlightHexes={highlights.hexes}
              onCorner={onCorner}
              onEdge={onEdge}
              onHex={onHex}
            />
          </PanZoom>
        </div>

        <PlayerRail />
        <BankPanel />
        <div className="bottom-left">
          <Dice />
          <EventLog />
        </div>
        <TradeOfferPanel />

        {waitingPause && (
          <div className="pause-badge">
            <div className="spinner" style={{ width: 20, height: 20 }} />
            Warte auf {activeName}… (Reconnect möglich)
          </div>
        )}

        {/* Mobil: abdunkelnder Hintergrund schließt das offene Sheet (auf Desktop per CSS aus) */}
        {mobileSheet && <div className="sheet-scrim" onClick={() => setMobileSheet(null)} />}

        {showChat && (
          <div className="chat-drawer panel">
            <div className="row" style={{ justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <b>Chat</b>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowChat(false)}><X size={16} /></button>
            </div>
            <ChatPanel />
          </div>
        )}
      </div>

      <div className="game-footer">
        <Hand onPlayDev={onPlayDev} />
        <ActionBar buildIntent={buildIntent} setBuildIntent={setBuildIntent} onTrade={() => setTradeOpen(true)} />
      </div>

      <DiscardDialog />
      {tradeOpen && <TradeDialog onClose={() => setTradeOpen(false)} />}
      {devPrompt && <DevPlayDialog mode={devPrompt} onClose={() => setDevPrompt(null)} />}
      <WinnerOverlay />
      <FlyingCards />
      <BuildPopups />
      <LongestRoadBanner />
    </div>
  );
}

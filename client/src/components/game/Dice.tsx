import { useStore } from '../../store';

const PIP_POS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

function Die({ n }: { n: number }) {
  return (
    <div
      className="die"
      key={n}
      style={{ animation: 'spinDie 0.35s ease' }}
    >
      <svg viewBox="0 0 100 100" width="100%" height="100%">
        <rect x="4" y="4" width="92" height="92" rx="18" fill="#F8F2DE" stroke="rgba(90,74,48,.3)" strokeWidth="2" />
        {(PIP_POS[n] ?? []).map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="9" fill="#1F5C3A" />
        ))}
      </svg>
    </div>
  );
}

export function Dice() {
  const dice = useStore((s) => s.game?.dice);
  const nonce = useStore((s) => s.diceNonce);
  if (!dice) return null;
  return (
    <div className="dice" key={nonce}>
      <Die n={dice[0]} />
      <Die n={dice[1]} />
      <div className="dice-sum num">{dice[0] + dice[1]}</div>
    </div>
  );
}

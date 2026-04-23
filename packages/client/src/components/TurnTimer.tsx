import { useEffect, useState } from 'react';

interface TurnTimerProps {
  turnStartTime: number | null;
  timeoutMs?: number;
  isMyTurn: boolean;
}

const TURN_TIMEOUT_MS = 30_000;

function TurnTimer({ turnStartTime, timeoutMs = TURN_TIMEOUT_MS, isMyTurn }: TurnTimerProps) {
  const [remaining, setRemaining] = useState(timeoutMs);

  useEffect(() => {
    if (!turnStartTime) {
      setRemaining(timeoutMs);
      return;
    }

    const update = () => {
      const elapsed = Date.now() - turnStartTime;
      const left = Math.max(0, timeoutMs - elapsed);
      setRemaining(left);
    };

    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [turnStartTime, timeoutMs]);

  if (!turnStartTime) return null;

  const seconds = Math.ceil(remaining / 1000);
  const fraction = remaining / timeoutMs;
  const isLow = seconds <= 10;
  const isCritical = seconds <= 5;

  const barColor = isCritical
    ? 'bg-red-500'
    : isLow
      ? 'bg-yellow-500'
      : 'bg-green-500';

  const textColor = isCritical
    ? 'text-red-400'
    : isLow
      ? 'text-yellow-400'
      : 'text-green-400';

  return (
    <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
      {/* Timer bar */}
      <div className="w-12 sm:w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden shrink-0">
        <div
          className={`h-full ${barColor} transition-all duration-250 rounded-full`}
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <span className={`text-[10px] sm:text-xs font-mono font-bold shrink-0 ${textColor} ${isCritical && isMyTurn ? 'animate-pulse' : ''}`}>
        {seconds}s
      </span>
    </div>
  );
}

export default TurnTimer;

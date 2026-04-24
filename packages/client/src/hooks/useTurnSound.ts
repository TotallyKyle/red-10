import { useEffect, useRef } from 'react';

/**
 * Plays a short ding when isMyTurn flips false → true. Silent on the initial
 * value so we don't beep on page load or on a reconnect into your own turn.
 */
export function useTurnSound(isMyTurn: boolean | undefined): void {
  const prev = useRef<boolean | undefined>(undefined);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const wasMyTurn = prev.current;
    prev.current = isMyTurn;
    if (wasMyTurn !== false || isMyTurn !== true) return;

    try {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        ctxRef.current = new Ctx();
      }
      const ctx = ctxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.26);
    } catch {
      // Audio not available (autoplay policy, no device, etc.) — fail silent.
    }
  }, [isMyTurn]);
}

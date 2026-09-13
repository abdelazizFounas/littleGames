import { useEffect, useRef, useState } from 'react';
/** Small synthesized cues; no external assets and no sound before a player gesture. */
export function useArtilleryAudio() {
  const context = useRef<AudioContext | null>(null);
  const [enabled,setEnabled] = useState(() => { try { return localStorage.getItem('littlegames.artillery.sound') === 'on'; } catch { return false; } });
  useEffect(() => () => { void context.current?.close().catch(() => undefined); },[]);
  function activate() {
    if (!enabled || typeof AudioContext === 'undefined') return;
    context.current ??= new AudioContext();
    void context.current.resume().catch(() => undefined);
  }
  function toggle() {
    const next = !enabled;setEnabled(next);
    try { localStorage.setItem('littlegames.artillery.sound',next?'on':'off'); } catch { /* Keep the current preference in memory. */ }
    if (next && typeof AudioContext !== 'undefined') { context.current ??= new AudioContext();void context.current.resume().catch(() => undefined); }
  }
  function play(impact: boolean) {
    const audio = context.current;
    if (!enabled || !audio || audio.state !== 'running') return;
    const oscillator = audio.createOscillator(),gain = audio.createGain();
    const now = audio.currentTime;
    oscillator.type = impact ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(impact?105:650,now);
    oscillator.frequency.exponentialRampToValueAtTime(impact?25:100,now+.35);
    gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(impact?.14:.08,now+.015);gain.gain.exponentialRampToValueAtTime(.001,now+.4);
    oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(now);oscillator.stop(now+.42);
    oscillator.addEventListener('ended',()=>{oscillator.disconnect();gain.disconnect();},{once:true});
  }
  return {enabled,toggle,activate,play};
}

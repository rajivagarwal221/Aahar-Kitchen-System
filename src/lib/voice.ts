// Speech for the cook-along: the browser reads steps aloud and listens for
// three spoken commands. Uses the Web Speech API that ships with the browser,
// so there is no service to pay for and no audio leaves through AHAAR.

import { useCallback, useEffect, useRef, useState } from 'react';

export type VoiceCommand = 'stop' | 'repeat' | 'continue';

type RecognitionResult = { isFinal: boolean; 0: { transcript: string } };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function recognitionCtor(): (new () => Recognition) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => Recognition) | null;
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
export const canListen = () => typeof window !== 'undefined' && recognitionCtor() !== null;

const WORDS: [VoiceCommand, RegExp][] = [
  ['stop', /\b(stop|pause|wait|ruko)\b/],
  ['repeat', /\b(repeat|again|say that again|dobara)\b/],
  ['continue', /\b(continue|next|resume|go on|aage)\b/],
];

/** A command only counts when it is said more or less on its own. */
export function parseCommand(transcript: string, maxWords: number): VoiceCommand | null {
  const t = transcript.toLowerCase().replace(/[^a-z\s]/g, ' ').trim();
  if (!t || t.split(/\s+/).length > maxWords) return null;
  for (const [cmd, re] of WORDS) if (re.test(t)) return cmd;
  return null;
}

export type MicState = 'off' | 'listening' | 'blocked' | 'unsupported';

/**
 * speak(text, onDone) reads text aloud; hush() cuts it off.
 * While `listening` is true the microphone stays open and onCommand fires
 * for "stop", "repeat" and "continue".
 */
export function useVoice(listening: boolean, onCommand: (c: VoiceCommand) => void) {
  const [speaking, setSpeaking] = useState(false);
  const [mic, setMic] = useState<MicState>('off');
  const [heard, setHeard] = useState('');
  const speakingRef = useRef(false);
  const handler = useRef(onCommand);
  handler.current = onCommand;

  const hush = useCallback(() => {
    if (canSpeak()) window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string, onDone?: () => void) => {
    if (!canSpeak()) {
      onDone?.();
      return;
    }
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find((v) => v.lang === 'en-IN') ?? voices.find((v) => v.lang.startsWith('en'));
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-IN';
    u.rate = 0.95;
    u.onstart = () => { speakingRef.current = true; setSpeaking(true); };
    // cancel() fires onerror('interrupted'), not onend: only a finished reading calls onDone.
    u.onend = () => { speakingRef.current = false; setSpeaking(false); onDone?.(); };
    u.onerror = () => { speakingRef.current = false; setSpeaking(false); };
    window.speechSynthesis.speak(u);
  }, []);

  useEffect(() => {
    if (!listening) {
      setMic('off');
      return;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setMic('unsupported');
      return;
    }
    let alive = true;
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) continue;
        const said = r[0].transcript.trim();
        // The microphone also hears the app reading a step. A lone word is the
        // cook; a long sentence while we are talking is our own voice.
        const cmd = parseCommand(said, speakingRef.current ? 2 : 4);
        if (cmd) {
          setHeard(said);
          handler.current(cmd);
        }
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        alive = false;
        setMic('blocked');
      }
    };
    // Chrome ends recognition after a stretch of silence; reopen it while the guide is on.
    rec.onend = () => {
      if (!alive) return;
      try { rec.start(); } catch { /* already starting */ }
    };
    try {
      rec.start();
      setMic('listening');
    } catch {
      setMic('blocked');
    }
    return () => {
      alive = false;
      rec.onend = null;
      rec.abort();
    };
  }, [listening]);

  useEffect(() => hush, [hush]);

  return { speak, hush, speaking, mic, heard };
}

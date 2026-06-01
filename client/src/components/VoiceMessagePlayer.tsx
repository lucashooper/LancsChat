import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Play, Pause } from 'lucide-react';
import './VoiceMessagePlayer.css';

interface VoiceMessagePlayerProps {
  src: string;
  duration?: number | null;
  isOwn?: boolean;
}

function formatDuration(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export default function VoiceMessagePlayer({ src, duration, isOwn }: VoiceMessagePlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const tickRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const getClipDuration = (audio: HTMLAudioElement) => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) {
      return audio.duration;
    }
    return duration && duration > 0 ? duration : 1;
  };

  const stopTick = () => {
    if (tickRef.current) {
      cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    }
  };

  const startTick = (audio: HTMLAudioElement) => {
    stopTick();
    const step = () => {
      if (!playingRef.current) return;
      const dur = getClipDuration(audio);
      setCurrentTime(audio.currentTime);
      setProgress(Math.min(100, (audio.currentTime / dur) * 100));
      if (!audio.paused && !audio.ended) {
        tickRef.current = requestAnimationFrame(step);
      } else if (audio.ended) {
        setProgress(100);
        setCurrentTime(dur);
      }
    };
    tickRef.current = requestAnimationFrame(step);
  };

  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;

    const onEnded = () => {
      playingRef.current = false;
      setPlaying(false);
      setProgress(0);
      setCurrentTime(0);
      stopTick();
    };

    audio.addEventListener('ended', onEnded);

    return () => {
      stopTick();
      audio.pause();
      audio.removeEventListener('ended', onEnded);
      audioRef.current = null;
    };
  }, [src]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      playingRef.current = false;
      setPlaying(false);
      stopTick();
    } else {
      if (audio.ended || audio.currentTime >= getClipDuration(audio)) {
        audio.currentTime = 0;
        setProgress(0);
        setCurrentTime(0);
      }
      void audio.play();
      playingRef.current = true;
      setPlaying(true);
      startTick(audio);
    }
  };

  const clipDuration = duration && duration > 0 ? duration : 0;
  const displayTime =
    playing || currentTime > 0 ? formatDuration(currentTime) : formatDuration(clipDuration);

  return (
    <div className={`voicePlayer ${isOwn ? 'isOwn' : ''}`}>
      <div
        className="voicePlayerPill"
        style={{ '--voice-progress': progress } as CSSProperties}
      >
        <div className="voicePlayerFill" aria-hidden />
        <div className="voicePlayerContent">
          <button
            type="button"
            className="voicePlayBtn"
            onClick={togglePlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <span className="voiceDuration">{displayTime}</span>
        </div>
      </div>
    </div>
  );
}

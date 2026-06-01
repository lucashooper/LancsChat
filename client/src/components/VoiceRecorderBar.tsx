import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X, Send, Play, Pause, Square } from 'lucide-react';
import { MAX_VOICE_DURATION_SECONDS } from '../lib/voiceMessage';
import './VoiceRecorderBar.css';

interface VoiceRecorderBarProps {
  onSend: (blob: Blob, durationSeconds: number) => void;
  onCancel: () => void;
  uploading?: boolean;
}

type Phase = 'recording' | 'paused' | 'playing';

function formatTime(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

export default function VoiceRecorderBar({ onSend, onCancel, uploading }: VoiceRecorderBarProps) {
  const [phase, setPhase] = useState<Phase>('recording');
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);

  const phaseRef = useRef<Phase>('recording');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const frozenSecondsRef = useRef(0);
  const tickRef = useRef<number | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const setPhaseSafe = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const cleanupPreview = () => {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const stopTick = () => {
    if (tickRef.current) {
      cancelAnimationFrame(tickRef.current);
      tickRef.current = null;
    }
  };

  const buildBlob = () => {
    const recorder = mediaRecorderRef.current;
    const type = recorder?.mimeType || 'audio/webm';
    return new Blob(chunksRef.current, { type });
  };

  const updateRecordingProgress = () => {
    const seconds = Math.min(
      MAX_VOICE_DURATION_SECONDS,
      (Date.now() - startedAtRef.current) / 1000
    );
    setElapsed(seconds);
    setProgress(Math.min(100, (seconds / MAX_VOICE_DURATION_SECONDS) * 100));
    return seconds;
  };

  const startRecordingTick = () => {
    stopTick();
    const step = () => {
      if (phaseRef.current !== 'recording') return;
      const seconds = updateRecordingProgress();
      if (seconds >= MAX_VOICE_DURATION_SECONDS) {
        pauseRecording();
        return;
      }
      tickRef.current = requestAnimationFrame(step);
    };
    tickRef.current = requestAnimationFrame(step);
  };

  const startPlaybackTick = (audio: HTMLAudioElement, clipDuration: number) => {
    stopTick();
    const step = () => {
      if (phaseRef.current !== 'playing') return;
      const dur =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : clipDuration || frozenSecondsRef.current || 1;
      setElapsed(audio.currentTime);
      setProgress(Math.min(100, (audio.currentTime / dur) * 100));
      if (!audio.paused && !audio.ended) {
        tickRef.current = requestAnimationFrame(step);
      } else if (audio.ended) {
        setPhaseSafe('paused');
        setElapsed(dur);
        setProgress(100);
      }
    };
    tickRef.current = requestAnimationFrame(step);
  };

  const pauseRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    recorder.pause();
    frozenSecondsRef.current = updateRecordingProgress();
    setElapsed(frozenSecondsRef.current);
    setProgress(Math.min(100, (frozenSecondsRef.current / MAX_VOICE_DURATION_SECONDS) * 100));
    setPhaseSafe('paused');
    stopTick();
  };

  const playPreview = () => {
    cleanupPreview();
    const blob = buildBlob();
    if (blob.size === 0) return;

    const url = URL.createObjectURL(blob);
    previewUrlRef.current = url;
    const audio = new Audio(url);
    previewAudioRef.current = audio;

    const clipDuration = frozenSecondsRef.current || 1;

    audio.onloadedmetadata = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        frozenSecondsRef.current = audio.duration;
      }
    };

    audio.onended = () => {
      setPhaseSafe('paused');
      setElapsed(frozenSecondsRef.current);
      setProgress(100);
      stopTick();
    };

    setElapsed(0);
    setProgress(0);
    void audio.play();
    setPhaseSafe('playing');
    startPlaybackTick(audio, clipDuration);
  };

  const pausePreview = () => {
    previewAudioRef.current?.pause();
    setPhaseSafe('paused');
    stopTick();
  };

  const handleMainAction = () => {
    if (phaseRef.current === 'recording') {
      pauseRecording();
    } else if (phaseRef.current === 'paused') {
      playPreview();
    } else {
      pausePreview();
    }
  };

  const handleCancel = () => {
    stopTick();
    cleanupPreview();
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    stopStream();
    onCancel();
  };

  const handleSend = () => {
    const duration = Math.max(frozenSecondsRef.current, elapsed);
    if (duration < 0.5) return;

    stopTick();
    cleanupPreview();

    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') {
      const blob = buildBlob();
      if (blob.size > 0) onSend(blob, Math.round(duration * 10) / 10);
      return;
    }

    recorder.onstop = () => {
      stopStream();
      const blob = buildBlob();
      if (blob.size > 0) onSend(blob, Math.round(duration * 10) / 10);
    };
    if (recorder.state === 'paused') recorder.resume();
    recorder.stop();
  };

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream);
        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.start(100);
        mediaRecorderRef.current = recorder;
        startedAtRef.current = Date.now();
        setPhaseSafe('recording');
        startRecordingTick();
      } catch {
        onCancel();
      }
    })();

    return () => {
      cancelled = true;
      stopTick();
      cleanupPreview();
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.onstop = null;
        recorder.stop();
      }
      stopStream();
    };
  }, [onCancel]);

  const mainIcon =
    phase === 'recording' ? (
      <Square size={14} fill="currentColor" />
    ) : phase === 'playing' ? (
      <Pause size={16} fill="currentColor" />
    ) : (
      <Play size={16} fill="currentColor" />
    );

  const mainLabel =
    phase === 'recording'
      ? 'Stop recording'
      : phase === 'playing'
        ? 'Pause playback'
        : 'Play recording';

  return (
    <div className="voiceComposer">
      <button
        type="button"
        className="voiceCancelBtn"
        onClick={handleCancel}
        title="Cancel"
        aria-label="Cancel recording"
        disabled={uploading}
      >
        <X size={22} />
      </button>
      <div
        className="voiceRecordBar"
        style={{ '--voice-progress': progress } as CSSProperties}
      >
        <div className="voiceRecordBarFill" aria-hidden />
        <div className="voiceRecordBarContent">
          <button
            type="button"
            className="voiceMainBtn"
            onClick={handleMainAction}
            title={mainLabel}
            aria-label={mainLabel}
            disabled={uploading}
          >
            {mainIcon}
          </button>
          <span className="voiceTimer">{formatTime(elapsed)}</span>
        </div>
      </div>
      <button
        type="button"
        className="voiceSendBtn"
        onClick={handleSend}
        disabled={uploading || elapsed < 0.5}
        title="Send voice message"
        aria-label="Send voice message"
      >
        <Send size={20} />
      </button>
    </div>
  );
}

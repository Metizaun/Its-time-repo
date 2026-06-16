import { useCallback, useEffect, useRef, useState } from "react";

const AUDIO_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
] as const;

const LIVE_WAVEFORM_BARS = [
  8, 12, 6, 16, 10, 18, 7, 13, 9, 20, 11, 15, 6, 12, 8, 17, 10, 14, 7, 19, 11, 16, 8, 13,
  6, 18, 12, 15, 9, 20, 10, 14,
];
const LIVE_WAVEFORM_BAR_COUNT = LIVE_WAVEFORM_BARS.length;
const LIVE_WAVEFORM_MIN_HEIGHT = 6;
const LIVE_WAVEFORM_MAX_HEIGHT = 24;
const LIVE_WAVEFORM_UPDATE_MS = 80;

export type AudioRecorderStatus = "idle" | "recording" | "recorded" | "error";

export interface AudioRecording {
  blob: Blob;
  file: File;
  fileName: string;
  mimeType: string;
  url: string;
}

function getSupportedAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return AUDIO_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? "";
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function buildAudioFileName() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `audio-${timestamp}.webm`;
}

function getAudioContextConstructor() {
  return window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
}

function buildLiveWaveformBars(data: Uint8Array) {
  const samplesPerBar = Math.max(1, Math.floor(data.length / LIVE_WAVEFORM_BAR_COUNT));

  return Array.from({ length: LIVE_WAVEFORM_BAR_COUNT }, (_, index) => {
    const start = index * samplesPerBar;
    const end = Math.min(data.length, start + samplesPerBar);
    let sum = 0;
    let count = 0;

    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const normalizedSample = (data[sampleIndex] - 128) / 128;
      sum += normalizedSample * normalizedSample;
      count += 1;
    }

    const rms = count > 0 ? Math.sqrt(sum / count) : 0;
    const amplitude = Math.min(1, rms * 12);

    return Math.round(LIVE_WAVEFORM_MIN_HEIGHT + amplitude * (LIVE_WAVEFORM_MAX_HEIGHT - LIVE_WAVEFORM_MIN_HEIGHT));
  });
}

export function useAudioRecorder() {
  const [status, setStatus] = useState<AudioRecorderStatus>("idle");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<AudioRecording | null>(null);
  const [liveWaveformBars, setLiveWaveformBars] = useState(LIVE_WAVEFORM_BARS);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const cancelRequestedRef = useRef(false);
  const recordingUrlRef = useRef<string | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioAnalyserRef = useRef<AnalyserNode | null>(null);
  const visualizerFrameRef = useRef<number | null>(null);
  const visualizerLastUpdateRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopLiveVisualizer = useCallback((resetBars = true) => {
    if (visualizerFrameRef.current) {
      window.cancelAnimationFrame(visualizerFrameRef.current);
      visualizerFrameRef.current = null;
    }

    audioSourceRef.current?.disconnect();
    audioAnalyserRef.current?.disconnect();

    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }

    audioContextRef.current = null;
    audioSourceRef.current = null;
    audioAnalyserRef.current = null;
    visualizerLastUpdateRef.current = 0;

    if (resetBars) {
      setLiveWaveformBars(LIVE_WAVEFORM_BARS);
    }
  }, []);

  const startLiveVisualizer = useCallback((stream: MediaStream) => {
    stopLiveVisualizer();

    const AudioContextConstructor = getAudioContextConstructor();
    if (!AudioContextConstructor) {
      return;
    }

    try {
      const audioContext = new AudioContextConstructor();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);

      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);

      audioContextRef.current = audioContext;
      audioSourceRef.current = source;
      audioAnalyserRef.current = analyser;

      const tick = (timestamp: number) => {
        visualizerFrameRef.current = window.requestAnimationFrame(tick);

        if (timestamp - visualizerLastUpdateRef.current < LIVE_WAVEFORM_UPDATE_MS) {
          return;
        }

        visualizerLastUpdateRef.current = timestamp;
        analyser.getByteTimeDomainData(data);
        setLiveWaveformBars(buildLiveWaveformBars(data));
      };

      visualizerFrameRef.current = window.requestAnimationFrame(tick);
    } catch {
      stopLiveVisualizer();
    }
  }, [stopLiveVisualizer]);

  const revokeRecordingUrl = useCallback(() => {
    if (recordingUrlRef.current) {
      URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    }
  }, []);

  const clearRecording = useCallback(() => {
    stopLiveVisualizer();
    revokeRecordingUrl();
    setRecording(null);
    setStatus("idle");
    setError(null);
    setElapsedSeconds(0);
  }, [revokeRecordingUrl, stopLiveVisualizer]);

  const cancelRecording = useCallback(() => {
    cancelRequestedRef.current = true;
    clearTimer();

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }

    stopStream(streamRef.current);
    streamRef.current = null;
    chunksRef.current = [];
    clearRecording();
  }, [clearRecording, clearTimer]);

  const startRecording = useCallback(async () => {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setError("Gravacao de audio indisponivel neste navegador.");
      return;
    }

    clearRecording();
    cancelRequestedRef.current = false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedMimeType = getSupportedAudioMimeType();
      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      startLiveVisualizer(stream);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        clearTimer();
        stopLiveVisualizer();
        stopStream(streamRef.current);
        streamRef.current = null;

        if (cancelRequestedRef.current) {
          chunksRef.current = [];
          return;
        }

        const mimeType = recorder.mimeType || supportedMimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];

        if (blob.size <= 0) {
          setStatus("error");
          setError("Nao foi possivel gerar o audio gravado.");
          return;
        }

        revokeRecordingUrl();
        const url = URL.createObjectURL(blob);
        recordingUrlRef.current = url;
        const fileName = buildAudioFileName();
        const file = new File([blob], fileName, { type: mimeType });

        setRecording({ blob, file, fileName, mimeType, url });
        setStatus("recorded");
      };

      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      setStatus("recording");
      recorder.start();

      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } catch (caughtError) {
      const message =
        caughtError instanceof DOMException && caughtError.name === "NotAllowedError"
          ? "Permissao de microfone negada."
          : "Nao foi possivel iniciar a gravacao.";
      setStatus("error");
      setError(message);
      stopLiveVisualizer();
      stopStream(streamRef.current);
      streamRef.current = null;
    }
  }, [clearRecording, clearTimer, revokeRecordingUrl, startLiveVisualizer, stopLiveVisualizer]);

  const stopRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state === "inactive") {
      return;
    }

    cancelRequestedRef.current = false;
    recorderRef.current.stop();
  }, []);

  useEffect(() => {
    return () => {
      cancelRequestedRef.current = true;
      clearTimer();

      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }

      stopStream(streamRef.current);
      stopLiveVisualizer(false);
      revokeRecordingUrl();
    };
  }, [clearTimer, revokeRecordingUrl, stopLiveVisualizer]);

  return {
    status,
    elapsedSeconds,
    error,
    recording,
    liveWaveformBars,
    isSupported: typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia),
    startRecording,
    stopRecording,
    cancelRecording,
    clearRecording,
  };
}

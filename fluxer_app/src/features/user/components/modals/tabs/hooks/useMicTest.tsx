// SPDX-License-Identifier: AGPL-3.0-or-later

import Keybind from '@app/features/input/state/InputKeybind';
import {handleMediaPermissionBlocked} from '@app/features/permissions/system/commands/MacPermissionsModalCommands';
import MediaPermission from '@app/features/permissions/system/state/MediaPermission';
import {ensureMacPermission} from '@app/features/permissions/system/utils/MacPermissionGate';
import {Logger} from '@app/features/platform/utils/AppLogger';
import {
	createMicTestAudioGraph,
	type MicTestAudioGraph,
} from '@app/features/user/components/modals/tabs/hooks/MicTestAudioGraph';
import {
	acquireIdleVoiceInputSource,
	type VoiceInputContextLease,
} from '@app/features/voice/engine/VoiceInputAudioContext';
import VoiceSettings from '@app/features/voice/state/VoiceSettings';
import {beginMicrophoneSession} from '@app/features/voice/utils/noise_suppression/DeepFilter';
import {formatNoiseSuppressionAdvancedSignature} from '@app/features/voice/utils/noise_suppression/NoiseSuppressionAdvancedSettings';
import NoiseSuppressionAvailability from '@app/features/voice/utils/noise_suppression/NoiseSuppressionAvailability';
import type {VoiceNoiseSuppressionBackend} from '@app/features/voice/utils/noise_suppression/NoiseSuppressionBackends';
import {readRequestedNoiseSuppressionBackend} from '@app/features/voice/utils/noise_suppression/NoiseSuppressionRuntime';
import {isVoiceActivityGateEnabled, resolveVoiceInputConfig} from '@app/features/voice/utils/VoiceInputProcessor';
import {
	applyContentHintToTrack,
	resolveVoiceProcessing,
	type VoiceProcessingMode,
} from '@app/features/voice/utils/VoiceProcessingProfile';
import {
	boostedVoiceVolumePercentToTrackVolume,
	inputVoiceVolumePercentToGain,
} from '@app/features/voice/utils/VoiceVolumeUtils';
import {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';

const logger = new Logger('useMicTest');

const MIC_TEST_MONITOR_DELAY_SECONDS = 0.9;

export interface MicTestSettings {
	inputDeviceId: string;
	outputDeviceId: string;
	inputVolume: number;
	outputVolume: number;
	echoCancellation: boolean;
	autoGainControl: boolean;
	voiceProcessingMode: VoiceProcessingMode;
	stereoMicrophone: boolean;
}

function readEffectiveNoiseSuppressionBackend(): VoiceNoiseSuppressionBackend {
	return NoiseSuppressionAvailability.resolveEffectiveBackend(readRequestedNoiseSuppressionBackend());
}

const METER_MIN_DB = -60;
const METER_MAX_DB = 0;

function rmsToMeterLevel(rms: number): number {
	const db = 20 * Math.log10(Math.max(rms, 1e-10));
	return Math.max(0, Math.min(1, (db - METER_MIN_DB) / (METER_MAX_DB - METER_MIN_DB)));
}

function normalizeOutputDeviceId(deviceId: string): string {
	return deviceId === 'default' ? '' : deviceId;
}

export const useMicTest = (settings: MicTestSettings) => {
	const [isTesting, setIsTesting] = useState(false);
	const [isStarting, setIsStarting] = useState(false);
	const [level, setLevel] = useState(0);
	const [peakLevel, setPeakLevel] = useState(0);
	const [gateMarker, setGateMarker] = useState<number | null>(null);
	const gateThresholdRmsRef = useRef<number | null>(null);
	const inputLeaseRef = useRef<VoiceInputContextLease | null>(null);
	const graphRef = useRef<MicTestAudioGraph | null>(null);
	const playbackDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
	const audioElementRef = useRef<HTMLAudioElement | null>(null);
	const micStreamRef = useRef<MediaStream | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const timeDomainDataRef = useRef<Float32Array<ArrayBuffer> | null>(null);
	const peakLevelRef = useRef(0);
	const isStartingRef = useRef(false);
	const attemptRef = useRef(0);
	const abortRef = useRef<AbortController | null>(null);
	const activeCaptureSignatureRef = useRef<string | null>(null);
	const micExplicitlyDenied = MediaPermission.microphoneExplicitlyDenied;
	const noiseSuppressionBackend = useSyncExternalStore(
		NoiseSuppressionAvailability.subscribe,
		readEffectiveNoiseSuppressionBackend,
	);
	const noiseSuppressionTuning = formatNoiseSuppressionAdvancedSignature(
		VoiceSettings.getNoiseSuppressionAdvancedSettings(),
	);
	const vadThreshold = VoiceSettings.getVadThreshold();
	const vadAutoSensitivity = VoiceSettings.getVadAutoSensitivity();
	const transmitMode = Keybind.transmitMode;
	const captureSignature = useMemo(
		() =>
			JSON.stringify({
				inputDeviceId: settings.inputDeviceId,
				outputDeviceId: settings.outputDeviceId,
				echoCancellation: settings.echoCancellation,
				autoGainControl: settings.autoGainControl,
				voiceProcessingMode: settings.voiceProcessingMode,
				stereoMicrophone: settings.stereoMicrophone,
				noiseSuppressionBackend,
				noiseSuppressionTuning,
			}),
		[
			settings.autoGainControl,
			settings.echoCancellation,
			settings.inputDeviceId,
			settings.outputDeviceId,
			settings.stereoMicrophone,
			settings.voiceProcessingMode,
			noiseSuppressionBackend,
			noiseSuppressionTuning,
		],
	);
	const updateLevel = useCallback(() => {
		if (!graphRef.current || !timeDomainDataRef.current) {
			animationFrameRef.current = requestAnimationFrame(updateLevel);
			return;
		}
		graphRef.current.analyser.getFloatTimeDomainData(timeDomainDataRef.current);
		let sumOfSquares = 0;
		for (let i = 0; i < timeDomainDataRef.current.length; i++) {
			const sample = timeDomainDataRef.current[i];
			sumOfSquares += sample * sample;
		}
		const rms = Math.sqrt(sumOfSquares / timeDomainDataRef.current.length);
		const normalized = rmsToMeterLevel(rms);
		const thresholdRms = gateThresholdRmsRef.current;
		setGateMarker(
			thresholdRms === null
				? null
				: Math.round(
						rmsToMeterLevel(thresholdRms * inputVoiceVolumePercentToGain(VoiceSettings.getInputVolume())) * 100,
					) / 100,
		);
		const nextPeak = Math.max(normalized, Math.max(0, peakLevelRef.current - 0.006));
		peakLevelRef.current = nextPeak;
		setLevel(normalized);
		setPeakLevel(nextPeak);
		animationFrameRef.current = requestAnimationFrame(updateLevel);
	}, []);
	const stop = useCallback(() => {
		attemptRef.current++;
		abortRef.current?.abort();
		abortRef.current = null;
		isStartingRef.current = false;
		setIsStarting(false);
		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}
		if (audioElementRef.current) {
			audioElementRef.current.pause();
			audioElementRef.current.srcObject = null;
			audioElementRef.current = null;
		}
		const graph = graphRef.current;
		graphRef.current = null;
		graph?.dispose();
		const playbackDestination = playbackDestinationRef.current;
		playbackDestinationRef.current = null;
		if (playbackDestination) {
			playbackDestination.disconnect();
			playbackDestination.stream.getTracks().forEach((track) => track.stop());
		}
		if (micStreamRef.current) {
			micStreamRef.current.getTracks().forEach((track) => track.stop());
			micStreamRef.current = null;
		}
		inputLeaseRef.current?.release();
		inputLeaseRef.current = null;
		timeDomainDataRef.current = null;
		peakLevelRef.current = 0;
		gateThresholdRmsRef.current = null;
		setGateMarker(null);
		setIsTesting(false);
		setLevel(0);
		setPeakLevel(0);
	}, []);
	const start = useCallback(async () => {
		if (isStartingRef.current) return;
		if (micExplicitlyDenied) {
			handleMediaPermissionBlocked('microphone');
			return;
		}
		stop();
		const attempt = ++attemptRef.current;
		const controller = new AbortController();
		abortRef.current = controller;
		const isCurrent = () => attempt === attemptRef.current && !controller.signal.aborted;
		isStartingRef.current = true;
		setIsStarting(true);
		try {
			beginMicrophoneSession(controller.signal);
			const nativeResult = await ensureMacPermission('microphone', {behavior: 'interactive'});
			if (!isCurrent()) return;
			switch (nativeResult) {
				case 'granted':
				case 'unsupported-platform':
					break;
				case 'denied':
				case 'declined':
					MediaPermission.markMicrophoneExplicitlyDenied();
					handleMediaPermissionBlocked('microphone');
					return;
				default: {
					const exhaustive: never = nativeResult;
					return exhaustive;
				}
			}
			const profile = resolveVoiceProcessing(
				settings,
				readEffectiveNoiseSuppressionBackend(),
				settings.stereoMicrophone,
			);
			const baseAudioConstraints: MediaTrackConstraints & {voiceIsolation?: boolean} = {
				echoCancellation: profile.echoCancellation,
				noiseSuppression: profile.browserNoiseSuppression,
				autoGainControl: profile.autoGainControl,
				voiceIsolation: false,
				...(profile.stereoCapture ? {channelCount: {ideal: 2}} : {}),
			};
			const useExactDeviceId = settings.inputDeviceId !== 'default';
			const buildAudioConstraints = (exact: boolean): MediaTrackConstraints =>
				useExactDeviceId
					? {
							...baseAudioConstraints,
							deviceId: exact ? {exact: settings.inputDeviceId} : {ideal: settings.inputDeviceId},
						}
					: baseAudioConstraints;
			let stream: MediaStream;
			try {
				stream = await navigator.mediaDevices.getUserMedia({audio: buildAudioConstraints(true)});
			} catch (error) {
				if (!isCurrent()) return;
				if (!useExactDeviceId || !(error instanceof Error) || error.name !== 'OverconstrainedError') {
					throw error;
				}
				stream = await navigator.mediaDevices.getUserMedia({audio: buildAudioConstraints(false)});
			}
			if (!isCurrent()) {
				stream.getTracks().forEach((track) => track.stop());
				return;
			}
			micStreamRef.current = stream;
			const sourceTrack = stream.getAudioTracks()[0];
			if (!sourceTrack) {
				throw new Error('getUserMedia returned no audio tracks for mic test');
			}
			applyContentHintToTrack(sourceTrack, profile.contentHint);
			const acquired = acquireIdleVoiceInputSource(sourceTrack);
			if (!acquired) {
				throw new Error('No AudioContext is available for the mic test');
			}
			inputLeaseRef.current = acquired.lease;
			const audioContext = acquired.lease.context;
			const outputSinkId = normalizeOutputDeviceId(settings.outputDeviceId);
			const playbackDestination = audioContext.createMediaStreamDestination();
			playbackDestinationRef.current = playbackDestination;
			let playbackTarget: AudioNode = playbackDestination;
			graphRef.current = createMicTestAudioGraph({
				signal: controller.signal,
				source: acquired.source,
				sourceTrack,
				channelCount: profile.stereoCapture ? 2 : 1,
				resolveConfig: resolveVoiceInputConfig,
				outputGain: boostedVoiceVolumePercentToTrackVolume(settings.outputVolume),
				playbackTarget,
				playbackDelaySeconds: MIC_TEST_MONITOR_DELAY_SECONDS,
				onLevel: (gateLevel) => {
					gateThresholdRmsRef.current = isVoiceActivityGateEnabled() ? gateLevel.thresholdRms : null;
				},
			});
			timeDomainDataRef.current = new Float32Array(graphRef.current.analyser.fftSize);
			const audioElement = new Audio();
			audioElementRef.current = audioElement;
			audioElement.autoplay = true;
			audioElement.muted = false;
			audioElement.volume = 1;
			audioElement.srcObject = playbackDestination.stream;
			if (settings.outputDeviceId !== 'default' && typeof audioElement.setSinkId === 'function') {
				try {
					await audioElement.setSinkId(outputSinkId);
				} catch (error) {
					logger.warn('Failed to set mic test media element output device', error);
				}
			}
			if (!isCurrent()) return;
			try {
				await audioElement.play();
			} catch (error) {
				if (!isCurrent()) return;
				logger.warn('Failed to start mic test media element playback; falling back to AudioContext destination', error);
				audioElement.pause();
				audioElement.srcObject = null;
				audioElementRef.current = null;
				playbackDestination.disconnect();
				playbackDestination.stream.getTracks().forEach((track) => track.stop());
				playbackDestinationRef.current = null;
				graphRef.current.softClipOutput.disconnect();
				playbackTarget = audioContext.destination;
				graphRef.current.softClipOutput.connect(playbackTarget);
				graphRef.current.playbackTarget = playbackTarget;
			}
			if (!isCurrent()) return;
			setIsTesting(true);
			activeCaptureSignatureRef.current = captureSignature;
			updateLevel();
			if (profile.deepFilter) {
				logger.info('Applied DeepFilterNet3 noise suppression for mic test');
			}
		} catch (error) {
			if (!isCurrent()) return;
			logger.error('Error starting mic test', error);
			if (error instanceof Error && (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError')) {
				MediaPermission.markMicrophoneExplicitlyDenied();
				handleMediaPermissionBlocked('microphone');
			}
			stop();
		} finally {
			if (isCurrent()) {
				isStartingRef.current = false;
				setIsStarting(false);
			}
		}
	}, [captureSignature, settings, updateLevel, stop, micExplicitlyDenied]);
	useEffect(() => {
		if (!isTesting) return;
		if (graphRef.current) {
			void graphRef.current.configure();
			graphRef.current.outputGain.gain.value = boostedVoiceVolumePercentToTrackVolume(settings.outputVolume);
		}
	}, [isTesting, settings.inputVolume, settings.outputVolume, vadThreshold, vadAutoSensitivity, transmitMode]);
	useEffect(() => {
		if (!isTesting) {
			activeCaptureSignatureRef.current = captureSignature;
			return;
		}
		if (activeCaptureSignatureRef.current === captureSignature) {
			return;
		}
		activeCaptureSignatureRef.current = captureSignature;
		void start();
	}, [captureSignature, isTesting, start]);
	useEffect(() => {
		return () => {
			stop();
		};
	}, [stop]);
	return {
		isTesting,
		isStarting,
		level,
		peakLevel,
		gateMarker,
		monitorDelayMs: Math.round(MIC_TEST_MONITOR_DELAY_SECONDS * 1000),
		start,
		stop,
	};
};

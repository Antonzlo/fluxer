// SPDX-License-Identifier: AGPL-3.0-or-later

import type {VoiceNoiseSuppressionBackend} from '@app/features/voice/utils/noise_suppression/NoiseSuppressionBackends';

export interface NoiseSuppressionAdvancedSettings {
	deepFilterAttenLimDb: number;
	deepFilterHighPassHz: number;
	noiseGateOpenDb: number;
	noiseGateCloseDb: number;
	noiseGateHoldMs: number;
}

export type NoiseSuppressionAdvancedSettingKey = keyof NoiseSuppressionAdvancedSettings;

export const NOISE_SUPPRESSION_ADVANCED_DEFAULTS: Readonly<NoiseSuppressionAdvancedSettings> = {
	deepFilterAttenLimDb: 30,
	deepFilterHighPassHz: 60,
	noiseGateOpenDb: -41.6,
	noiseGateCloseDb: -47.6,
	noiseGateHoldMs: 180,
};

export const NOISE_SUPPRESSION_ADVANCED_RANGES: Readonly<
	Record<NoiseSuppressionAdvancedSettingKey, {min: number; max: number}>
> = {
	deepFilterAttenLimDb: {min: 0, max: 100},
	deepFilterHighPassHz: {min: 0, max: 400},
	noiseGateOpenDb: {min: -100, max: 0},
	noiseGateCloseDb: {min: -100, max: 0},
	noiseGateHoldMs: {min: 0, max: 2000},
};

export function clampNoiseSuppressionAdvancedSetting(key: NoiseSuppressionAdvancedSettingKey, value: unknown): number {
	const {min, max} = NOISE_SUPPRESSION_ADVANCED_RANGES[key];
	if (typeof value !== 'number' || !Number.isFinite(value)) return NOISE_SUPPRESSION_ADVANCED_DEFAULTS[key];
	return Math.max(min, Math.min(max, value));
}

export function clampNoiseSuppressionAdvancedSettings(
	settings: Partial<Record<NoiseSuppressionAdvancedSettingKey, unknown>>,
): NoiseSuppressionAdvancedSettings {
	return {
		deepFilterAttenLimDb: clampNoiseSuppressionAdvancedSetting('deepFilterAttenLimDb', settings.deepFilterAttenLimDb),
		deepFilterHighPassHz: clampNoiseSuppressionAdvancedSetting('deepFilterHighPassHz', settings.deepFilterHighPassHz),
		noiseGateOpenDb: clampNoiseSuppressionAdvancedSetting('noiseGateOpenDb', settings.noiseGateOpenDb),
		noiseGateCloseDb: clampNoiseSuppressionAdvancedSetting('noiseGateCloseDb', settings.noiseGateCloseDb),
		noiseGateHoldMs: clampNoiseSuppressionAdvancedSetting('noiseGateHoldMs', settings.noiseGateHoldMs),
	};
}

export function getNoiseSuppressionTuningKey(
	backend: VoiceNoiseSuppressionBackend,
	settings: NoiseSuppressionAdvancedSettings,
): string {
	switch (backend) {
		case 'deep_filter':
			return `${settings.deepFilterAttenLimDb}|${settings.deepFilterHighPassHz}`;
		case 'gate':
			return `${settings.noiseGateOpenDb}|${settings.noiseGateCloseDb}|${settings.noiseGateHoldMs}`;
		default:
			return '';
	}
}

// SPDX-License-Identifier: AGPL-3.0-or-later

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

const NOISE_SUPPRESSION_ADVANCED_RANGES: Readonly<
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

export function formatNoiseSuppressionAdvancedSignature(settings: NoiseSuppressionAdvancedSettings): string {
	return [
		settings.deepFilterAttenLimDb,
		settings.deepFilterHighPassHz,
		settings.noiseGateOpenDb,
		settings.noiseGateCloseDb,
		settings.noiseGateHoldMs,
	].join('|');
}

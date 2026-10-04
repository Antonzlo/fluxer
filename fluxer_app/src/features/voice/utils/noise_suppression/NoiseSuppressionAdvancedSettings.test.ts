import {
	clampNoiseSuppressionAdvancedSetting,
	clampNoiseSuppressionAdvancedSettings,
	getNoiseSuppressionTuningKey,
	NOISE_SUPPRESSION_ADVANCED_DEFAULTS,
} from '@app/features/voice/utils/noise_suppression/NoiseSuppressionAdvancedSettings';
import {describe, expect, it} from 'vitest';

describe('clampNoiseSuppressionAdvancedSetting', () => {
	it('keeps in-range values', () => {
		expect(clampNoiseSuppressionAdvancedSetting('deepFilterAttenLimDb', 45)).toBe(45);
	});

	it('clamps out-of-range values to the setting range', () => {
		expect(clampNoiseSuppressionAdvancedSetting('deepFilterAttenLimDb', 500)).toBe(100);
		expect(clampNoiseSuppressionAdvancedSetting('deepFilterHighPassHz', -5)).toBe(0);
		expect(clampNoiseSuppressionAdvancedSetting('noiseGateOpenDb', 12)).toBe(0);
	});

	it('falls back to the default for non-numeric or non-finite values', () => {
		expect(clampNoiseSuppressionAdvancedSetting('noiseGateHoldMs', '200')).toBe(
			NOISE_SUPPRESSION_ADVANCED_DEFAULTS.noiseGateHoldMs,
		);
		expect(clampNoiseSuppressionAdvancedSetting('noiseGateHoldMs', Number.NaN)).toBe(
			NOISE_SUPPRESSION_ADVANCED_DEFAULTS.noiseGateHoldMs,
		);
		expect(clampNoiseSuppressionAdvancedSetting('noiseGateHoldMs', undefined)).toBe(
			NOISE_SUPPRESSION_ADVANCED_DEFAULTS.noiseGateHoldMs,
		);
	});
});

describe('clampNoiseSuppressionAdvancedSettings', () => {
	it('returns the defaults for an empty object', () => {
		expect(clampNoiseSuppressionAdvancedSettings({})).toEqual(NOISE_SUPPRESSION_ADVANCED_DEFAULTS);
	});
});

describe('getNoiseSuppressionTuningKey', () => {
	it('only changes with the settings the backend actually uses', () => {
		const base = {...NOISE_SUPPRESSION_ADVANCED_DEFAULTS};
		const gateChanged = {...base, noiseGateHoldMs: base.noiseGateHoldMs + 10};
		const deepFilterChanged = {...base, deepFilterAttenLimDb: base.deepFilterAttenLimDb + 5};
		expect(getNoiseSuppressionTuningKey('deep_filter', gateChanged)).toBe(
			getNoiseSuppressionTuningKey('deep_filter', base),
		);
		expect(getNoiseSuppressionTuningKey('deep_filter', deepFilterChanged)).not.toBe(
			getNoiseSuppressionTuningKey('deep_filter', base),
		);
		expect(getNoiseSuppressionTuningKey('gate', gateChanged)).not.toBe(getNoiseSuppressionTuningKey('gate', base));
		expect(getNoiseSuppressionTuningKey('gate', deepFilterChanged)).toBe(getNoiseSuppressionTuningKey('gate', base));
	});

	it('is empty for backends without tunable settings', () => {
		expect(getNoiseSuppressionTuningKey('rnnoise', NOISE_SUPPRESSION_ADVANCED_DEFAULTS)).toBe('');
		expect(getNoiseSuppressionTuningKey('none', NOISE_SUPPRESSION_ADVANCED_DEFAULTS)).toBe('');
	});
});

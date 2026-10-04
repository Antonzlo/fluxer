import {__TEST__, getLocalSpeakingThresholdRms} from '@app/features/voice/engine/VoiceSpeakingThreshold';
import {describe, expect, it} from 'vitest';

describe('getLocalSpeakingThresholdRms', () => {
	it('maps the slider ends to the slider range', () => {
		expect(getLocalSpeakingThresholdRms(0)).toBeCloseTo(__TEST__.LOCAL_SLIDER_MIN_RMS, 10);
		expect(getLocalSpeakingThresholdRms(100)).toBeCloseTo(__TEST__.LOCAL_SLIDER_MAX_RMS, 10);
	});

	it('keeps the default slider position at 0.008 RMS', () => {
		expect(getLocalSpeakingThresholdRms(50)).toBeCloseTo(0.008, 6);
	});

	it('moves the threshold by an equal dB step per slider step', () => {
		const db = (slider: number) => 20 * Math.log10(getLocalSpeakingThresholdRms(slider));
		expect(db(10) - db(0)).toBeCloseTo(db(100) - db(90), 6);
	});

	it('is strictly increasing across the whole travel', () => {
		for (let slider = 1; slider <= 100; slider++) {
			expect(getLocalSpeakingThresholdRms(slider)).toBeGreaterThan(getLocalSpeakingThresholdRms(slider - 1));
		}
	});

	it('clamps out-of-range and invalid sliders', () => {
		expect(getLocalSpeakingThresholdRms(-20)).toBe(getLocalSpeakingThresholdRms(0));
		expect(getLocalSpeakingThresholdRms(400)).toBe(getLocalSpeakingThresholdRms(100));
		expect(getLocalSpeakingThresholdRms(Number.NaN)).toBeCloseTo(0.008, 6);
	});
});

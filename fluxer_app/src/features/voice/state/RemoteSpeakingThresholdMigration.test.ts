import {applyRemoteSpeakingThresholdSeedMigrationV1} from '@app/features/voice/state/RemoteSpeakingThresholdMigration';
import {describe, expect, it} from 'vitest';

describe('applyRemoteSpeakingThresholdSeedMigrationV1', () => {
	it('seeds the remote threshold from a customised activity threshold', () => {
		const parsed: Record<string, unknown> = {vadThreshold: 72};
		expect(applyRemoteSpeakingThresholdSeedMigrationV1(parsed)).toBe(true);
		expect(parsed.remoteSpeakingThreshold).toBe(72);
		expect(parsed.remoteSpeakingThresholdSeededV1).toBe(true);
	});

	it('also seeds over the default value written by the first split build', () => {
		const parsed: Record<string, unknown> = {vadThreshold: 20, remoteSpeakingThreshold: 50};
		applyRemoteSpeakingThresholdSeedMigrationV1(parsed);
		expect(parsed.remoteSpeakingThreshold).toBe(20);
	});

	it('keeps a remote threshold the user already changed', () => {
		const parsed: Record<string, unknown> = {vadThreshold: 20, remoteSpeakingThreshold: 65};
		applyRemoteSpeakingThresholdSeedMigrationV1(parsed);
		expect(parsed.remoteSpeakingThreshold).toBe(65);
	});

	it('leaves default and invalid activity thresholds alone', () => {
		const untouched: Record<string, unknown> = {vadThreshold: 50};
		applyRemoteSpeakingThresholdSeedMigrationV1(untouched);
		expect(untouched.remoteSpeakingThreshold).toBeUndefined();
		const invalid: Record<string, unknown> = {vadThreshold: 'loud'};
		applyRemoteSpeakingThresholdSeedMigrationV1(invalid);
		expect(invalid.remoteSpeakingThreshold).toBeUndefined();
	});

	it('runs only once', () => {
		const parsed: Record<string, unknown> = {vadThreshold: 72};
		applyRemoteSpeakingThresholdSeedMigrationV1(parsed);
		parsed.remoteSpeakingThreshold = 10;
		expect(applyRemoteSpeakingThresholdSeedMigrationV1(parsed)).toBe(false);
		expect(parsed.remoteSpeakingThreshold).toBe(10);
	});
});

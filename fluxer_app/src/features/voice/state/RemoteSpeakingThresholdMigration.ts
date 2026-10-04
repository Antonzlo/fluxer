// SPDX-License-Identifier: AGPL-3.0-or-later

export function applyRemoteSpeakingThresholdSeedMigrationV1(parsed: Record<string, unknown>): boolean {
	if (parsed.remoteSpeakingThresholdSeededV1 === true) return false;
	parsed.remoteSpeakingThresholdSeededV1 = true;
	const legacy = parsed.vadThreshold;
	const current = parsed.remoteSpeakingThreshold;
	if (
		typeof legacy === 'number' &&
		Number.isFinite(legacy) &&
		legacy !== 50 &&
		(current === undefined || current === 50)
	) {
		parsed.remoteSpeakingThreshold = Math.max(0, Math.min(100, legacy));
	}
	return true;
}

// SPDX-License-Identifier: AGPL-3.0-or-later

import {recordVoiceAudioDiag} from '@app/features/voice/diagnostics/VoiceAudioDiag';

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MIN_STRETCH_SAMPLES_TO_RECORD = 240;
const SOURCE_RATE_TOLERANCE = 0.05;
const MIN_SOURCE_WINDOW_S = 0.3;

export interface VoiceAudioDiagStatsSource {
	name: string;
	getStats(): Promise<{values(): IterableIterator<unknown>} | undefined>;
}

interface AudioStatsEntry {
	type: string;
	id: string;
	kind?: string;
	timestamp?: number;
	concealedSamples?: number;
	silentConcealedSamples?: number;
	concealmentEvents?: number;
	insertedSamplesForDeceleration?: number;
	removedSamplesForAcceleration?: number;
	packetsLost?: number;
	packetsDiscarded?: number;
	packetsReceived?: number;
	totalSamplesReceived?: number;
	jitter?: number;
	jitterBufferDelay?: number;
	jitterBufferEmittedCount?: number;
	jitterBufferTargetDelay?: number;
	jitterBufferMinimumDelay?: number;
	fractionLost?: number;
	synthesizedSamplesDuration?: number;
	synthesizedSamplesEvents?: number;
	totalSamplesDuration?: number;
	totalPlayoutDelay?: number;
	totalSamplesCount?: number;
	audioLevel?: number;
	totalAudioEnergy?: number;
	nackCount?: number;
	retransmittedPacketsSent?: number;
}

type Counters = Record<string, number>;

function numbers(entry: AudioStatsEntry, keys: ReadonlyArray<keyof AudioStatsEntry>): Counters {
	const out: Counters = {};
	for (const key of keys) {
		const value = entry[key];
		if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
	}
	return out;
}

function delta(current: Counters, previous: Counters | undefined, key: string): number {
	if (!previous) return 0;
	const now = current[key];
	const before = previous[key];
	if (now === undefined || before === undefined) return 0;
	return now - before;
}

const INBOUND_KEYS = [
	'concealedSamples',
	'silentConcealedSamples',
	'concealmentEvents',
	'insertedSamplesForDeceleration',
	'removedSamplesForAcceleration',
	'packetsLost',
	'packetsDiscarded',
	'packetsReceived',
	'totalSamplesReceived',
	'jitterBufferDelay',
	'jitterBufferEmittedCount',
	'jitterBufferTargetDelay',
	'jitterBufferMinimumDelay',
	'timestamp',
] as const;

const PLAYOUT_KEYS = [
	'synthesizedSamplesDuration',
	'synthesizedSamplesEvents',
	'totalSamplesDuration',
	'totalPlayoutDelay',
	'totalSamplesCount',
	'timestamp',
] as const;

const SOURCE_KEYS = ['totalSamplesDuration', 'totalAudioEnergy', 'timestamp'] as const;

/**
 * Polls the peer connections every 500 ms for audio counters the regular 2 s collector drops: concealment and
 * NetEQ time-stretch deltas, the playout synthesis counter (device pulls the jitter buffer could not satisfy), and
 * whether the microphone source delivers audio at wall-clock rate.
 */
export class VoiceAudioDiagStatsPoller {
	private timer: ReturnType<typeof setInterval> | null = null;
	private busy = false;
	private previous = new Map<string, Counters>();
	private lastHeartbeatAtMs = 0;

	start(getSources: () => ReadonlyArray<VoiceAudioDiagStatsSource>): void {
		if (this.timer !== null) return;
		this.timer = setInterval(() => {
			if (this.busy) return;
			this.busy = true;
			void this.poll(getSources()).finally(() => {
				this.busy = false;
			});
		}, POLL_INTERVAL_MS);
	}

	stop(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
		this.previous.clear();
	}

	private async poll(sources: ReadonlyArray<VoiceAudioDiagStatsSource>): Promise<void> {
		const heartbeat = performance.now() - this.lastHeartbeatAtMs >= HEARTBEAT_INTERVAL_MS;
		if (heartbeat) this.lastHeartbeatAtMs = performance.now();
		for (const source of sources) {
			let report: Awaited<ReturnType<VoiceAudioDiagStatsSource['getStats']>>;
			try {
				report = await source.getStats();
			} catch {
				continue;
			}
			if (!report) continue;
			for (const raw of report.values()) {
				const entry = raw as AudioStatsEntry;
				if (entry.kind !== 'audio') continue;
				const key = `${source.name}:${entry.type}:${entry.id}`;
				if (entry.type === 'inbound-rtp') this.onInbound(key, entry, heartbeat);
				else if (entry.type === 'media-playout') this.onPlayout(key, entry);
				else if (entry.type === 'media-source') this.onMediaSource(key, entry);
				else if (entry.type === 'remote-inbound-rtp') this.onRemoteInbound(key, entry);
			}
		}
	}

	private onInbound(key: string, entry: AudioStatsEntry, heartbeat: boolean): void {
		const current = numbers(entry, INBOUND_KEYS);
		const previous = this.previous.get(key);
		this.previous.set(key, current);
		if (heartbeat) {
			recordVoiceAudioDiag('recv', 'inbound-total', {id: entry.id, jitterMs: (entry.jitter ?? 0) * 1000, ...current});
		}
		if (!previous) return;
		const concealed = delta(current, previous, 'concealedSamples');
		const concealEvents = delta(current, previous, 'concealmentEvents');
		const lost = delta(current, previous, 'packetsLost');
		const discarded = delta(current, previous, 'packetsDiscarded');
		const inserted = delta(current, previous, 'insertedSamplesForDeceleration');
		const removed = delta(current, previous, 'removedSamplesForAcceleration');
		const stretch = inserted + removed;
		const concealing = concealed > 0 || concealEvents > 0 || lost > 0 || discarded > 0;
		if (!concealing && stretch < MIN_STRETCH_SAMPLES_TO_RECORD) return;
		const emitted = delta(current, previous, 'jitterBufferEmittedCount');
		const bufferDelay = delta(current, previous, 'jitterBufferDelay');
		const targetDelay = delta(current, previous, 'jitterBufferTargetDelay');
		recordVoiceAudioDiag(
			'recv',
			concealing ? 'inbound-concealment' : 'inbound-stretch',
			{
				id: entry.id,
				concealedSamples: concealed,
				concealmentEvents: concealEvents,
				packetsLost: lost,
				packetsDiscarded: discarded,
				insertedSamplesForDeceleration: inserted,
				removedSamplesForAcceleration: removed,
				jitterBufferDelayMs: emitted > 0 ? Math.round((bufferDelay / emitted) * 1000) : null,
				jitterBufferTargetDelayMs: emitted > 0 ? Math.round((targetDelay / emitted) * 1000) : null,
				jitterMs: Math.round((entry.jitter ?? 0) * 1000),
			},
			concealing,
		);
	}

	private onPlayout(key: string, entry: AudioStatsEntry): void {
		const current = numbers(entry, PLAYOUT_KEYS);
		const previous = this.previous.get(key);
		this.previous.set(key, current);
		const events = delta(current, previous, 'synthesizedSamplesEvents');
		if (events <= 0) return;
		recordVoiceAudioDiag(
			'recv',
			'playout-synthesized',
			{
				id: entry.id,
				events,
				synthesizedDurationMs: Math.round(delta(current, previous, 'synthesizedSamplesDuration') * 1000),
				windowMs: Math.round(delta(current, previous, 'totalSamplesDuration') * 1000),
				totalEvents: current.synthesizedSamplesEvents,
			},
			true,
		);
	}

	private onMediaSource(key: string, entry: AudioStatsEntry): void {
		const current = numbers(entry, SOURCE_KEYS);
		const previous = this.previous.get(key);
		this.previous.set(key, current);
		if (!previous) return;
		const audioS = delta(current, previous, 'totalSamplesDuration');
		const wallS = delta(current, previous, 'timestamp') / 1000;
		if (wallS < MIN_SOURCE_WINDOW_S) return;
		const ratio = audioS / wallS;
		if (Math.abs(ratio - 1) <= SOURCE_RATE_TOLERANCE) return;
		recordVoiceAudioDiag(
			'send',
			'source-rate',
			{id: entry.id, ratio: Math.round(ratio * 1000) / 1000, audioS, wallS, audioLevel: entry.audioLevel},
			true,
		);
	}

	private onRemoteInbound(key: string, entry: AudioStatsEntry): void {
		const current = numbers(entry, ['packetsLost', 'timestamp']);
		const previous = this.previous.get(key);
		this.previous.set(key, current);
		const lost = delta(current, previous, 'packetsLost');
		if (lost <= 0) return;
		recordVoiceAudioDiag(
			'send',
			'remote-reports-loss',
			{
				id: entry.id,
				packetsLost: lost,
				fractionLost: entry.fractionLost,
				jitterMs: Math.round((entry.jitter ?? 0) * 1000),
			},
			true,
		);
	}
}

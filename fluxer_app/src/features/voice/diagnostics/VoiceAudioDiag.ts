// SPDX-License-Identifier: AGPL-3.0-or-later

import {Logger} from '@app/features/platform/utils/AppLogger';
import {getFluxerDebugObject} from '@app/features/platform/utils/FluxerDebugGlobal';

const logger = new Logger('VoiceAudioDiag');

const MAX_ENTRIES = 20_000;
const NOTABLE_LOG_INTERVAL_MS = 1000;
const CONTEXT_SAMPLE_INTERVAL_MS = 1000;
const CLOCK_RATIO_TOLERANCE = 0.03;
const MAIN_THREAD_STALL_MS = 150;
const LONG_TASK_MIN_MS = 100;
const RENDER_CAPACITY_NOTABLE_PEAK = 0.7;

export interface VoiceAudioDiagEntry {
	seq: number;
	wallMs: number;
	perfMs: number;
	src: string;
	kind: string;
	data?: Record<string, unknown>;
}

interface NotableThrottle {
	lastLogAtMs: number;
	suppressed: number;
}

interface RenderCapacityLike extends EventTarget {
	start(options?: {updateInterval?: number}): void;
	stop(): void;
}

interface PlayoutStatsLike {
	underrunDuration?: number;
	underrunEvents?: number;
	totalDuration?: number;
	averageLatency?: number;
	minimumLatency?: number;
	maximumLatency?: number;
}

type DiagAudioContext = AudioContext & {
	sinkId?: string | {type?: string};
	renderCapacity?: RenderCapacityLike;
	playoutStats?: PlayoutStatsLike;
};

const entries: Array<VoiceAudioDiagEntry | undefined> = new Array(MAX_ENTRIES);
const counts = new Map<string, number>();
const throttles = new Map<string, NotableThrottle>();
const watchedContexts = new WeakSet<BaseAudioContext>();
const lastRenderCapacity = new Map<string, Record<string, number>>();
let nextSeq = 0;
let mainThreadWatcherStarted = false;

/**
 * Appends one diagnostic event. Notable events also go to the Logger at info level, at most once per second per
 * source and kind, so they reach the desktop main log when the renderer console is forwarded.
 */
export function recordVoiceAudioDiag(src: string, kind: string, data?: Record<string, unknown>, notable = false): void {
	const entry: VoiceAudioDiagEntry = {
		seq: nextSeq,
		wallMs: Date.now(),
		perfMs: Math.round(performance.now() * 100) / 100,
		src,
		kind,
		data,
	};
	entries[nextSeq % MAX_ENTRIES] = entry;
	nextSeq++;
	const key = `${src}:${kind}`;
	counts.set(key, (counts.get(key) ?? 0) + 1);
	if (!notable) return;
	const throttle = throttles.get(key) ?? {lastLogAtMs: 0, suppressed: 0};
	throttles.set(key, throttle);
	if (entry.perfMs - throttle.lastLogAtMs < NOTABLE_LOG_INTERVAL_MS) {
		throttle.suppressed++;
		return;
	}
	logger.info(`audio-diag ${key}`, {...data, suppressedSinceLast: throttle.suppressed});
	throttle.lastLogAtMs = entry.perfMs;
	throttle.suppressed = 0;
}

export function getVoiceAudioDiagEntries(): Array<VoiceAudioDiagEntry> {
	const total = Math.min(nextSeq, MAX_ENTRIES);
	const first = nextSeq - total;
	const out: Array<VoiceAudioDiagEntry> = [];
	for (let seq = first; seq < nextSeq; seq++) {
		const entry = entries[seq % MAX_ENTRIES];
		if (entry) out.push(entry);
	}
	return out;
}

export function getVoiceAudioDiagSummary(): Record<string, unknown> {
	const all = getVoiceAudioDiagEntries();
	return {
		entries: all.length,
		dropped: Math.max(0, nextSeq - MAX_ENTRIES),
		firstWallMs: all[0]?.wallMs ?? null,
		lastWallMs: all[all.length - 1]?.wallMs ?? null,
		counts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
		renderCapacity: Object.fromEntries(lastRenderCapacity),
	};
}

export function clearVoiceAudioDiag(): void {
	entries.fill(undefined);
	counts.clear();
	throttles.clear();
	nextSeq = 0;
}

export function dumpVoiceAudioDiagNdjson(): string {
	const header = {
		type: 'header',
		createdAt: new Date().toISOString(),
		userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
		buildVersion: import.meta.env.PUBLIC_BUILD_VERSION ?? null,
		summary: getVoiceAudioDiagSummary(),
	};
	return [header, ...getVoiceAudioDiagEntries()].map((line) => JSON.stringify(line)).join('\n');
}

export function downloadVoiceAudioDiag(): string {
	const text = dumpVoiceAudioDiagNdjson();
	const fileName = `fluxer-voice-audio-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`;
	const url = URL.createObjectURL(new Blob([text], {type: 'application/x-ndjson'}));
	const anchor = document.createElement('a');
	anchor.href = url;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
	return fileName;
}

function readSinkId(context: DiagAudioContext): string | null {
	const sinkId = context.sinkId;
	if (typeof sinkId === 'string') return sinkId === '' ? 'default' : sinkId;
	if (sinkId && typeof sinkId === 'object') return sinkId.type ?? 'object';
	return null;
}

function describeContext(context: DiagAudioContext): Record<string, unknown> {
	return {
		sampleRate: context.sampleRate,
		baseLatency: context.baseLatency,
		outputLatency: context.outputLatency,
		state: context.state,
		sinkId: readSinkId(context),
	};
}

function startRenderCapacity(label: string, capacity: RenderCapacityLike): void {
	capacity.addEventListener('update', (event) => {
		const update = event as Event & {averageLoad?: number; peakLoad?: number; underrunRatio?: number};
		const sample = {
			averageLoad: update.averageLoad ?? 0,
			peakLoad: update.peakLoad ?? 0,
			underrunRatio: update.underrunRatio ?? 0,
		};
		lastRenderCapacity.set(label, sample);
		if (sample.underrunRatio > 0 || sample.peakLoad >= RENDER_CAPACITY_NOTABLE_PEAK) {
			recordVoiceAudioDiag(label, 'render-capacity', sample, true);
		}
	});
	capacity.start({updateInterval: 1});
}

/**
 * Watches one AudioContext: creation facts, state and sink changes, the browser's render capacity, playout
 * underruns, and whether the context clock keeps pace with the wall clock.
 */
export function watchVoiceAudioContext(label: string, context: AudioContext): void {
	if (watchedContexts.has(context)) return;
	watchedContexts.add(context);
	const diagContext = context as DiagAudioContext;
	recordVoiceAudioDiag(label, 'context-created', describeContext(diagContext));
	context.addEventListener('statechange', () => {
		recordVoiceAudioDiag(label, 'context-state', describeContext(diagContext), true);
	});
	context.addEventListener('sinkchange', () => {
		recordVoiceAudioDiag(label, 'context-sink', describeContext(diagContext), true);
	});
	if (diagContext.renderCapacity) {
		try {
			startRenderCapacity(label, diagContext.renderCapacity);
		} catch (error) {
			recordVoiceAudioDiag(label, 'render-capacity-unavailable', {error: String(error)});
		}
	} else {
		recordVoiceAudioDiag(label, 'render-capacity-unavailable', {reason: 'not exposed by this runtime'});
	}
	let lastCtxTime = context.currentTime;
	let lastWallMs = performance.now();
	let lastOutputLatency = context.outputLatency;
	let lastUnderrunEvents = diagContext.playoutStats?.underrunEvents ?? 0;
	let lastUnderrunDuration = diagContext.playoutStats?.underrunDuration ?? 0;
	const timer = setInterval(() => {
		if (context.state === 'closed') {
			clearInterval(timer);
			return;
		}
		const nowWallMs = performance.now();
		const wallDeltaS = (nowWallMs - lastWallMs) / 1000;
		const ctxDeltaS = context.currentTime - lastCtxTime;
		lastWallMs = nowWallMs;
		lastCtxTime = context.currentTime;
		if (context.state === 'running' && wallDeltaS > 0.5) {
			const ratio = ctxDeltaS / wallDeltaS;
			if (Math.abs(ratio - 1) > CLOCK_RATIO_TOLERANCE) {
				recordVoiceAudioDiag(
					label,
					'context-clock',
					{ratio: Math.round(ratio * 1000) / 1000, ctxDeltaS, wallDeltaS, ...describeContext(diagContext)},
					true,
				);
			}
		}
		if (context.outputLatency !== lastOutputLatency) {
			recordVoiceAudioDiag(label, 'output-latency', {from: lastOutputLatency, to: context.outputLatency});
			lastOutputLatency = context.outputLatency;
		}
		const stats = diagContext.playoutStats;
		if (stats && (stats.underrunEvents ?? 0) > lastUnderrunEvents) {
			recordVoiceAudioDiag(
				label,
				'playout-underrun',
				{
					events: (stats.underrunEvents ?? 0) - lastUnderrunEvents,
					durationS: (stats.underrunDuration ?? 0) - lastUnderrunDuration,
					totalEvents: stats.underrunEvents,
					averageLatency: stats.averageLatency,
					maximumLatency: stats.maximumLatency,
				},
				true,
			);
		}
		lastUnderrunEvents = stats?.underrunEvents ?? lastUnderrunEvents;
		lastUnderrunDuration = stats?.underrunDuration ?? lastUnderrunDuration;
	}, CONTEXT_SAMPLE_INTERVAL_MS);
}

/** Records main-thread stalls, which delay worklet messages and any ScriptProcessor-based audio bridge. */
function startMainThreadWatcher(): void {
	if (mainThreadWatcherStarted || typeof window === 'undefined' || import.meta.env.MODE === 'test') return;
	mainThreadWatcherStarted = true;
	let expectedAtMs = performance.now() + 100;
	setInterval(() => {
		const lateMs = performance.now() - expectedAtMs;
		expectedAtMs = performance.now() + 100;
		if (lateMs > MAIN_THREAD_STALL_MS) {
			recordVoiceAudioDiag('main', 'stall', {lateMs: Math.round(lateMs)}, true);
		}
	}, 100);
	try {
		const observer = new PerformanceObserver((list) => {
			for (const task of list.getEntries()) {
				if (task.duration >= LONG_TASK_MIN_MS) {
					recordVoiceAudioDiag('main', 'long-task', {durationMs: Math.round(task.duration)});
				}
			}
		});
		observer.observe({entryTypes: ['longtask']});
	} catch {}
}

function installDebugApi(): void {
	const debug = getFluxerDebugObject();
	if (!debug) return;
	debug.audioDiag = {
		summary: getVoiceAudioDiagSummary,
		entries: getVoiceAudioDiagEntries,
		dump: dumpVoiceAudioDiagNdjson,
		download: downloadVoiceAudioDiag,
		clear: clearVoiceAudioDiag,
		record: recordVoiceAudioDiag,
	};
}

installDebugApi();
startMainThreadWatcher();

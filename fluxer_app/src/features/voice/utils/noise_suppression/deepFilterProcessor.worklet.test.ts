import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

const QUANTUM = 128;
const FRAME_LENGTH = 480;

interface TestProcessor {
	running: boolean;
	underruns: number;
	primed: boolean;
	refilling: boolean;
	process(inputs: Array<Array<Float32Array>>, outputs: Array<Array<Float32Array>>): boolean;
	messages: Array<{type: string; underruns?: number}>;
}

function loadProcessor(): TestProcessor {
	const source = fs.readFileSync(path.join(__dirname, 'deepFilterProcessor.worklet.js'), 'utf8');
	let Registered: (new (options: unknown) => TestProcessor) | null = null;
	class FakeAudioWorkletProcessor {
		messages: Array<{type: string}> = [];
		port = {
			onmessage: null as unknown,
			postMessage: (message: {type: string}) => {
				this.messages.push(message);
			},
		};
	}
	new Function('AudioWorkletProcessor', 'registerProcessor', 'sampleRate', 'currentTime', source)(
		FakeAudioWorkletProcessor,
		(_name: string, ctor: new (options: unknown) => TestProcessor) => {
			Registered = ctor;
		},
		48000,
		0,
	);
	const processor = new Registered!({processorOptions: {inputGain: 1, outputGain: 1, highPassHz: 0}});
	const internals = processor as unknown as Record<string, unknown>;
	internals.bindings = {processFrame: (_handle: number, frame: Float32Array) => frame.slice()};
	internals.frameLength = FRAME_LENGTH;
	internals.ringSize = FRAME_LENGTH * 4;
	internals.preRollSamples = FRAME_LENGTH * 2;
	internals.inputRing = new Float32Array(FRAME_LENGTH * 4);
	internals.outputRing = new Float32Array(FRAME_LENGTH * 4);
	internals.frame = new Float32Array(FRAME_LENGTH);
	internals.running = true;
	(processor as unknown as {resetRings(): void}).resetRings();
	processor.messages.length = 0;
	return processor;
}

function run(processor: TestProcessor, value: number): Float32Array {
	const output = new Float32Array(QUANTUM);
	processor.process([[new Float32Array(QUANTUM).fill(value)]], [[output]]);
	return output;
}

describe('fluxer-deep-filter worklet output buffering', () => {
	it('emits nothing until the pre-roll is buffered, then never underruns', () => {
		const processor = loadProcessor();
		let started = false;
		let maxStep = 0;
		let previous = 0;
		for (let i = 0; i < 2000; i++) {
			const out = run(processor, 0.5);
			if (out.some((sample) => sample !== 0)) started = true;
			if (started) {
				for (const sample of out) {
					maxStep = Math.max(maxStep, Math.abs(sample - previous));
					previous = sample;
				}
			}
		}
		expect(started).toBe(true);
		expect(processor.primed).toBe(true);
		expect(processor.underruns).toBe(0);
		expect(maxStep).toBeLessThan(0.51);
		expect(processor.messages.filter((message) => message.type === 'primed')).toHaveLength(1);
	});

	it('crossfades to dry input on an underrun and back once the ring refills', () => {
		const processor = loadProcessor();
		for (let i = 0; i < 40; i++) run(processor, 1);
		const internals = processor as unknown as {outputRead: number; outputWrite: number};
		internals.outputRead = internals.outputWrite;

		const fading = run(processor, -1);
		expect(processor.underruns).toBe(1);
		expect(processor.refilling).toBe(true);
		expect(fading[0]).toBeGreaterThan(0.9);
		expect(fading[QUANTUM - 1]).toBeCloseTo(-1, 1);
		for (let i = 1; i < QUANTUM; i++) expect(Math.abs(fading[i] - fading[i - 1])).toBeLessThan(0.05);

		let last = fading;
		for (let i = 0; i < 40; i++) last = run(processor, 1);
		expect(processor.refilling).toBe(false);
		expect(processor.underruns).toBe(1);
		expect(last[QUANTUM - 1]).toBeCloseTo(1, 5);
	});

	it('reports underruns in health messages', () => {
		const processor = loadProcessor();
		for (let i = 0; i < 50 * 4 + 20; i++) run(processor, 0.1);
		const health = processor.messages.find((message) => message.type === 'health');
		expect(health?.underruns).toBe(0);
	});
});

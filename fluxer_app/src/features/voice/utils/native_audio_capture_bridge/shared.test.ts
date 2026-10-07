// SPDX-License-Identifier: AGPL-3.0-or-later

import {NativeAudioFrameChunker} from '@app/features/voice/utils/native_audio_capture_bridge/shared';
import {describe, expect, it} from 'vitest';

function frame(timestampUs: number) {
	return {sampleRate: 48_000, channels: 1, timestampUs, samples: new Float32Array(480).buffer};
}

describe('NativeAudioFrameChunker', () => {
	it('stamps chunks on the renderer clock instead of the native capture clock', () => {
		let now = 5_000_000;
		const chunker = new NativeAudioFrameChunker(10_000, () => now);
		const first = chunker.push(frame(19_180_355_981_000));
		now += 10_000;
		const second = chunker.push(frame(19_180_355_991_000));
		expect(first.map((chunk) => chunk.timestampUs)).toEqual([5_000_000]);
		expect(second.map((chunk) => chunk.timestampUs)).toEqual([5_010_000]);
	});

	it('resyncs to the renderer clock after a capture gap', () => {
		let now = 1_000_000;
		const chunker = new NativeAudioFrameChunker(10_000, () => now);
		chunker.push(frame(0));
		now += 1_000_000;
		expect(chunker.push(frame(10_000)).map((chunk) => chunk.timestampUs)).toEqual([2_000_000]);
	});
});

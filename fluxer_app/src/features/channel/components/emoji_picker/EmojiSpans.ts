// SPDX-License-Identifier: AGPL-3.0-or-later

import type {FlatEmoji} from '@app/features/emoji/types/EmojiTypes';
import {observable} from 'mobx';

const spans = observable.map<string, number>();

export function getEmojiSpanKey(emoji: FlatEmoji): string | null {
	return emoji.id ?? emoji.url ?? null;
}

/** Grid cells an emoji occupies: its aspect ratio rounded up (2.5x wide takes 3). Unknown until the image loads. */
export function getEmojiSpan(emoji: FlatEmoji): number {
	const key = getEmojiSpanKey(emoji);
	return (key != null && spans.get(key)) || 1;
}

export function reportEmojiSize(key: string, width: number, height: number): void {
	if (!width || !height) return;
	const span = Math.max(1, Math.ceil(width / height - 0.01));
	if (spans.get(key) !== span) spans.set(key, span);
}

export function getEmojiSpansVersion(): number {
	return spans.size + [...spans.values()].reduce((a, b) => a + b, 0);
}

/** Packs rows first-fit: a gap left by a wide emoji that wraps is filled by the next emoji that fits. */
export function chunkEmojisBySpan(emojis: Array<FlatEmoji>, perRow: number): Array<Array<FlatEmoji>> {
	const spans = emojis.map((emoji) => Math.min(getEmojiSpan(emoji), perRow));
	const placed = new Array<boolean>(emojis.length).fill(false);
	const rows: Array<Array<FlatEmoji>> = [];
	let start = 0;
	while (start < emojis.length) {
		if (placed[start]) {
			start++;
			continue;
		}
		const row: Array<FlatEmoji> = [];
		let used = 0;
		for (let i = start; i < emojis.length && used < perRow; i++) {
			if (placed[i] || used + spans[i] > perRow) continue;
			placed[i] = true;
			row.push(emojis[i]);
			used += spans[i];
		}
		rows.push(row);
	}
	return rows;
}

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

export function chunkEmojisBySpan(emojis: Array<FlatEmoji>, perRow: number): Array<Array<FlatEmoji>> {
	const rows: Array<Array<FlatEmoji>> = [];
	let row: Array<FlatEmoji> = [];
	let used = 0;
	for (const emoji of emojis) {
		const span = Math.min(getEmojiSpan(emoji), perRow);
		if (used + span > perRow) {
			rows.push(row);
			row = [];
			used = 0;
		}
		row.push(emoji);
		used += span;
		if (used >= perRow) {
			rows.push(row);
			row = [];
			used = 0;
		}
	}
	if (row.length > 0) rows.push(row);
	return rows;
}

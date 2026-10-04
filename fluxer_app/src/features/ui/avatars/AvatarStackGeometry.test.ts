// SPDX-License-Identifier: AGPL-3.0-or-later

import {resolveAvatarStackMaxVisibleForWidth} from '@app/features/ui/avatars/AvatarStackGeometry';
import {describe, expect, it} from 'vitest';

describe('resolveAvatarStackMaxVisibleForWidth', () => {
	const base = {sizePx: 32, overlapPx: 0};

	it('shows every avatar when they all fit without reserving a "+N" slot', () => {
		expect(resolveAvatarStackMaxVisibleForWidth({...base, totalCount: 5, availableWidthPx: 5 * 32 + 2})).toBe(5);
		expect(resolveAvatarStackMaxVisibleForWidth({...base, totalCount: 5, availableWidthPx: 400})).toBe(5);
	});

	it('collapses to the avatars that fit plus one "+N" slot when they do not all fit', () => {
		expect(resolveAvatarStackMaxVisibleForWidth({...base, totalCount: 10, availableWidthPx: 5 * 32 + 2})).toBe(4);
	});

	it('keeps at least one avatar visible in a very narrow container', () => {
		expect(resolveAvatarStackMaxVisibleForWidth({...base, totalCount: 10, availableWidthPx: 10})).toBe(1);
	});

	it('accounts for the app rem scale', () => {
		expect(
			resolveAvatarStackMaxVisibleForWidth({...base, totalCount: 5, availableWidthPx: 5 * 32 + 2, remScale: 1.5}),
		).toBe(2);
	});

	it('handles empty and single-entry stacks', () => {
		expect(resolveAvatarStackMaxVisibleForWidth({...base, totalCount: 0, availableWidthPx: 0})).toBe(0);
		expect(resolveAvatarStackMaxVisibleForWidth({...base, totalCount: 1, availableWidthPx: 0})).toBe(1);
	});
});

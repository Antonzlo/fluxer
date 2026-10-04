// SPDX-License-Identifier: AGPL-3.0-or-later

import {remFromPx} from '@app/features/theme/layout/RemFromPx';

export const AVATAR_STACK_DEFAULT_SIZE_PX = 28;
export const AVATAR_STACK_DEFAULT_MAX_VISIBLE = 3;
export const AVATAR_STACK_OVERLAP_RATIO = -0.35;
export const AVATAR_STACK_OUTLINE_RATIO = 0.05;
export const AVATAR_STACK_MIN_OUTLINE_PX = 1;
export const AVATAR_STACK_MAX_OUTLINE_PX = 3;

export interface AvatarStackGeometry {
	readonly sizeRem: `${number}rem`;
	readonly overlapRem: `${number}rem`;
	readonly outlineRem: `${number}rem`;
	readonly stepRem: `${number}rem`;
}

export function resolveAvatarStackOutlinePx(sizePx: number): number {
	return Math.min(
		AVATAR_STACK_MAX_OUTLINE_PX,
		Math.max(AVATAR_STACK_MIN_OUTLINE_PX, Math.round(sizePx * AVATAR_STACK_OUTLINE_RATIO)),
	);
}

export function resolveAvatarStackOverlapPx(sizePx: number, overlapPx?: number | null): number {
	if (overlapPx != null) {
		return overlapPx;
	}
	return Math.round(AVATAR_STACK_OVERLAP_RATIO * sizePx);
}

export function resolveAvatarStackColumnCount(totalCount: number, maxVisible: number): number {
	const visibleCount = Math.min(totalCount, maxVisible);
	if (totalCount > maxVisible) {
		return visibleCount + 1;
	}
	return visibleCount;
}

export function resolveAvatarStackGeometry(sizePx: number, overlapPx?: number | null): AvatarStackGeometry {
	const overlap = resolveAvatarStackOverlapPx(sizePx, overlapPx);
	return {
		sizeRem: remFromPx(sizePx),
		overlapRem: remFromPx(overlap),
		outlineRem: remFromPx(resolveAvatarStackOutlinePx(sizePx)),
		stepRem: remFromPx(sizePx + overlap),
	};
}

export function resolveAvatarStackMaxVisibleForWidth({
	availableWidthPx,
	totalCount,
	sizePx,
	overlapPx,
	remScale = 1,
}: {
	availableWidthPx: number;
	totalCount: number;
	sizePx: number;
	overlapPx?: number | null;
	remScale?: number;
}): number {
	const overlap = resolveAvatarStackOverlapPx(sizePx, overlapPx);
	const stepPx = sizePx + overlap;
	const trailingPx = Math.max(-overlap, 0) + resolveAvatarStackOutlinePx(sizePx);
	const widthForColumns = (columnCount: number) => (columnCount * stepPx + trailingPx) * remScale;
	if (totalCount <= 1 || widthForColumns(totalCount) <= availableWidthPx) {
		return totalCount;
	}
	let visibleCount = totalCount - 1;
	while (visibleCount > 1 && widthForColumns(visibleCount + 1) > availableWidthPx) {
		visibleCount--;
	}
	return visibleCount;
}

export function resolveAvatarStackWidthRem(
	totalCount: number,
	sizePx: number,
	maxVisible: number,
	overlapPx?: number | null,
): `${number}rem` {
	const columnCount = resolveAvatarStackColumnCount(totalCount, maxVisible);
	const stepPx = sizePx + resolveAvatarStackOverlapPx(sizePx, overlapPx);
	return remFromPx(sizePx + Math.max(0, columnCount - 1) * stepPx + resolveAvatarStackOutlinePx(sizePx));
}

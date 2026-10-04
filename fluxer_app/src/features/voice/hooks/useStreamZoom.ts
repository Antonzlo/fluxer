// SPDX-License-Identifier: AGPL-3.0-or-later

import {useCallback, useEffect, useRef, useState} from 'react';

export const STREAM_ZOOM_MIN = 1;
export const STREAM_ZOOM_MAX = 8;
const BUTTON_ZOOM_STEP = 1.35;
const WHEEL_SENSITIVITY = 0.0015;
const PINCH_SENSITIVITY = 0.01;
const WHEEL_LINE_HEIGHT_PX = 16;
const DRAG_CLICK_SUPPRESS_PX = 4;

export interface StreamZoomState {
	scale: number;
	centerX: number;
	centerY: number;
}

const IDENTITY: StreamZoomState = {scale: 1, centerX: 0.5, centerY: 0.5};

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function normalize(scale: number, centerX: number, centerY: number): StreamZoomState {
	const nextScale = clamp(scale, STREAM_ZOOM_MIN, STREAM_ZOOM_MAX);
	if (nextScale <= STREAM_ZOOM_MIN) return IDENTITY;
	const halfView = 0.5 / nextScale;
	return {
		scale: nextScale,
		centerX: clamp(centerX, halfView, 1 - halfView),
		centerY: clamp(centerY, halfView, 1 - halfView),
	};
}

interface UseStreamZoomOptions {
	enabled: boolean;
	tileRef: React.RefObject<HTMLElement | null>;
}

export function useStreamZoom({enabled, tileRef}: UseStreamZoomOptions) {
	const [zoom, setZoom] = useState<StreamZoomState>(IDENTITY);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;

	const apply = useCallback((next: StreamZoomState) => {
		zoomRef.current = next;
		setZoom(next);
	}, []);

	const zoomAt = useCallback(
		(nextScale: number, anchorX = 0.5, anchorY = 0.5) => {
			const current = zoomRef.current;
			const scale = clamp(nextScale, STREAM_ZOOM_MIN, STREAM_ZOOM_MAX);
			const contentX = current.centerX + (anchorX - 0.5) / current.scale;
			const contentY = current.centerY + (anchorY - 0.5) / current.scale;
			apply(normalize(scale, contentX - (anchorX - 0.5) / scale, contentY - (anchorY - 0.5) / scale));
		},
		[apply],
	);

	const setScale = useCallback((scale: number) => zoomAt(scale), [zoomAt]);
	const zoomIn = useCallback(() => zoomAt(zoomRef.current.scale * BUTTON_ZOOM_STEP), [zoomAt]);
	const zoomOut = useCallback(() => zoomAt(zoomRef.current.scale / BUTTON_ZOOM_STEP), [zoomAt]);
	const reset = useCallback(() => apply(IDENTITY), [apply]);
	const setCenter = useCallback(
		(centerX: number, centerY: number) => apply(normalize(zoomRef.current.scale, centerX, centerY)),
		[apply],
	);

	useEffect(() => {
		if (!enabled) apply(IDENTITY);
	}, [enabled, apply]);

	useEffect(() => {
		const tile = tileRef.current;
		if (!enabled || !tile) return;

		const handleWheel = (event: WheelEvent) => {
			if (event.target instanceof Element && event.target.closest('[data-stream-zoom-ignore]')) return;
			event.preventDefault();
			const rect = tile.getBoundingClientRect();
			if (rect.width === 0 || rect.height === 0) return;
			const lineScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? WHEEL_LINE_HEIGHT_PX : 1;
			const delta = event.deltaY * lineScale;
			const sensitivity = event.ctrlKey ? PINCH_SENSITIVITY : WHEEL_SENSITIVITY;
			zoomAt(
				zoomRef.current.scale * Math.exp(-delta * sensitivity),
				(event.clientX - rect.left) / rect.width,
				(event.clientY - rect.top) / rect.height,
			);
		};

		let drag: {pointerId: number; x: number; y: number; moved: boolean} | null = null;
		let suppressClick = false;

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button !== 0 || zoomRef.current.scale <= STREAM_ZOOM_MIN) return;
			if (event.target instanceof Element && event.target.closest('[data-stream-zoom-ignore]')) return;
			drag = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false};
		};
		const handlePointerMove = (event: PointerEvent) => {
			if (!drag || drag.pointerId !== event.pointerId) return;
			const dx = event.clientX - drag.x;
			const dy = event.clientY - drag.y;
			if (!drag.moved) {
				if (Math.hypot(dx, dy) < DRAG_CLICK_SUPPRESS_PX) return;
				drag.moved = true;
				tile.setPointerCapture(event.pointerId);
				tile.dataset.zoomPanning = 'true';
			}
			const rect = tile.getBoundingClientRect();
			const current = zoomRef.current;
			drag.x = event.clientX;
			drag.y = event.clientY;
			apply(
				normalize(
					current.scale,
					current.centerX - dx / (rect.width * current.scale),
					current.centerY - dy / (rect.height * current.scale),
				),
			);
		};
		const endDrag = (event: PointerEvent) => {
			if (!drag || drag.pointerId !== event.pointerId) return;
			if (drag.moved) {
				suppressClick = true;
				delete tile.dataset.zoomPanning;
				if (tile.hasPointerCapture(event.pointerId)) tile.releasePointerCapture(event.pointerId);
			}
			drag = null;
		};
		const handleClickCapture = (event: MouseEvent) => {
			if (!suppressClick) return;
			suppressClick = false;
			event.stopPropagation();
			event.preventDefault();
		};

		tile.addEventListener('wheel', handleWheel, {passive: false});
		tile.addEventListener('pointerdown', handlePointerDown);
		tile.addEventListener('pointermove', handlePointerMove);
		tile.addEventListener('pointerup', endDrag);
		tile.addEventListener('pointercancel', endDrag);
		tile.addEventListener('click', handleClickCapture, true);
		return () => {
			tile.removeEventListener('wheel', handleWheel);
			tile.removeEventListener('pointerdown', handlePointerDown);
			tile.removeEventListener('pointermove', handlePointerMove);
			tile.removeEventListener('pointerup', endDrag);
			tile.removeEventListener('pointercancel', endDrag);
			tile.removeEventListener('click', handleClickCapture, true);
			delete tile.dataset.zoomPanning;
		};
	}, [enabled, tileRef, zoomAt, apply]);

	return {zoom, setScale, zoomIn, zoomOut, reset, setCenter};
}

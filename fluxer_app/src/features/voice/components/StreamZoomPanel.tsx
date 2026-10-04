// SPDX-License-Identifier: AGPL-3.0-or-later

import {ZOOM_IN_DESCRIPTOR, ZOOM_OUT_DESCRIPTOR} from '@app/features/i18n/utils/CommonMessageDescriptors';
import styles from '@app/features/voice/components/StreamZoomPanel.module.css';
import {STREAM_ZOOM_MAX, STREAM_ZOOM_MIN, type StreamZoomState} from '@app/features/voice/hooks/useStreamZoom';
import {useLingui} from '@lingui/react/macro';
import {MagnifyingGlassMinusIcon, MagnifyingGlassPlusIcon} from '@phosphor-icons/react';
import type React from 'react';
import {useEffect, useRef} from 'react';

interface StreamZoomPanelProps {
	zoom: StreamZoomState;
	sourceVideoRef: React.RefObject<HTMLVideoElement | null>;
	onScaleChange: (scale: number) => void;
	onCenterChange: (centerX: number, centerY: number) => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
}

const stop = (event: React.SyntheticEvent) => event.stopPropagation();

export function StreamZoomPanel({
	zoom,
	sourceVideoRef,
	onScaleChange,
	onCenterChange,
	onZoomIn,
	onZoomOut,
}: StreamZoomPanelProps) {
	const {i18n} = useLingui();
	const miniVideoRef = useRef<HTMLVideoElement | null>(null);
	const miniMapRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const mini = miniVideoRef.current;
		const stream = sourceVideoRef.current?.srcObject ?? null;
		if (!mini || !stream) return;
		mini.srcObject = stream;
		const syncAspectRatio = () => {
			if (mini.videoWidth > 0 && mini.videoHeight > 0 && miniMapRef.current) {
				miniMapRef.current.style.aspectRatio = `${mini.videoWidth} / ${mini.videoHeight}`;
			}
		};
		mini.addEventListener('loadedmetadata', syncAspectRatio);
		mini.addEventListener('resize', syncAspectRatio);
		syncAspectRatio();
		void mini.play().catch(() => {});
		return () => {
			mini.removeEventListener('loadedmetadata', syncAspectRatio);
			mini.removeEventListener('resize', syncAspectRatio);
			mini.srcObject = null;
		};
	}, [sourceVideoRef]);

	const moveViewport = (event: React.PointerEvent<HTMLDivElement>) => {
		const rect = miniMapRef.current?.getBoundingClientRect();
		if (!rect || rect.width === 0 || rect.height === 0) return;
		onCenterChange((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
	};

	const viewportStyle = {
		width: `${100 / zoom.scale}%`,
		height: `${100 / zoom.scale}%`,
		left: `${(zoom.centerX - 0.5 / zoom.scale) * 100}%`,
		top: `${(zoom.centerY - 0.5 / zoom.scale) * 100}%`,
	} as const;

	return (
		<div
			className={styles.panel}
			role="group"
			data-stream-zoom-ignore
			onClick={stop}
			onDoubleClick={stop}
			onKeyDown={stop}
			onPointerDown={stop}
			data-flx="voice.stream-zoom-panel"
		>
			<div
				ref={miniMapRef}
				className={styles.miniMap}
				onPointerDown={(event) => {
					event.stopPropagation();
					event.currentTarget.setPointerCapture(event.pointerId);
					moveViewport(event);
				}}
				onPointerMove={(event) => {
					if (event.currentTarget.hasPointerCapture(event.pointerId)) moveViewport(event);
				}}
				data-flx="voice.stream-zoom-panel.mini-map"
			>
				<video ref={miniVideoRef} className={styles.miniVideo} data-stream-zoom-minimap muted playsInline autoPlay />
				<div className={styles.viewport} style={viewportStyle} data-flx="voice.stream-zoom-panel.viewport" />
			</div>
			<div className={styles.controls} data-flx="voice.stream-zoom-panel.controls">
				<button
					type="button"
					className={styles.button}
					onClick={onZoomOut}
					aria-label={i18n._(ZOOM_OUT_DESCRIPTOR)}
					title={i18n._(ZOOM_OUT_DESCRIPTOR)}
					data-flx="voice.stream-zoom-panel.zoom-out"
				>
					<MagnifyingGlassMinusIcon size={16} weight="bold" />
				</button>
				<input
					type="range"
					className={styles.slider}
					min={STREAM_ZOOM_MIN}
					max={STREAM_ZOOM_MAX}
					step={0.01}
					value={zoom.scale}
					onChange={(event) => onScaleChange(Number(event.target.value))}
					aria-label={`${i18n._(ZOOM_IN_DESCRIPTOR)} / ${i18n._(ZOOM_OUT_DESCRIPTOR)}`}
					data-flx="voice.stream-zoom-panel.slider"
				/>
				<button
					type="button"
					className={styles.button}
					onClick={onZoomIn}
					aria-label={i18n._(ZOOM_IN_DESCRIPTOR)}
					title={i18n._(ZOOM_IN_DESCRIPTOR)}
					data-flx="voice.stream-zoom-panel.zoom-in"
				>
					<MagnifyingGlassPlusIcon size={16} weight="bold" />
				</button>
			</div>
		</div>
	);
}

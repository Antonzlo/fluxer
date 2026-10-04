// @vitest-environment happy-dom
// SPDX-License-Identifier: AGPL-3.0-or-later

import {LongPressable} from '@app/features/app/components/LongPressable';
import FocusRing from '@app/features/ui/focus_ring/FocusRing';
import {scheduleFloatingPortalSweep} from '@app/features/ui/popover/PopoverPortalCleanup';
import {StreamWatchHoverPopout} from '@app/features/voice/components/StreamWatchHoverPopout';
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@app/features/accessibility/state/Accessibility', () => ({default: {useReducedMotion: true}}));
vi.mock('@app/features/navigation/commands/NavigationCommands', () => ({selectChannel: vi.fn()}));
vi.mock('@app/features/permissions/state/Permission', () => ({default: {can: () => true}}));
vi.mock('@app/features/ui/state/MobileLayout', () => ({default: {isMobileLayout: () => false}}));
vi.mock('@app/features/ui/state/OverlayStack', () => ({OVERLAY_STACK_BASE_Z_INDEX: 10000}));
vi.mock('@app/features/voice/commands/VoiceStreamWatchCommands', () => ({}));
vi.mock('@app/features/voice/components/StreamWatchHoverCard', () => ({
	StreamWatchHoverCard: () => <div data-testid="card">card</div>,
}));
vi.mock('@app/features/voice/components/useStreamPreview', () => ({
	useStreamPreview: () => ({previewUrl: null, isPreviewLoading: false}),
}));
vi.mock('@app/features/voice/components/useStreamWatchState', () => ({
	useStreamWatchState: () => ({isWatching: false, isPendingJoin: false, canWatch: true, startWatching: vi.fn()}),
}));
vi.mock('@app/features/voice/engine/MediaEngineFacade', () => ({
	default: {connectionVoiceStates: {}, participants: {}, connectionId: 'c1'},
	useMediaEngineVersion: () => 0,
}));
vi.mock('@app/features/voice/hooks/usePendingVoiceConnection', () => ({
	usePendingVoiceConnection: () => ({markPending: vi.fn()}),
}));
vi.mock('@lingui/react/macro', () => ({
	useLingui: () => ({i18n: {_: (descriptor: {message?: string}) => descriptor?.message ?? '', locale: 'en'}}),
}));
vi.mock('@lingui/core/macro', () => ({msg: (descriptor: unknown) => descriptor}));

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function renderRow(enabled: boolean) {
	return (
		<StreamWatchHoverPopout enabled={enabled} streamKey="g1:c1:conn1" guildId="g1" channelId="c1">
			<FocusRing offset={-2}>
				<LongPressable data-testid="row" role="button" onClick={() => {}}>
					row
				</LongPressable>
			</FocusRing>
		</StreamWatchHoverPopout>
	);
}

async function hover(row: Element) {
	await act(async () => {
		row.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
		row.dispatchEvent(new MouseEvent('mouseenter', {bubbles: false}));
		row.dispatchEvent(new MouseEvent('mousemove', {bubbles: true}));
		await sleep(400);
	});
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('StreamWatchHoverPopout', () => {
	it('opens the card on hover when enabled from the first render', async () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => root.render(renderRow(true)));
		await hover(container.querySelector('[data-testid="row"]')!);
		expect(document.querySelector('[data-testid="card"]')).not.toBeNull();
	});

	it('opens the card on hover when streaming starts after the row mounted', async () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => root.render(renderRow(false)));
		await act(async () => root.render(renderRow(true)));
		await hover(container.querySelector('[data-testid="row"]')!);
		expect(document.querySelector('[data-testid="card"]')).not.toBeNull();
	});

	it('does not open the card while disabled', async () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => root.render(renderRow(false)));
		await hover(container.querySelector('[data-testid="row"]')!);
		expect(document.querySelector('[data-testid="card"]')).toBeNull();
	});

	it('still opens the card after the popover portal sweep removed empty floating portals', async () => {
		const container = document.createElement('div');
		document.body.appendChild(container);
		const root = createRoot(container);
		await act(async () => root.render(renderRow(true)));
		await act(async () => {
			scheduleFloatingPortalSweep();
			await sleep(400);
		});
		await hover(container.querySelector('[data-testid="row"]')!);
		expect(document.querySelector('[data-testid="card"]')).not.toBeNull();
	});
});

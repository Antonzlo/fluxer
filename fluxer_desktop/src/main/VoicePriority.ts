// SPDX-License-Identifier: AGPL-3.0-or-later

import os from 'node:os';
import log from 'electron-log';

const VOICE_PRIORITY = os.constants?.priority?.PRIORITY_ABOVE_NORMAL ?? -7;
const CAN_ELEVATE_PROCESS_PRIORITY = process.platform === 'win32';
const REFRESH_INTERVAL_MS = 5000;

const voiceWebContents = new Map<Electron.WebContents, () => void>();
const savedPriorities = new Map<number, number>();
let refreshTimer: NodeJS.Timeout | null = null;

function getRendererProcessId(webContents: Electron.WebContents): number | undefined {
	if (webContents.isDestroyed()) return undefined;
	try {
		return webContents.getOSProcessId();
	} catch {
		return undefined;
	}
}

function elevate(processId: number): void {
	try {
		const current = os.getPriority(processId);
		if (current <= VOICE_PRIORITY) return;
		os.setPriority(processId, VOICE_PRIORITY);
		if (!savedPriorities.has(processId)) savedPriorities.set(processId, current);
	} catch (error) {
		log.debug('[VoicePriority] Failed to elevate renderer priority', {processId, error});
	}
}

function refresh(): void {
	for (const webContents of voiceWebContents.keys()) {
		const processId = getRendererProcessId(webContents);
		if (processId !== undefined) elevate(processId);
	}
}

function restore(processId: number): void {
	const saved = savedPriorities.get(processId);
	if (saved === undefined) return;
	savedPriorities.delete(processId);
	try {
		os.setPriority(processId, saved);
	} catch (error) {
		log.debug('[VoicePriority] Failed to restore renderer priority', {processId, error});
	}
}

export function releaseVoicePriority(webContents: Electron.WebContents): void {
	const detach = voiceWebContents.get(webContents);
	if (!detach) return;
	const processId = getRendererProcessId(webContents);
	detach();
	voiceWebContents.delete(webContents);
	if (processId !== undefined) restore(processId);
	if (voiceWebContents.size === 0 && refreshTimer !== null) {
		clearInterval(refreshTimer);
		refreshTimer = null;
	}
}

export function acquireVoicePriority(webContents: Electron.WebContents): void {
	if (!CAN_ELEVATE_PROCESS_PRIORITY || webContents.isDestroyed() || voiceWebContents.has(webContents)) return;
	const onGone = (): void => releaseVoicePriority(webContents);
	webContents.once('destroyed', onGone);
	webContents.once('render-process-gone', onGone);
	voiceWebContents.set(webContents, () => {
		webContents.removeListener('destroyed', onGone);
		webContents.removeListener('render-process-gone', onGone);
	});
	const processId = getRendererProcessId(webContents);
	if (processId !== undefined) elevate(processId);
	if (refreshTimer === null) {
		refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
		refreshTimer.unref?.();
	}
	log.info('[VoicePriority] Acquired', {processId});
}

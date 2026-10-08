// SPDX-License-Identifier: AGPL-3.0-or-later

import {BUILD_CHANNEL} from '@electron/common/BuildChannel';
import {checkDesktopUpdateNow} from '@electron/main/DesktopUpdateGate';
import {MANUAL_DESKTOP_FORMATS, type ManualDesktopFormat} from '@electron/main/ShellDownloadFormats';
import {resolveShellUpdatePlan, ShellUpdateCapability} from '@electron/main/ShellUpdateCapability';
import {
	DOWNLOAD_PAGE_URL,
	getManualDownloadOptions,
	getManualDownloadUrl,
	type ManualLatestFile,
	type ManualLatestInfo,
	UPDATE_BASE_URL,
	type UpdaterDownloadOption,
} from '@electron/main/UpdaterDownloads';
import {app, type BrowserWindow, ipcMain, net} from 'electron';
import log from 'electron-log';

type UpdaterContext = 'user' | 'background' | 'focus';
type UpdaterEvent =
	| {
			type: 'checking';
			context: UpdaterContext;
	  }
	| {
			type: 'available';
			context: UpdaterContext;
			version?: string | null;
			downloadUrl?: string;
			downloadOptions?: Array<UpdaterDownloadOption>;
	  }
	| {
			type: 'not-available';
			context: UpdaterContext;
	  }
	| {
			type: 'error';
			context: UpdaterContext;
			message: string;
	  }
	| {
			type: 'unsupported';
			context: UpdaterContext;
			reason: 'platform' | 'unpackaged' | 'managed-package';
			downloadUrl?: string;
	  };

function send(win: BrowserWindow | null, event: UpdaterEvent) {
	win?.webContents.send('updater-event', event);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

let manualLatestCache: {at: number; info: ManualLatestInfo} | null = null;

const MANUAL_CACHE_TTL_MS = 5 * 60 * 1000;

function parseSemverTuple(input: string): [number, number, number, string] {
	const trimmed = input.trim().replace(/^v/, '');
	const [core, ...preParts] = trimmed.split('-');
	const pre = preParts.join('-');
	const segments = core.split('.').map((part) => Number.parseInt(part, 10));
	const [major = 0, minor = 0, patch = 0] = segments;
	return [
		Number.isFinite(major) ? major : 0,
		Number.isFinite(minor) ? minor : 0,
		Number.isFinite(patch) ? patch : 0,
		pre,
	];
}

function compareVersions(a: string, b: string): number {
	const [aMaj, aMin, aPat, aPre] = parseSemverTuple(a);
	const [bMaj, bMin, bPat, bPre] = parseSemverTuple(b);
	if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
	if (aMin !== bMin) return aMin < bMin ? -1 : 1;
	if (aPat !== bPat) return aPat < bPat ? -1 : 1;
	if (aPre === bPre) return 0;
	if (!aPre) return 1;
	if (!bPre) return -1;
	return aPre < bPre ? -1 : 1;
}

function parseManualLatestFiles(value: unknown): Partial<Record<ManualDesktopFormat, ManualLatestFile>> {
	if (!isRecord(value)) {
		return {};
	}
	const files: Partial<Record<ManualDesktopFormat, ManualLatestFile>> = {};
	for (const format of MANUAL_DESKTOP_FORMATS) {
		const entry = value[format];
		if (!isRecord(entry) || typeof entry.url !== 'string' || entry.url.trim().length === 0) {
			continue;
		}
		files[format] = {
			url: entry.url,
			sha256: typeof entry.sha256 === 'string' ? entry.sha256 : null,
		};
	}
	return files;
}

// Potryasker: stable builds read the latest release of this fork instead of an upstream package host.
const FORK_RELEASES_API = 'https://api.github.com/repos/Antonzlo/fluxer/releases/latest';
const FORK_ASSET_FORMATS: ReadonlyArray<[RegExp, ManualDesktopFormat]> = [
	[/-setup-win-x64\.exe$/u, 'setup'],
	[/\.rpm$/u, 'rpm'],
	[/\.deb$/u, 'deb'],
	[/\.appimage$/iu, 'appimage'],
	[/\.tar\.gz$/u, 'tar_gz'],
	[/\.dmg$/u, 'dmg'],
];

async function fetchForkLatest(): Promise<ManualLatestInfo> {
	const response = await net.fetch(FORK_RELEASES_API, {
		cache: 'no-store',
		headers: {Accept: 'application/vnd.github+json'},
	});
	if (!response.ok) {
		throw new Error(`Latest release request failed: ${response.status}`);
	}
	const release = (await response.json()) as {
		tag_name?: unknown;
		published_at?: unknown;
		assets?: Array<{name?: unknown; browser_download_url?: unknown; digest?: unknown}>;
	};
	if (typeof release.tag_name !== 'string' || release.tag_name.length === 0) {
		throw new Error('Latest release response missing tag name');
	}
	const files: Partial<Record<ManualDesktopFormat, ManualLatestFile>> = {};
	for (const asset of release.assets ?? []) {
		if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') continue;
		const format = FORK_ASSET_FORMATS.find(([pattern]) => pattern.test(asset.name as string))?.[1];
		if (format == null || files[format] != null) continue;
		const digest = typeof asset.digest === 'string' ? asset.digest.replace(/^sha256:/u, '') : null;
		files[format] = {url: asset.browser_download_url, sha256: digest};
	}
	return {
		version: release.tag_name.replace(/^v/u, ''),
		pubDate: typeof release.published_at === 'string' ? release.published_at : null,
		files,
	};
}

async function fetchManualLatest(options: {forceRefresh?: boolean} = {}): Promise<ManualLatestInfo> {
	const now = Date.now();
	if (!options.forceRefresh && manualLatestCache && now - manualLatestCache.at < MANUAL_CACHE_TTL_MS) {
		return manualLatestCache.info;
	}
	if (BUILD_CHANNEL === 'stable') {
		const info = await fetchForkLatest();
		manualLatestCache = {at: now, info};
		return info;
	}
	const response = await net.fetch(`${UPDATE_BASE_URL}/latest`, {
		cache: 'no-store',
		headers: {
			Accept: 'application/json',
			'Cache-Control': 'no-cache',
			Pragma: 'no-cache',
		},
	});
	if (!response.ok) {
		throw new Error(`Latest version request failed: ${response.status}`);
	}
	const payload = (await response.json()) as {version?: unknown; pub_date?: unknown; files?: unknown};
	if (typeof payload.version !== 'string' || payload.version.length === 0) {
		throw new Error('Latest version response missing version string');
	}
	const info: ManualLatestInfo = {
		version: payload.version,
		pubDate: typeof payload.pub_date === 'string' ? payload.pub_date : null,
		files: parseManualLatestFiles(payload.files),
	};
	manualLatestCache = {at: now, info};
	return info;
}

function sendManualUpdateAvailable(
	getMainWindow: () => BrowserWindow | null,
	context: UpdaterContext,
	latest: ManualLatestInfo,
): void {
	const downloadOptions = getManualDownloadOptions(latest);
	send(getMainWindow(), {
		type: 'available',
		context,
		version: latest.version,
		downloadUrl: getManualDownloadUrl(latest),
		...(downloadOptions.length > 0 ? {downloadOptions} : {}),
	});
}

async function checkManualUpdate(context: UpdaterContext, getMainWindow: () => BrowserWindow | null): Promise<void> {
	send(getMainWindow(), {type: 'checking', context});
	try {
		const latest = await fetchManualLatest({forceRefresh: context === 'user'});
		const current = app.getVersion();
		if (compareVersions(latest.version, current) > 0) {
			sendManualUpdateAvailable(getMainWindow, context, latest);
		} else {
			send(getMainWindow(), {type: 'not-available', context});
		}
	} catch (error) {
		log.warn('Manual update check failed', error);
		send(getMainWindow(), {type: 'error', context, message: getErrorMessage(error)});
	}
}

function registerSelfUpdater(getMainWindow: () => BrowserWindow | null): void {
	ipcMain.handle('updater-check', async (_e, context: UpdaterContext) => {
		if (context !== 'user') {
			return;
		}
		try {
			await checkDesktopUpdateNow();
			send(getMainWindow(), {type: 'not-available', context});
		} catch (error) {
			log.warn('Desktop update check failed', error);
			send(getMainWindow(), {type: 'error', context, message: getErrorMessage(error)});
		}
	});
}

function registerManualUpdater(
	getMainWindow: () => BrowserWindow | null,
	reason: 'platform' | 'unpackaged' | 'managed-package',
): void {
	ipcMain.handle('updater-check', async (_e, context: UpdaterContext) => {
		if (context === 'user') {
			try {
				await checkDesktopUpdateNow();
			} catch (error) {
				log.warn('Desktop module update check failed', error);
			}
		}
		if (reason !== 'platform') {
			send(getMainWindow(), {
				type: 'unsupported',
				context,
				reason,
				...(reason === 'unpackaged' ? {downloadUrl: DOWNLOAD_PAGE_URL} : {}),
			});
			return;
		}
		await checkManualUpdate(context, getMainWindow);
	});
}

export function registerUpdater(getMainWindow: () => BrowserWindow | null) {
	const plan = resolveShellUpdatePlan();
	switch (plan.capability) {
		case ShellUpdateCapability.SELF_UPDATE:
			registerSelfUpdater(getMainWindow);
			return;
		case ShellUpdateCapability.MANAGED_PACKAGE:
			registerManualUpdater(getMainWindow, 'managed-package');
			return;
		default:
			registerManualUpdater(getMainWindow, plan.reason);
	}
}

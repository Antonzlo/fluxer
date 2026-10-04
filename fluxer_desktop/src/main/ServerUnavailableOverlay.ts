// SPDX-License-Identifier: AGPL-3.0-or-later

import type {WebContents} from 'electron';

const OVERLAY_ID = 'fluxer-server-unavailable';
const OVERLAY_BACKGROUND_COLOR = '#1a1a1a';
const SERVER_ERROR_MIN_STATUS = 500;

export interface ServerUnavailableLabels {
	title: string;
	message: string;
	retry: string;
}

interface ServerUnavailableLogger {
	debug(message: string, detail?: Record<string, unknown>): void;
}

interface ServerUnavailableOverlayOptions {
	getLabels: () => ServerUnavailableLabels;
	isTrustedUrl: (url: string) => boolean;
	logger: ServerUnavailableLogger;
}

export function buildServerUnavailableScript(labels: ServerUnavailableLabels): string {
	return `(() => {
	const id = ${JSON.stringify(OVERLAY_ID)};
	const navigation = performance.getEntriesByType('navigation')[0];
	if (!navigation || !(navigation.responseStatus >= ${SERVER_ERROR_MIN_STATUS})) return;
	if (document.getElementById(id)) return;
	const labels = ${JSON.stringify(labels)};
	const style = (element, rules) => {
		element.style.cssText = rules;
		return element;
	};
	const host = document.createElement('div');
	host.id = id;
	style(host, 'all:initial;position:fixed;inset:0;z-index:2147483647;display:block');
	const root = host.attachShadow({mode: 'closed'});
	const panel = style(
		document.createElement('div'),
		'box-sizing:border-box;width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;font:14px/1.5 system-ui,sans-serif;background:${OVERLAY_BACKGROUND_COLOR};color:#e3e5e8',
	);
	panel.setAttribute('role', 'status');
	const spinner = style(
		document.createElement('div'),
		'width:40px;height:40px;box-sizing:border-box;border-radius:50%;border:4px solid rgba(255,255,255,.18);border-top-color:#e3e5e8;margin-bottom:8px',
	);
	spinner.setAttribute('aria-hidden', 'true');
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	spinner.animate([{transform: 'rotate(0deg)'}, {transform: 'rotate(360deg)'}], {
		duration: reducedMotion ? 3000 : 900,
		iterations: Infinity,
	});
	const title = style(document.createElement('div'), 'font-size:18px;font-weight:600');
	title.textContent = labels.title;
	const message = style(document.createElement('div'), 'max-width:420px;opacity:.7');
	message.textContent = labels.message;
	const retry = style(
		document.createElement('button'),
		'margin-top:8px;padding:6px 14px;font:inherit;border-radius:6px;border:1px solid rgba(255,255,255,.35);background:transparent;color:inherit;cursor:pointer',
	);
	retry.type = 'button';
	retry.textContent = labels.retry;
	retry.addEventListener('click', () => location.reload());
	panel.append(spinner, title, message, retry);
	root.append(panel);
	(document.body ?? document.documentElement).appendChild(host);
})();`;
}

export function attachServerUnavailableOverlay(
	webContents: WebContents,
	options: ServerUnavailableOverlayOptions,
): void {
	const {logger} = options;
	webContents.on('dom-ready', () => {
		if (webContents.isDestroyed() || !options.isTrustedUrl(webContents.getURL())) return;
		webContents.executeJavaScript(buildServerUnavailableScript(options.getLabels())).catch((error: unknown) => {
			logger.debug('Server unavailable overlay injection skipped', {error});
		});
	});
}

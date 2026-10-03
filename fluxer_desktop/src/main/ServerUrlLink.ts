// SPDX-License-Identifier: AGPL-3.0-or-later

import type {WebContents} from 'electron';
import log from 'electron-log';

const LINK_ID = 'fluxer-server-url-link';
const AUTH_PATH = /^\/(login|register|forgot|reset|invite|gift|authorize|oauth)/;

const SYNC_SCRIPT = `(() => {
	const id = ${JSON.stringify(LINK_ID)};
	const existing = document.getElementById(id);
	const show = ${AUTH_PATH}.test(location.pathname) && typeof window.electron?.openServerUrlDialog === 'function';
	if (!show) { existing?.remove(); return; }
	if (existing) return;
	const button = document.createElement('button');
	button.id = id;
	button.type = 'button';
	button.textContent = 'Change server';
	button.setAttribute('style', 'position:fixed;right:16px;bottom:16px;z-index:2147483647;padding:6px 12px;font:13px system-ui,sans-serif;border-radius:6px;border:1px solid rgba(128,128,128,.6);background:rgba(30,31,34,.85);color:#e3e5e8;cursor:pointer');
	button.addEventListener('click', () => { void window.electron.openServerUrlDialog(); });
	document.body.appendChild(button);
})();`;

function sync(webContents: WebContents): void {
	if (webContents.isDestroyed()) return;
	webContents.executeJavaScript(SYNC_SCRIPT).catch((error: unknown) => {
		log.debug('Server URL link injection skipped', error);
	});
}

export function attachServerUrlLink(webContents: WebContents): void {
	webContents.on('did-finish-load', () => sync(webContents));
	webContents.on('did-navigate-in-page', () => sync(webContents));
}

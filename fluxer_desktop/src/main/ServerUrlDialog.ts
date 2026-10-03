// SPDX-License-Identifier: AGPL-3.0-or-later

import {getAppUrl, getCustomAppUrl, normalizeCustomAppUrl, setCustomAppUrl} from '@electron/common/DesktopConfig';
import {requirePrivilegedRendererDocumentSender} from '@electron/main/PrivilegedRendererDocuments';
import {getMainWindow} from '@electron/main/Window';
import {app, BrowserWindow, ipcMain, nativeTheme} from 'electron';
import log from 'electron-log';

const RESULT_PREFIX = 'fluxer-server-url-result:';
let dialogWindow: BrowserWindow | null = null;

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function buildHtml(currentUrl: string, error: string | null): string {
	const dark = nativeTheme.shouldUseDarkColors;
	return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'">
<style>
body{font:14px system-ui,sans-serif;margin:0;padding:20px;background:${dark ? '#1e1f22' : '#fff'};color:${dark ? '#e3e5e8' : '#1f2023'}}
h1{font-size:16px;margin:0 0 6px}p{margin:0 0 12px;opacity:.7}
input[type=text]{width:100%;box-sizing:border-box;padding:8px;font:inherit;border-radius:6px;border:1px solid #888;background:transparent;color:inherit}
.err{color:#e5484d;margin:8px 0 0}.row{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid #888;background:transparent;color:inherit;cursor:pointer}
button.primary{background:#4a6cf7;border-color:#4a6cf7;color:#fff}
</style></head><body>
<form id="f">
<h1>Server URL</h1>
<p>Web client address this app should load. Leave empty for the default (fluxer.pitzuna.com). The app restarts after saving.</p>
<input type="text" name="url" value="${escapeHtml(currentUrl)}" placeholder="https://chat.example.org" autofocus spellcheck="false">
${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
<div class="row">
<button type="button" id="cancel">Cancel</button>
<button type="submit" class="primary">Save &amp; restart</button>
</div></form>
<script>
const report = (payload) => { document.title = ${JSON.stringify(RESULT_PREFIX)} + JSON.stringify(payload) + '#' + Date.now(); };
document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); report({url: document.querySelector('input').value}); });
document.getElementById('cancel').addEventListener('click', () => report({cancel: true}));
</script></body></html>`;
}

function show(win: BrowserWindow, currentUrl: string, error: string | null): void {
	void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildHtml(currentUrl, error))}`);
}

export function openServerUrlDialog(): void {
	if (dialogWindow && !dialogWindow.isDestroyed()) {
		dialogWindow.focus();
		return;
	}
	const parent = getMainWindow() ?? undefined;
	const win = new BrowserWindow({
		width: 480,
		height: 250,
		parent,
		modal: Boolean(parent),
		resizable: false,
		minimizable: false,
		maximizable: false,
		title: 'Server URL',
		autoHideMenuBar: true,
		webPreferences: {sandbox: true, contextIsolation: true, nodeIntegration: false},
	});
	dialogWindow = win;
	win.removeMenu();
	win.on('closed', () => {
		dialogWindow = null;
	});
	win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
	win.webContents.on('will-navigate', (event) => event.preventDefault());
	win.webContents.on('page-title-updated', (event, title) => {
		event.preventDefault();
		if (!title.startsWith(RESULT_PREFIX)) return;
		let result: {url?: unknown; cancel?: unknown};
		try {
			result = JSON.parse(title.slice(RESULT_PREFIX.length, title.lastIndexOf('#')));
		} catch {
			return;
		}
		if (result.cancel) {
			win.close();
			return;
		}
		const raw = typeof result.url === 'string' ? result.url.trim() : '';
		if (raw !== '' && !normalizeCustomAppUrl(raw)) {
			show(win, raw, 'Enter a valid http(s) URL.');
			return;
		}
		if (!setCustomAppUrl(raw === '' ? null : raw)) {
			show(win, raw, 'Could not save the URL.');
			return;
		}
		log.info('Server URL changed; relaunching', {appUrl: getAppUrl()});
		app.relaunch();
		app.exit(0);
	});
	show(win, getCustomAppUrl() ?? '', null);
}

export function registerServerUrlHandlers(): void {
	ipcMain.handle('server-url:open', (event) => {
		requirePrivilegedRendererDocumentSender(event, 'server-url:open');
		openServerUrlDialog();
	});
}

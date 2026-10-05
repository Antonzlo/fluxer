// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

function transform(relativePath) {
	const sourcePath = fileURLToPath(new URL(relativePath, import.meta.url));
	const code = esbuild.transformSync(fs.readFileSync(sourcePath, 'utf8'), {
		loader: 'ts',
		format: 'cjs',
		platform: 'node',
		target: 'node20',
	}).code;
	return {sourcePath, code};
}

const constantsSource = transform('../common/Constants.ts');
const desktopConfigSource = transform('../common/DesktopConfig.ts');
const globalShortcutActionsSource = transform('../common/GlobalShortcutActions.ts');
const domainMigrationSource = transform('./DomainMigration.ts');

const silentLog = {debug() {}, info() {}, warn() {}, error() {}};

function runModule({sourcePath, code}, requireStub) {
	const module = {exports: {}};
	const context = vm.createContext({
		require: requireStub,
		module,
		exports: module.exports,
		process,
		console,
		URL,
		JSON,
	});
	vm.runInContext(code, context, {filename: sourcePath});
	return module.exports;
}

function loadDesktop({channel = 'stable', settings} = {}) {
	const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxer-domain-migration-test-'));
	const settingsPath = path.join(userDataPath, 'settings.json');
	if (settings !== undefined) {
		fs.writeFileSync(settingsPath, JSON.stringify(settings), 'utf-8');
	}
	const constants = runModule(constantsSource, (specifier) => {
		throw new Error(`Unexpected import: ${specifier}`);
	});
	const globalShortcutActions = runModule(globalShortcutActionsSource, (specifier) => {
		throw new Error(`Unexpected import: ${specifier}`);
	});
	const desktopConfig = runModule(desktopConfigSource, (specifier) => {
		if (specifier === 'node:fs') return fs;
		if (specifier === '@electron/common/GlobalShortcutActions') return globalShortcutActions;
		if (specifier === 'node:path') return path;
		if (specifier === '@electron/common/BuildChannel') return {BUILD_CHANNEL: channel};
		if (specifier === '@electron/common/Constants') return constants;
		if (specifier === 'electron-log') return silentLog;
		throw new Error(`Unexpected import: ${specifier}`);
	});
	desktopConfig.loadDesktopConfig(userDataPath);
	const handlers = new Map();
	runModule(domainMigrationSource, (specifier) => {
		if (specifier === '@electron/common/DesktopConfig') return desktopConfig;
		if (specifier === '@electron/common/Logger') return {createChildLogger: () => silentLog};
		if (specifier === 'electron') {
			return {
				ipcMain: {
					handle: (name, handler) => {
						handlers.set(name, handler);
					},
				},
			};
		}
		throw new Error(`Unexpected import: ${specifier}`);
	}).registerDomainMigrationHandlers();
	const readSettings = () => JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
	const setAppOrigin = (frame, origin) => handlers.get('domain-migration:set-app-origin')({senderFrame: frame}, origin);
	return {desktopConfig, readSettings, setAppOrigin, settingsPath};
}

function topLevelFrame(url) {
	return {url, detached: false, parent: null};
}

describe('DesktopConfig app origin', () => {
	test('keeps loading the legacy root when no app origin is stored', () => {
		assert.equal(loadDesktop().desktopConfig.getAppUrl(), 'https://fluxer.pitzuna.com');
		assert.equal(loadDesktop({channel: 'canary'}).desktopConfig.getAppUrl(), 'https://web.canary.fluxer.app');
	});

	test('loads the app entry path for a stored migrated origin', () => {
		const stable = loadDesktop({settings: {app_origin: 'https://fluxer.com'}});
		const canary = loadDesktop({channel: 'canary', settings: {app_origin: 'https://canary.fluxer.com'}});

		assert.equal(stable.desktopConfig.getAppUrl(), 'https://fluxer.com/app');
		assert.equal(canary.desktopConfig.getAppUrl(), 'https://canary.fluxer.com/app');
	});

	test('loads the legacy root for a stored legacy origin', () => {
		const {desktopConfig} = loadDesktop({settings: {app_origin: 'https://fluxer.pitzuna.com'}});

		assert.equal(desktopConfig.getAppUrl(), 'https://fluxer.pitzuna.com');
	});

	test('drops stored origins outside the channel allowlist', () => {
		for (const appOrigin of [
			'https://canary.fluxer.com',
			'https://fluxer.com/',
			'https://evil.example',
			'http://fluxer.com',
			42,
		]) {
			const {desktopConfig} = loadDesktop({settings: {app_origin: appOrigin}});
			assert.equal(desktopConfig.getAppUrl(), 'https://fluxer.pitzuna.com');
		}
	});

	test('falls back from the migrated origin to the legacy root', () => {
		const stable = loadDesktop({settings: {app_origin: 'https://fluxer.com'}}).desktopConfig;
		const canary = loadDesktop({channel: 'canary', settings: {app_origin: 'https://canary.fluxer.com'}}).desktopConfig;

		assert.equal(stable.getAppUrlFallback('https://fluxer.com/app'), 'https://fluxer.pitzuna.com');
		assert.equal(stable.getAppUrlFallback('https://fluxer.com/channels/@me'), 'https://fluxer.pitzuna.com');
		assert.equal(canary.getAppUrlFallback('https://canary.fluxer.com/app'), 'https://web.canary.fluxer.app');
		assert.equal(stable.getAppUrlFallback('https://fluxer.pitzuna.com/channels/@me'), null);
		assert.equal(stable.getAppUrlFallback('https://canary.fluxer.com/app'), null);
		assert.equal(stable.getAppUrlFallback('not a url'), null);
	});

	test('the runtime override still wins over a stored origin', () => {
		const {desktopConfig} = loadDesktop({settings: {app_origin: 'https://fluxer.com'}});
		desktopConfig.setRuntimeAppUrlOverride('http://localhost:8088/');

		assert.equal(desktopConfig.getAppUrl(), 'http://localhost:8088/');
	});
});

describe('DomainMigration set app origin IPC', () => {
	test('persists an allowlisted origin from an official top-level frame', () => {
		const {desktopConfig, readSettings, setAppOrigin} = loadDesktop();

		setAppOrigin(topLevelFrame('https://fluxer.com/migrate/complete'), 'https://fluxer.com');

		assert.equal(readSettings().app_origin, 'https://fluxer.com');
		assert.equal(desktopConfig.getAppUrl(), 'https://fluxer.com/app');
	});

	test('accepts the legacy frame of the running channel', () => {
		const {readSettings, setAppOrigin} = loadDesktop({channel: 'canary'});

		setAppOrigin(topLevelFrame('https://web.canary.fluxer.app/channels/@me'), 'https://canary.fluxer.com');

		assert.equal(readSettings().app_origin, 'https://canary.fluxer.com');
	});

	test('rejects senders that are not official top-level frames of the channel', () => {
		const {setAppOrigin, settingsPath} = loadDesktop();
		const rejectedFrames = [
			null,
			topLevelFrame('https://evil.example/'),
			topLevelFrame('https://canary.fluxer.com/app'),
			{url: 'https://fluxer.com/app', detached: true, parent: null},
			{url: 'https://fluxer.com/app', detached: false, parent: topLevelFrame('https://fluxer.com/app')},
			topLevelFrame('not a url'),
		];
		for (const frame of rejectedFrames) {
			assert.throws(() => setAppOrigin(frame, 'https://fluxer.com'), /official app document/);
		}
		assert.equal(fs.existsSync(settingsPath), false);
	});

	test('rejects origins outside the channel allowlist', () => {
		const {setAppOrigin, settingsPath} = loadDesktop();
		for (const origin of ['https://canary.fluxer.com', 'https://fluxer.com/app', 'https://evil.example', null]) {
			assert.throws(() => setAppOrigin(topLevelFrame('https://fluxer.com/app'), origin), /outside the allowlist/);
		}
		assert.equal(fs.existsSync(settingsPath), false);
	});
});

describe('DesktopConfig custom app url', () => {
	test('uses a persisted app_url and treats it as the custom URL', () => {
		const {desktopConfig} = loadDesktop({settings: {app_url: 'chat.example.org'}});
		assert.equal(desktopConfig.getAppUrl(), 'https://chat.example.org/');
		assert.equal(desktopConfig.getCustomAppUrl(), 'https://chat.example.org/');
	});

	test('ignores invalid or non-http app_url values', () => {
		for (const value of ['ftp://example.org', 'javascript:alert(1)', '', 42]) {
			const {desktopConfig} = loadDesktop({settings: {app_url: value}});
			assert.equal(desktopConfig.getAppUrl(), 'https://fluxer.pitzuna.com');
			assert.equal(desktopConfig.getCustomAppUrl(), null);
		}
	});

	test('setCustomAppUrl persists, validates and clears', () => {
		const {desktopConfig, readSettings} = loadDesktop();
		assert.equal(desktopConfig.setCustomAppUrl('http://localhost:8088'), true);
		assert.equal(readSettings().app_url, 'http://localhost:8088/');
		assert.equal(desktopConfig.setCustomAppUrl('file:///etc/passwd'), false);
		assert.equal(desktopConfig.getAppUrl(), 'http://localhost:8088/');
		assert.equal(desktopConfig.setCustomAppUrl(null), true);
		assert.equal('app_url' in readSettings(), false);
		assert.equal(desktopConfig.getAppUrl(), 'https://fluxer.pitzuna.com');
	});

	test('runtime override beats the persisted app_url', () => {
		const {desktopConfig} = loadDesktop({settings: {app_url: 'https://saved.example.org'}});
		desktopConfig.setRuntimeAppUrlOverride('https://cli.example.org/');
		assert.equal(desktopConfig.getAppUrl(), 'https://cli.example.org/');
	});
});

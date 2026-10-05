// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {describe, test} from 'node:test';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const sourcePath = fileURLToPath(new URL('./ServerUnavailableOverlay.ts', import.meta.url));
const source = readFileSync(sourcePath, 'utf8');
const transformedSource = esbuild.transformSync(source, {
	loader: 'ts',
	format: 'cjs',
	platform: 'node',
	target: 'node20',
}).code;

function loadOverlayModule() {
	const module = {exports: {}};
	const context = vm.createContext({module, exports: module.exports});
	vm.runInContext(transformedSource, context, {filename: sourcePath});
	return module.exports;
}

const TRUSTED_URL = 'https://fluxer.pitzuna.com/channels/1/2';
const labels = {title: "Can't connect", message: 'Servers are "down"', retry: 'Try again'};

function createHarness({url = TRUSTED_URL, destroyed = false, rejectInjection = false} = {}) {
	const listeners = new Map();
	const scripts = [];
	const debugLogs = [];
	const webContents = {
		on(event, listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), listener]);
		},
		isDestroyed: () => destroyed,
		getURL: () => url,
		executeJavaScript(script) {
			scripts.push(script);
			return rejectInjection ? Promise.reject(new Error('Script failed to execute')) : Promise.resolve();
		},
	};
	const {attachServerUnavailableOverlay} = loadOverlayModule();
	attachServerUnavailableOverlay(webContents, {
		getLabels: () => labels,
		isTrustedUrl: (candidate) => candidate.startsWith('https://fluxer.pitzuna.com/'),
		logger: {debug: (message) => debugLogs.push(message)},
	});
	return {
		scripts,
		debugLogs,
		domReady: async () => {
			for (const listener of listeners.get('dom-ready') ?? []) listener({});
			await new Promise((resolve) => setImmediate(resolve));
		},
	};
}

describe('ServerUnavailableOverlay', () => {
	test('injects the overlay script when a trusted document is ready', async () => {
		const harness = createHarness();
		await harness.domReady();

		assert.equal(harness.scripts.length, 1);
		assert.match(harness.scripts[0], /Can't connect/);
		assert.match(harness.scripts[0], /responseStatus >= 500/);
	});

	test('skips documents from untrusted origins', async () => {
		const harness = createHarness({url: 'https://elsewhere.example/'});
		await harness.domReady();

		assert.deepEqual(harness.scripts, []);
	});

	test('skips destroyed web contents', async () => {
		const harness = createHarness({destroyed: true});
		await harness.domReady();

		assert.deepEqual(harness.scripts, []);
	});

	test('swallows injection failures', async () => {
		const harness = createHarness({rejectInjection: true});
		await harness.domReady();

		assert.equal(harness.debugLogs.length, 1);
	});

	test('keeps hostile label text inside string literals', () => {
		const {buildServerUnavailableScript} = loadOverlayModule();
		const hostile = {
			title: '"); alert(1); ("',
			message: '</script><img src=x onerror=alert(1)>',
			retry: "'\n ",
		};
		const script = buildServerUnavailableScript(hostile);

		assert.doesNotThrow(() => new vm.Script(script));
		assert.ok(script.includes(`const labels = ${JSON.stringify(hostile)};`));
	});
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import {makeAutoObservable} from 'mobx';

class VoiceTransmitting {
	private identities = new Set<string>();

	constructor() {
		makeAutoObservable(this, {}, {autoBind: true});
	}

	isTransmitting(identity: string | null | undefined): boolean {
		return identity != null && this.identities.has(identity);
	}

	set(identity: string, transmitting: boolean): void {
		if (this.identities.has(identity) === transmitting) return;
		const next = new Set(this.identities);
		if (transmitting) next.add(identity);
		else next.delete(identity);
		this.identities = next;
	}

	clear(): void {
		if (this.identities.size > 0) this.identities = new Set();
	}
}

export default new VoiceTransmitting();

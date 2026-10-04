import {resolveVoiceParticipantDisplayState} from '@app/features/voice/components/VoiceParticipantDisplayState';
import VoiceTransmitting from '@app/features/voice/state/VoiceTransmitting';
import {afterEach, describe, expect, it} from 'vitest';

const base = {
	voiceState: null,
	isLocalConnection: false,
	localSelfMute: false,
	permissionMuted: false,
};

describe('voice participant transmitting indicator', () => {
	afterEach(() => VoiceTransmitting.clear());

	it('shows transmitting without speaking when audio is sent below the speech threshold', () => {
		VoiceTransmitting.set('user_1', true);
		const state = resolveVoiceParticipantDisplayState({...base, participant: {identity: 'user_1'}});
		expect(state.speaking).toBe(false);
		expect(state.transmitting).toBe(true);
	});

	it('prefers speaking over transmitting', () => {
		VoiceTransmitting.set('user_1', true);
		const state = resolveVoiceParticipantDisplayState({
			...base,
			participant: {identity: 'user_1', isAudioLevelSpeaking: true},
		});
		expect(state.speaking).toBe(true);
		expect(state.transmitting).toBe(false);
	});

	it('hides transmitting when muted or not transmitting', () => {
		VoiceTransmitting.set('user_1', true);
		expect(
			resolveVoiceParticipantDisplayState({
				...base,
				participant: {identity: 'user_1'},
				isLocalConnection: true,
				localSelfMute: true,
			}).transmitting,
		).toBe(false);
		expect(resolveVoiceParticipantDisplayState({...base, participant: {identity: 'user_2'}}).transmitting).toBe(false);
	});
});

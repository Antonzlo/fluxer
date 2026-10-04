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

describe('remote speaking source', () => {
	afterEach(() => VoiceTransmitting.clear());

	it('ignores the server flag for a remote participant whose audio is analysed', () => {
		VoiceTransmitting.setAnalysed('user_1', true);
		const participant = {identity: 'user_1', isSpeaking: true, isAudioLevelSpeaking: false};
		expect(resolveVoiceParticipantDisplayState({...base, participant}).speaking).toBe(false);
		expect(
			resolveVoiceParticipantDisplayState({...base, participant: {...participant, isAudioLevelSpeaking: true}})
				.speaking,
		).toBe(true);
	});

	it('falls back to the server flag without an analyser and for the local participant', () => {
		const participant = {identity: 'user_1', isSpeaking: true, isAudioLevelSpeaking: false};
		expect(resolveVoiceParticipantDisplayState({...base, participant}).speaking).toBe(true);
		VoiceTransmitting.setAnalysed('user_1', true);
		expect(resolveVoiceParticipantDisplayState({...base, participant, isLocalConnection: true}).speaking).toBe(true);
	});
});

// SPDX-License-Identifier: AGPL-3.0-or-later

import {getCachedNumberFormat} from '@app/features/i18n/utils/IntlCache';
import {RESET_SLIDER_TO_DEFAULT_VALUE_DESCRIPTOR, Slider} from '@app/features/ui/components/Slider';
import {canResetSliderValue, SliderResetIconButton} from '@app/features/ui/components/slider/SliderResetIconButton';
import styles from '@app/features/user/components/modals/tabs/UserVoiceTab.module.css';
import * as VoiceSettingsCommands from '@app/features/voice/commands/VoiceSettingsCommands';
import {
	NOISE_SUPPRESSION_ADVANCED_DEFAULTS,
	NOISE_SUPPRESSION_ADVANCED_RANGES,
	type NoiseSuppressionAdvancedSettingKey,
	type NoiseSuppressionAdvancedSettings,
} from '@app/features/voice/utils/noise_suppression/NoiseSuppressionAdvancedSettings';
import type {VoiceNoiseSuppressionBackend} from '@app/features/voice/utils/noise_suppression/NoiseSuppressionBackends';
import type {MessageDescriptor} from '@lingui/core';
import {msg} from '@lingui/core/macro';
import {useLingui} from '@lingui/react/macro';
import type React from 'react';

interface AdvancedControl {
	key: NoiseSuppressionAdvancedSettingKey;
	label: MessageDescriptor;
	unit: string;
	step: number;
}

const ATTENUATION_LIMIT_DESCRIPTOR = msg({message: 'Maximum noise attenuation'});
const HIGH_PASS_CUTOFF_DESCRIPTOR = msg({message: 'High-pass cutoff'});
const GATE_OPEN_THRESHOLD_DESCRIPTOR = msg({message: 'Gate open threshold'});
const GATE_CLOSE_THRESHOLD_DESCRIPTOR = msg({message: 'Gate close threshold'});
const GATE_HOLD_TIME_DESCRIPTOR = msg({message: 'Gate hold time'});

const CONTROLS_BY_BACKEND: Partial<Record<VoiceNoiseSuppressionBackend, ReadonlyArray<AdvancedControl>>> = {
	deep_filter: [
		{key: 'deepFilterAttenLimDb', label: ATTENUATION_LIMIT_DESCRIPTOR, unit: 'dB', step: 1},
		{key: 'deepFilterHighPassHz', label: HIGH_PASS_CUTOFF_DESCRIPTOR, unit: 'Hz', step: 10},
	],
	gate: [
		{key: 'noiseGateOpenDb', label: GATE_OPEN_THRESHOLD_DESCRIPTOR, unit: 'dB', step: 1},
		{key: 'noiseGateCloseDb', label: GATE_CLOSE_THRESHOLD_DESCRIPTOR, unit: 'dB', step: 1},
		{key: 'noiseGateHoldMs', label: GATE_HOLD_TIME_DESCRIPTOR, unit: 'ms', step: 10},
	],
};

interface NoiseSuppressionAdvancedControlsProps {
	backend: VoiceNoiseSuppressionBackend;
	settings: NoiseSuppressionAdvancedSettings;
}

export const NoiseSuppressionAdvancedControls: React.FC<NoiseSuppressionAdvancedControlsProps> = ({
	backend,
	settings,
}) => {
	const {i18n} = useLingui();
	const controls = CONTROLS_BY_BACKEND[backend];
	if (!controls) return null;
	const numberFormat = getCachedNumberFormat(i18n.locale, {maximumFractionDigits: 0});
	const resetSliderLabel = i18n._(RESET_SLIDER_TO_DEFAULT_VALUE_DESCRIPTOR);
	return (
		<>
			{controls.map(({key, label, unit, step}) => {
				const {min, max} = NOISE_SUPPRESSION_ADVANCED_RANGES[key];
				const defaultValue = NOISE_SUPPRESSION_ADVANCED_DEFAULTS[key];
				const update = (value: number) => VoiceSettingsCommands.update({[key]: value});
				return (
					<div
						key={key}
						className={styles.sensitivitySliderWrapper}
						data-flx={`user.noise-suppression-advanced-controls.${key}`}
					>
						<div className={styles.sliderLabelRow} data-flx="user.noise-suppression-advanced-controls.label-row">
							<div className={styles.sliderLabel} data-flx="user.noise-suppression-advanced-controls.label">
								{i18n._(label)}
							</div>
							<SliderResetIconButton
								canReset={canResetSliderValue(settings[key], defaultValue)}
								onReset={() => update(defaultValue)}
								ariaLabel={resetSliderLabel}
								dataFlx={`user.noise-suppression-advanced-controls.reset-button.${key}`}
								data-flx="user.noise-suppression-advanced-controls.slider-reset-icon-button"
							/>
						</div>
						<Slider
							value={settings[key]}
							defaultValue={settings[key]}
							factoryDefaultValue={defaultValue}
							minValue={min}
							maxValue={max}
							step={step}
							ariaLabel={i18n._(label)}
							onValueRender={(value) => `${numberFormat.format(value)} ${unit}`}
							asValueChanges={update}
							onValueChange={update}
							data-flx="user.noise-suppression-advanced-controls.slider"
						/>
					</div>
				);
			})}
		</>
	);
};

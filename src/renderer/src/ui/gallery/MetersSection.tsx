import { useEffect, useRef, useState } from 'react';
import { VOCAL_VOLUME_UNITY } from '@shared/controls';
import {
  ControlIndicator,
  type ControlIndicatorHandle,
  type ControlIndicatorStatus,
  GlassPanel,
  LevelMeter,
  type LevelMeterHandle,
  MicrophoneIcon,
  Slider,
  SparklesIcon,
  VolumeIcon,
  WaveformIcon,
} from '../index';
import { formatDecibels } from './samples';
import { Section, Specimen, Stage } from './Section';
import styles from './MetersSection.module.css';

const STATUSES: readonly ControlIndicatorStatus[] = [
  'gesture-live',
  'holding',
  'returning',
  'lost',
  'manual',
];

export function MetersSection() {
  const [driver, setDriver] = useState(0.64);
  const horizontalRef = useRef<LevelMeterHandle>(null);
  const smallRef = useRef<LevelMeterHandle>(null);
  const verticalRef = useRef<LevelMeterHandle>(null);
  const indicatorRef = useRef<ControlIndicatorHandle>(null);

  // The driver slider feeds the imperative handles, the same path live audio and gesture
  // data will take; nothing below re-renders when the level changes.
  useEffect(() => {
    horizontalRef.current?.setLevel(driver);
    smallRef.current?.setLevel(driver);
    verticalRef.current?.setLevel(driver);
    indicatorRef.current?.setValue(driver);
  }, [driver]);

  return (
    <Section
      id="meters"
      title="Live indicators"
      description="Level meters and the edge control indicators are driven through refs, so 60 updates a second never re-render React. Drag the driver to feed them."
    >
      <Stage layout="row">
        {STATUSES.map((status) => (
          <Specimen key={status} label={status}>
            <ControlIndicator
              label="Autotune"
              icon={<SparklesIcon />}
              status={status}
              value={0.64}
              data-testid={`indicator-${status}`}
            />
          </Specimen>
        ))}
        <Specimen label="unity notch">
          <ControlIndicator
            label="Volume"
            icon={<VolumeIcon />}
            status="gesture-live"
            value={VOCAL_VOLUME_UNITY}
            unityValue={VOCAL_VOLUME_UNITY}
          />
        </Specimen>
        <Specimen label="dB readout">
          <ControlIndicator
            label="Volume"
            icon={<VolumeIcon />}
            status="manual"
            value={0}
            unityValue={VOCAL_VOLUME_UNITY}
            formatValue={formatDecibels}
            data-testid="demo-indicator-db"
          />
          <ControlIndicator
            label="Volume"
            icon={<VolumeIcon />}
            status="manual"
            value={0.75}
            unityValue={VOCAL_VOLUME_UNITY}
            formatValue={formatDecibels}
            size="sm"
          />
        </Specimen>
        <Specimen label="small">
          <ControlIndicator
            label="Echo"
            icon={<WaveformIcon />}
            status="gesture-live"
            value={0.3}
            size="sm"
          />
          <ControlIndicator
            label="Echo"
            icon={<WaveformIcon />}
            status="lost"
            value={0}
            size="sm"
          />
        </Specimen>
        <Specimen label="driven by ref">
          <ControlIndicator
            ref={indicatorRef}
            label="Echo"
            icon={<WaveformIcon />}
            status="gesture-live"
            data-testid="demo-indicator"
          />
        </Specimen>
      </Stage>

      <Stage backdrop="white" layout="row">
        {STATUSES.map((status) => (
          <Specimen key={status} label={`on white: ${status}`}>
            <ControlIndicator
              label="Autotune"
              icon={<SparklesIcon />}
              status={status}
              value={0.64}
            />
          </Specimen>
        ))}
      </Stage>

      <Stage layout="row">
        <GlassPanel variant="strong" padding="lg" className={styles.meters}>
          <Slider
            label="Driver"
            value={driver}
            onChange={setDriver}
            data-testid="demo-meter-driver"
          />
          <div className={styles.meterRow}>
            <MicrophoneIcon size={16} />
            <LevelMeter
              ref={horizontalRef}
              label="Microphone level"
              data-testid="demo-meter-horizontal"
            />
          </div>
          <div className={styles.meterRow}>
            <MicrophoneIcon size={16} />
            <LevelMeter ref={smallRef} label="Microphone level (small)" size="sm" />
          </div>
        </GlassPanel>
        <GlassPanel variant="strong" padding="lg" className={styles.verticalMeters}>
          <LevelMeter
            ref={verticalRef}
            label="Microphone level"
            orientation="vertical"
            data-testid="demo-meter-vertical"
          />
        </GlassPanel>
      </Stage>
    </Section>
  );
}

// Holographic Studio design system. Importing anything from here also loads the design
// tokens and the global base styles, so screens only ever need this one import.
//
// Conventions shared by every component:
// - `className` and `style` go to the component's outermost element.
// - Every other DOM attribute (`id`, `data-*`, `aria-*`, event handlers) is forwarded to
//   the element that carries the component's role. That is the outermost element, except
//   for Slider (the `role="slider"` element), Select (the <select>) and ProgressBar (the
//   `role="progressbar"` track). Handlers a component needs for itself are not accepted.
// - `ref`, where offered, points at that same element; LevelMeter and ControlIndicator
//   expose an imperative handle instead.
// - `label` is always the accessible name. Components with a caption of their own (Slider,
//   ProgressBar, ControlIndicator, FileDropZone, Field, FormRow) also show it.
import './global.css';

export { AppMark, type AppMarkProps } from './AppMark';
export { Banner, type BannerProps, type BannerTone } from './Banner';
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';
export {
  Chip,
  type ChipProps,
  type ChipSize,
  type ChipTone,
  StatusChip,
  type StatusChipProps,
  type StatusChipState,
} from './Chip';
export {
  ControlIndicator,
  type ControlIndicatorHandle,
  type ControlIndicatorProps,
  type ControlIndicatorSize,
  type ControlIndicatorStatus,
} from './ControlIndicator';
export {
  Field,
  type FieldControlProps,
  type FieldProps,
  FormRow,
  type FormRowProps,
  FormSection,
  type FormSectionProps,
  useFieldControlProps,
} from './Field';
export { FileDropZone, type FileDropZoneProps, type FileDropZoneState } from './FileDropZone';
export { describeExtensions, fileExtension, isAcceptedFileName } from './fileExtensions';
export {
  GlassPanel,
  type GlassElement,
  type GlassElevation,
  type GlassPadding,
  type GlassPanelProps,
  type GlassRadius,
  type GlassVariant,
} from './GlassPanel';
export {
  IconButton,
  type IconButtonProps,
  type IconButtonSize,
  type IconButtonVariant,
} from './IconButton';
export * from './icons';
export { cx, type ClassValue } from './internal/classNames';
export { formatPercent } from './internal/numberFormat';
export { Kbd } from './Kbd';
export {
  LevelMeter,
  type LevelMeterHandle,
  type LevelMeterOrientation,
  type LevelMeterProps,
  type LevelMeterSize,
} from './LevelMeter';
export { amplitudeToMeterLevel, decibelsToMeterLevel, DEFAULT_METER_FLOOR_DB } from './meterScale';
export { Modal, type ModalProps, type ModalSize } from './Modal';
export { ProgressBar, type ProgressBarProps, type ProgressBarSize } from './ProgressBar';
export { ProgressRing, type ProgressRingProps } from './ProgressRing';
export {
  RecordButton,
  type RecordButtonProps,
  type RecordButtonSize,
  type RecordButtonState,
} from './RecordButton';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedControlSize,
  type SegmentedOption,
} from './SegmentedControl';
export { Select, type SelectOption, type SelectProps } from './Select';
export { Sheet, type SheetProps } from './Sheet';
export { Slider, type SliderProps } from './Slider';
export { Spinner, type SpinnerProps, type SpinnerSize, type SpinnerTone } from './Spinner';
export { Stepper, type StepperProps, type StepperStep, type StepperVariant } from './Stepper';
export { Toast, type ToastProps } from './Toast';
export {
  createToastStore,
  DEFAULT_TOAST_DURATION_MS,
  type ToastAction,
  type ToastInput,
  type ToastRecord,
  type ToastStore,
  type ToastStoreOptions,
  type ToastTone,
  toastStore,
} from './toastStore';
export { type ToastPlacement, ToastViewport, type ToastViewportProps } from './ToastViewport';
export { Toggle, type ToggleProps } from './Toggle';
export { Tooltip, type TooltipPlacement, type TooltipProps } from './Tooltip';
export { VisuallyHidden } from './VisuallyHidden';

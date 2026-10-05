import {
  createContext,
  type HTMLAttributes,
  type ReactNode,
  useContext,
  useId,
  useMemo,
} from 'react';
import { cx } from './internal/classNames';
import styles from './Field.module.css';

interface FieldWiring {
  controlId: string;
  labelId: string;
  hintId: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldWiring | null>(null);

export interface FieldControlProps {
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: HTMLAttributes<HTMLElement>['aria-invalid'];
}

/**
 * Accessibility wiring for a control rendered inside a Field or FormRow: spread the result on
 * the focusable element (after the caller's own attributes) and the control is named by the
 * field's label, described by its hint and marked invalid while the field shows an error.
 *
 * `own` is what the control was given directly; it is merged in rather than lost. A name of
 * its own (`aria-label` or `aria-labelledby`) replaces the field's label, an own
 * `aria-describedby` is added to the hint, and the field's id always wins because its
 * <label> points at it. Outside a field the own attributes come back unchanged.
 */
export function useFieldControlProps(own: FieldControlProps = {}): FieldControlProps {
  const field = useContext(FieldContext);
  const hasOwnName = own['aria-label'] !== undefined || own['aria-labelledby'] !== undefined;
  return {
    id: field?.controlId ?? own.id,
    'aria-label': own['aria-label'],
    'aria-labelledby': hasOwnName ? own['aria-labelledby'] : field?.labelId,
    'aria-describedby': cx(field?.hintId, own['aria-describedby']) || undefined,
    'aria-invalid': field?.invalid ? true : own['aria-invalid'],
  };
}

/**
 * A <label> focuses (or toggles) native controls by itself. The slider and the segmented
 * control are not native form elements, so a click on their label is passed on by hand.
 */
function focusCustomControl(controlId: string): void {
  const control = document.getElementById(controlId);
  if (!control || control.matches('button, input, select, textarea, [aria-disabled="true"]')) {
    return;
  }
  const target = control.matches('[tabindex]')
    ? control
    : control.querySelector<HTMLElement>('[tabindex="0"]');
  target?.focus();
}

interface FieldBaseProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: string;
  /** Short helper text under the label (FormRow) or under the control (Field). */
  hint?: string;
  /** The control. Design-system controls pick up the label and hint automatically. */
  children: ReactNode;
}

function useFieldWiring(hasHint: boolean, invalid: boolean): FieldWiring {
  const baseId = useId();
  return useMemo(
    () => ({
      controlId: `${baseId}-control`,
      labelId: `${baseId}-label`,
      hintId: hasHint ? `${baseId}-hint` : undefined,
      invalid,
    }),
    [baseId, hasHint, invalid],
  );
}

export interface FieldProps extends FieldBaseProps {
  /** Replaces the hint, is announced immediately, and marks the control as invalid. */
  error?: string;
}

/** Stacked layout: label above the control, hint or error below. For full-width controls. */
export function Field({ label, hint, error, children, className, ...rest }: FieldProps) {
  const message = error ?? hint;
  const wiring = useFieldWiring(message !== undefined, error !== undefined);

  return (
    <FieldContext.Provider value={wiring}>
      <div {...rest} className={cx(styles.field, className)}>
        <label
          id={wiring.labelId}
          htmlFor={wiring.controlId}
          className={styles.fieldLabel}
          onClick={() => focusCustomControl(wiring.controlId)}
        >
          {label}
        </label>
        {children}
        {message && (
          <p
            id={wiring.hintId}
            className={cx(styles.hint, error && styles.error)}
            role={error ? 'alert' : undefined}
          >
            {message}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

export type FormRowProps = FieldBaseProps;

/** Settings-style row: label and hint on the left, a compact control on the right. */
export function FormRow({ label, hint, children, className, ...rest }: FormRowProps) {
  const wiring = useFieldWiring(hint !== undefined, false);

  return (
    <FieldContext.Provider value={wiring}>
      <div {...rest} className={cx(styles.row, className)}>
        <div className={styles.rowText}>
          <label
            id={wiring.labelId}
            htmlFor={wiring.controlId}
            className={styles.rowLabel}
            onClick={() => focusCustomControl(wiring.controlId)}
          >
            {label}
          </label>
          {hint && (
            <p id={wiring.hintId} className={styles.hint}>
              {hint}
            </p>
          )}
        </div>
        <div className={styles.rowControl}>{children}</div>
      </div>
    </FieldContext.Provider>
  );
}

export interface FormSectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'children'> {
  title: string;
  /** FormRows (separated by hairlines) or any other controls. */
  children: ReactNode;
}

/** A titled group of related rows, as in a settings panel. */
export function FormSection({ title, children, className, ...rest }: FormSectionProps) {
  const titleId = useId();

  return (
    <section {...rest} aria-labelledby={titleId} className={cx(styles.section, className)}>
      <h3 id={titleId} className={styles.sectionTitle}>
        {title}
      </h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

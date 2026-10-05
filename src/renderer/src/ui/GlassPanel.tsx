import type { HTMLAttributes, Ref } from 'react';
import { cx } from './internal/classNames';
import styles from './GlassPanel.module.css';

/** How much of the backdrop shows through. Use `strong` where there is a lot of text. */
export type GlassVariant = 'subtle' | 'regular' | 'strong';
export type GlassElevation = 'flat' | 'raised' | 'floating';
export type GlassRadius = 'sm' | 'md' | 'lg' | 'xl' | 'pill';
export type GlassPadding = 'none' | 'sm' | 'md' | 'lg';
export type GlassElement = 'div' | 'section' | 'aside' | 'header' | 'footer' | 'nav' | 'span';

export interface GlassPanelProps extends HTMLAttributes<HTMLElement> {
  as?: GlassElement;
  variant?: GlassVariant;
  elevation?: GlassElevation;
  radius?: GlassRadius;
  padding?: GlassPadding;
  ref?: Ref<HTMLElement>;
}

/** The basic translucent surface every floating control sits on. */
export function GlassPanel({
  as: Element = 'div',
  variant = 'regular',
  elevation = 'raised',
  radius = 'lg',
  padding = 'md',
  className,
  ref,
  ...rest
}: GlassPanelProps) {
  return (
    <Element
      // The element type is a union of tags whose ref types differ only nominally.
      ref={ref as Ref<never>}
      className={cx(
        styles.panel,
        styles[`variant-${variant}`],
        styles[`elevation-${elevation}`],
        styles[`radius-${radius}`],
        styles[`padding-${padding}`],
        className,
      )}
      {...rest}
    />
  );
}

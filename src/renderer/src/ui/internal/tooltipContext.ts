import { createContext } from 'react';

/**
 * True inside a Tooltip. Controls that would show their name as a native `title` tooltip
 * leave it out there, so the hint never appears twice.
 */
export const InsideTooltipContext = createContext(false);

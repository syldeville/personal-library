// Maps reading preferences to CSS values, shared by the text and EPUB readers.
import { prefs, SIZES } from '../store.js';

export const FONTS = {
  literata: { label: 'Literata', css: "'Literata', Georgia, serif" },
  georgia: { label: 'Georgia', css: "Georgia, 'Times New Roman', serif" },
  sans: { label: 'Sans', css: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif" },
};
export const SPACING = { tight: ['Tight', 1.4], normal: ['Normal', 1.6], loose: ['Loose', 1.85] };
export const MARGINS = { narrow: ['Narrow', 16], normal: ['Normal', 28], wide: ['Wide', 44] };

export function textStyle() {
  return {
    size: SIZES[Math.max(0, Math.min(SIZES.length - 1, prefs.size))],
    font: (FONTS[prefs.font] || FONTS.literata).css,
    lead: (SPACING[prefs.spacing] || SPACING.normal)[1],
    margin: (MARGINS[prefs.margins] || MARGINS.normal)[1],
    align: prefs.justify ? 'justify' : 'left',
  };
}

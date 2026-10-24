# UI Design System: APAAR-linked student registry prototype (SIH 2026, PS 26263)

Light, regular government-portal theme modelled on the style of gst.gov.in and the UX4G / GIGW 3.0 conventions.

**Read this first**
- This is an approximation of the GST portal style, not a pixel copy. The portal's stylesheet could not be read, so exact shades were not extracted. Use a browser eyedropper on the live site if you need an exact match.
- The base hues come from the GST Council logo colours (orange `#F37A1F`, green `#00A652`, blue `#26538C`) as listed by a third-party brand-colour site. Orange and green are darkened wherever white text sits on them, because the raw values fail contrast.
- Contrast ratios were calculated by hand. Run Lighthouse or axe before claiming WCAG 2.1 AA / GIGW 3.0 alignment.
- Do not copy the GST logo or wording. Use your own logo and a placeholder emblem. Do not present the prototype as an official AICTE system.

## 1. Page layout

Follow the GST portal structure and the UX4G header pattern:

1. **Utility strip:** Skip to Main Content link, A- / A / A+ text-size controls, language selector, high-contrast toggle.
2. **Header:** logo and site title on the left, Register / Login buttons on the right.
3. **Nav bar:** navy, white text, active item with a 3px bright-orange underline.
4. **Home blocks:** news and updates banner, popular help topics list, help desk number with grievance link, upcoming due dates panel, media section.
5. **Footer:** navy, white links, line "Prototype for SIH 2026, not an official AICTE system", last-updated date, help number, back-to-top link.

## 2. Colour palette

| Role | Hex | Use |
| --- | --- | --- |
| Primary blue | `#26538C` | Primary buttons, links, active states |
| Navy | `#17375E` | Nav bar, footer, pressed state, headings |
| Primary hover | `#1B3F6E` | Hover on blue |
| Accent orange (text-safe) | `#B84F0A` | Orange buttons with white text |
| Accent orange (bright) | `#F37A1F` | Underlines, icons, chart series. Never behind white text |
| Success green | `#0B7A3E` | Verified badge, Approve button |
| Green (bright) | `#00A652` | Icons and fills only |
| Error red | `#C62828` | Errors, Deny, delete |
| Warning | fill `#FFF4D6`, border `#B26A00`, text `#6B4200` | Flagged items |
| Info tint | `#E8EFF7` | Table header, info banner, selected row, utility strip |
| Page background | `#F4F6F9` | Behind cards |
| Surface | `#FFFFFF` | Cards, forms, tables |
| Border | `#CBD2D9` | Cards, dividers |
| Input border | `#7B8794` | Form fields (3:1 or better on white) |
| Text | `#1F2933` | Body text |
| Muted text | `#52606D` | Captions, hints |

**Role chips** (small, outlined, never used to recolour the page): Institution teal `#0F766E`, AICTE navy `#17375E`, Student green `#0B7A3E`, Verifier / University purple `#6B3FA0`.

**Chart series order:** blue `#26538C`, orange `#F37A1F`, green `#0B7A3E`, purple `#6B3FA0`, grey `#7B8794`. Add labels or patterns so colour is never the only cue.

### CSS tokens

```css
:root{
  --blue:#26538C; --blue-hover:#1B3F6E; --navy:#17375E;
  --orange:#B84F0A; --orange-bright:#F37A1F;
  --green:#0B7A3E; --red:#C62828;
  --warn-bg:#FFF4D6; --warn-border:#B26A00; --warn-text:#6B4200;
  --tint:#E8EFF7; --bg:#F4F6F9; --surface:#FFFFFF;
  --border:#CBD2D9; --input-border:#7B8794;
  --text:#1F2933; --muted:#52606D;
  --radius:4px; --focus:3px solid #B84F0A;
}
```

## 3. Buttons

### Rules for every button
- 4px radius, flat fill, no gradient, no shadow.
- Height 40px on desktop, 44px on touch. Padding `10px 20px`, minimum width 96px.
- Text 16px, weight 600, sentence case ("Upload file", not "UPLOAD FILE").
- Icon: outline, 16-20px, on the left, 8px gap.
- Focus: 3px solid `#B84F0A` ring, 2px offset (white ring on dark backgrounds). Must always be visible on keyboard focus.
- Disabled: background `#E4E7EB`, text `#6B7785`, `not-allowed` cursor.
- Loading: spinner plus "Uploading...", `aria-busy="true"`, clicks disabled.
- One primary button per view. Primary first (left), then Cancel.

### Variants

| Variant | Fill | Text | Border | Hover | Use |
| --- | --- | --- | --- | --- | --- |
| Primary | `#26538C` | white | none | `#1B3F6E` | Upload, Submit, Verify |
| Accent | `#B84F0A` | white | none | `#9A4008` | Login, Register, top-right actions only |
| Secondary | white | `#26538C` | 2px `#26538C` | fill `#E8EFF7` | Download template, Cancel |
| Tertiary | none | `#26538C` | none | underline | View details, Re-upload |
| Success | `#0B7A3E` | white | none | `#08632F` | Approve consent |
| Danger | `#C62828` | white | none | `#A31F1F` | Deny, Delete draft |
| Danger outline | white | `#C62828` | 2px `#C62828` | fill `#FDECEC` | Secondary destructive actions |

## 4. Other elements

- **Cards:** white, 1px `#CBD2D9` border, 4px radius, 16-24px padding, 3px blue top border. No heavy shadows. One subtle shadow level for modals and dropdowns only.
- **KPI tiles:** large navy number, muted label below, thin coloured left border for status.
- **Tables:** header row `#E8EFF7` with bold navy text; 1px row borders; hover row `#EEF3F9`; sticky header; numbers right-aligned.
- **Status badges:** pill shape with icon and text, never colour alone. Valid = green, Error = red, Flagged = amber, Pending = grey.
- **Forms:**
  - Labels above fields; 40px inputs; 1px `#7B8794` border; 4px radius.
  - Required fields: red asterisk plus the word "required" for screen readers.
  - Errors appear below the field in red text with an icon, and the border becomes 2px red.
- **Alerts:** 4px left border, tinted fill, icon. Info = blue tint `#E8EFF7`, success = `#E6F4EC` with green border, warning = amber, error = `#FDECEC` with red border.
- **Links:** `#26538C`, underlined; hover `#17375E`.
- **Tabs:** 3px blue underline on the active tab.
- **Stepper (upload flow):** numbered circles; completed steps filled green.
- **Modals:** white, 4px radius, overlay `rgba(23,55,94,0.6)`.
- **Typography:** Noto Sans (covers Devanagari for Hindi). Body 16px, line height 1.5. Headings bold. Page title 28px.
- **Spacing and icons:** 4/8px spacing scale. Outline icons, 1.5px stroke, 24px in navigation.

## 5. Accessibility checklist

- [ ] Skip link is the first focusable element
- [ ] A- / A / A+ controls work and text resizes up to 150% without loss of content
- [ ] High-contrast toggle works
- [ ] Every interactive element has a visible focus ring
- [ ] No information is carried by colour alone (badges, alerts, charts)
- [ ] Body text contrast at least 4.5:1, UI borders and focus rings at least 3:1
- [ ] Lighthouse / axe run before putting "WCAG 2.1 AA" or "GIGW 3.0 aligned" on a slide. If not met, say "built on UX4G-style components" instead

## 6. Sources

- GST portal page structure: https://www.gst.gov.in/
- GST Council logo colours (third-party listing): https://brandpalettes.com/gst-council-logo-colors/
- UX4G design system (MeitY): https://ux4g.gov.in/foundations and https://ux4g.gov.in/components/header
- GIGW 3.0: https://guidelines.india.gov.in/
- APAAR portal (structure reference): https://apaar.education.gov.in

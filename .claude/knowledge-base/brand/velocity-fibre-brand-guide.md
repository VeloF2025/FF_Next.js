# Velocity Fibre Brand Guide

**Source:** Extracted from https://www.velocityfibre.co.za (January 2026)
**Logo:** `docs/user-manuals/assets/velocity-logo.jpg`

---

## Color Palette

### Primary Colors
| Name | Hex | RGB | Usage |
|------|-----|-----|-------|
| **Navy** | `#023047` | rgb(2, 48, 71) | Primary brand, headings, navigation, headers |
| **Blue** | `#1e73be` | rgb(30, 115, 190) | Secondary buttons, CTAs |
| **Teal** | `#219ebc` | rgb(33, 158, 188) | Accent, highlights, table headers, badges |
| **Sky Blue** | `#2ea3f2` | rgb(46, 163, 242) | Links, hover states, interactive elements |

### Supporting Colors
| Name | Hex | Usage |
|------|-----|-------|
| **Body Gray** | `#3c3a47` | Body text |
| **Light Gray** | `#f9f9f9` | Backgrounds, alternating rows |
| **Border** | `#e8e8e8` | Table borders, dividers |
| **Success** | `#28a745` | Success states, completed |
| **Warning** | `#ffc107` | Warning states, pending |
| **Danger** | `#dc3545` | Error states, critical |

### CSS Variables
```css
:root {
  --vf-navy: #023047;
  --vf-blue: #1e73be;
  --vf-teal: #219ebc;
  --vf-sky: #2ea3f2;
  --vf-body: #3c3a47;
  --vf-gray-bg: #f9f9f9;
  --vf-border: #e8e8e8;
}
```

---

## Typography

### Font Families
| Font | Weights | Usage |
|------|---------|-------|
| **IBM Plex Sans** | 400, 500, 600, 700 | Body text, paragraphs, UI |
| **IBM Plex Sans Condensed** | 400, 500, 600 | Headings, titles, headers |

### Google Fonts Import
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Sans+Condensed:wght@400;500;600&display=swap" rel="stylesheet">
```

### Font Sizes
| Element | Size | Weight | Font |
|---------|------|--------|------|
| H1 | 28px | 700 | Condensed |
| H2 | 22px | 600 | Condensed |
| H3 | 18px | 600 | Condensed |
| H4 | 16px | 600 | Condensed |
| Body | 14px | 400 | Regular |
| Small | 12px | 400 | Regular |
| Caption | 10px | 400 | Regular |

---

## Logo Usage

### Horizontal Logo
- File: `docs/user-manuals/assets/velocity-logo.jpg`
- Source: `https://www.velocityfibre.co.za/wp-content/uploads/2025/04/Velocity-Logo.jpg`
- Gradient: Navy (#023047) to Maroon (#8b1538)
- Accent: Teal dot (#219ebc)

### Clear Space
- Maintain minimum clear space equal to the height of the "V" in Velocity
- Never place on busy backgrounds without contrast

### Minimum Size
- Print: 25mm width
- Digital: 120px width

---

## UI Components

### Buttons

**Primary Button (Navy)**
```css
.btn-primary {
  background: #023047;
  color: white;
  border-radius: 100px;  /* Pill shape */
  padding: 12px 28px;
  font-weight: 600;
  font-family: 'IBM Plex Sans', sans-serif;
}
```

**Secondary Button (White)**
```css
.btn-secondary {
  background: white;
  color: #023047;
  border: 2px solid #023047;
  border-radius: 100px;
  padding: 12px 28px;
}
```

**Accent Button (Teal)**
```css
.btn-accent {
  background: #219ebc;
  color: white;
  border-radius: 100px;
  padding: 12px 28px;
}
```

### Tables

```css
table {
  border-collapse: collapse;
  width: 100%;
}

th {
  background: #219ebc;  /* Teal header */
  color: white;
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
}

td {
  padding: 12px 16px;
  border-bottom: 1px solid #e8e8e8;
}

tr:nth-child(even) {
  background: #f9f9f9;
}
```

### Cards

```css
.card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
  padding: 24px;
}

.card-header {
  border-bottom: 3px solid #219ebc;  /* Teal accent */
  padding-bottom: 16px;
  margin-bottom: 16px;
}
```

### Badges/Tags

```css
.badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}

.badge-teal {
  background: rgba(33, 158, 188, 0.15);
  color: #219ebc;
}

.badge-navy {
  background: rgba(2, 48, 71, 0.1);
  color: #023047;
}
```

---

## Document Templates

### Header/Footer Pattern
```css
.header {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px;
  color: #023047;
  padding: 10px 20mm;
  display: flex;
  justify-content: space-between;
  border-bottom: 1px solid #e8e8e8;
}

.footer {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 9px;
  color: #666;
  padding: 10px 20mm;
  display: flex;
  justify-content: space-between;
  border-top: 1px solid #e8e8e8;
}
```

### Cover Page Layout
```markdown
<!-- Cover Page -->
<div class="cover-page">
  <img src="velocity-logo.jpg" class="cover-logo" alt="Velocity Fibre">
  <h1 class="cover-title">Document Title</h1>
  <p class="cover-subtitle">Subtitle or Type</p>
  <div class="cover-meta">
    <p><strong>Version:</strong> 1.0</p>
    <p><strong>Date:</strong> January 2026</p>
    <p><strong>Classification:</strong> Internal Use</p>
  </div>
</div>
```

---

## Design Patterns

### Visual Hierarchy
1. **Navy (#023047)** - Most important elements (headings, primary actions)
2. **Teal (#219ebc)** - Accent and highlight (table headers, active states)
3. **Blue (#1e73be)** - Secondary actions
4. **Body Gray (#3c3a47)** - Content text

### Spacing Scale
```
4px  - Micro spacing (badge padding)
8px  - Small spacing (icon gaps)
12px - Medium spacing (element padding)
16px - Standard spacing (card padding)
24px - Large spacing (section gaps)
32px - XL spacing (major sections)
48px - XXL spacing (page sections)
```

### Border Radius Scale
```
4px   - Small elements (inputs, small badges)
8px   - Medium elements (cards, modals)
12px  - Large elements (hero cards)
100px - Pills (buttons, tags)
50%   - Circles (avatars, indicators)
```

---

## Accessibility

### Contrast Ratios
| Combination | Ratio | WCAG |
|-------------|-------|------|
| Navy on White | 13.4:1 | AAA |
| Teal on White | 3.7:1 | AA (large text) |
| Body Gray on White | 9.2:1 | AAA |
| White on Navy | 13.4:1 | AAA |
| White on Teal | 3.7:1 | AA (large text) |

### Focus States
```css
:focus {
  outline: 2px solid #2ea3f2;
  outline-offset: 2px;
}
```

---

## File References

| Asset | Location |
|-------|----------|
| Logo (JPG) | `docs/user-manuals/assets/velocity-logo.jpg` |
| Maintenance Manual | `docs/user-manuals/source/maintenance.md` |
| Generated PDF | `docs/user-manuals/pdf/maintenance.pdf` |
| Manual Skill | `.claude/skills/manual.md` |

---

*Last Updated: 2026-01-27*

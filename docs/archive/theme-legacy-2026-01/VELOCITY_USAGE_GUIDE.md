# VELOCITY Theme Usage Guide

## Overview

The VELOCITY theme is a premium, high-tech theme featuring:
- Glassmorphism effects with backdrop blur
- 8-level elevation system with ambient lighting
- Neon accent colors and effects
- Premium gradient system
- Advanced animation configurations
- Performance optimizations for mobile devices

## Quick Start

### Basic Usage

```tsx
import { velocityTheme, useVelocityTheme } from '@/config/themes';

function MyComponent() {
  const { styles, utils, theme } = useVelocityTheme({
    autoApplyVariables: true,
    optimizePerformance: true
  });

  return (
    <div style={styles.card.default}>
      <h1 style={{ color: theme.colors.neon?.cyan }}>
        VELOCITY Theme
      </h1>
    </div>
  );
}
```

### CSS Classes (Alternative)

```tsx
import '@/config/themes/velocityStyles.css';

function MyComponent() {
  return (
    <div className="velocity-card velocity-hover-lift">
      <h1 className="velocity-neon-cyan">VELOCITY Theme</h1>
    </div>
  );
}
```

## Key Features

### 1. Glassmorphism Effects

```tsx
// Light glass effect
<div style={styles.glass.light}>Content</div>

// Medium glass effect
<div style={styles.glass.medium}>Content</div>

// Heavy glass effect
<div style={styles.glass.heavy}>Content</div>

// Ultra premium glass effect
<div style={styles.glass.ultra}>Content</div>
```

### 2. Elevation System

```tsx
// Apply elevation levels 1-8
<div style={utils.getElevation(4)}>
  Elevated content with ambient glow
</div>

// Responsive elevation (reduces on mobile)
<div style={utils.getResponsiveElevation(6)}>
  Smart elevation for all devices
</div>
```

### 3. Neon Effects

```tsx
// Apply neon effects
<div style={utils.getNeonEffect('cyan')}>Cyan neon</div>
<div style={utils.getNeonEffect('purple')}>Purple neon</div>
<div style={utils.getNeonEffect('laser')}>Laser effect</div>
```

### 4. Premium Gradients

```tsx
// Use built-in gradients
<div style={styles.gradients.holographic}>
  Holographic background
</div>

<div style={styles.gradients.plasma}>
  Plasma effect
</div>

<div style={styles.gradients.aurora}>
  Aurora gradient
</div>
```

### 5. Interactive Buttons

```tsx
// Primary glassmorphism button
<button style={styles.button.primary}>
  Primary Action
</button>

// Neon outline button
<button style={styles.button.neon}>
  Neon Button
</button>
```

## Dynamic Styling

### Create Custom Effects

```tsx
import { useVelocityDynamicStyles } from '@/config/themes';

function CustomComponent() {
  const dynamic = useVelocityDynamicStyles();

  return (
    <div style={dynamic.createGlassEffect(0.15, 24, 0.3)}>
      Custom glass with 15% transparency, 24px blur
    </div>
  );
}
```

### Custom Gradients

```tsx
const customGradient = dynamic.createCustomGradient([
  '#00f5ff', 
  '#6366f1', 
  '#8a2be2'
], '45deg');

<div style={customGradient}>Custom gradient</div>
```

### Custom Neon Effects

```tsx
const customNeon = dynamic.createNeonEffect('255, 20, 147', 1.5);

<div style={customNeon}>Custom pink laser effect</div>
```

## Responsive Design

### Automatic Optimization

```tsx
import { useVelocityResponsive } from '@/config/themes';

function ResponsiveComponent() {
  const responsive = useVelocityResponsive();

  return (
    <div style={responsive.getResponsiveGlass('ultra')}>
      {/* Automatically reduces to 'medium' on mobile */}
      Content with smart glass effects
    </div>
  );
}
```

### Media Queries

```tsx
const { mediaQueries } = useVelocityResponsive();

const styles = {
  container: {
    padding: '2rem',
    [mediaQueries.mobile]: {
      padding: '1rem'
    }
  }
};
```

## Accessibility

### Reduced Motion Support

```tsx
import { useVelocityA11y } from '@/config/themes';

function AccessibleComponent() {
  const a11y = useVelocityA11y();

  return (
    <button 
      style={{
        ...styles.button.primary,
        ...(a11y.prefersReducedMotion() && { transition: 'none' })
      }}
    >
      Respects user preferences
    </button>
  );
}
```

### Focus Styles

```tsx
const focusStyles = a11y.getFocusStyles();

<button style={{ ...buttonStyles, ':focus': focusStyles }}>
  Accessible button
</button>
```

### High Contrast Mode

```tsx
const accessibleColors = a11y.getAccessibleColors();

<div style={{ 
  color: a11y.prefersHighContrast() 
    ? accessibleColors.text.primary 
    : theme.colors.text.primary 
}}>
  High contrast aware text
</div>
```

## Performance Optimization

### Automatic Optimizations

The theme automatically:
- Reduces glass effects on mobile devices
- Disables expensive animations on older devices
- Respects `prefers-reduced-motion`
- Optimizes shadow complexity based on device capabilities

### Manual Performance Control

```tsx
const optimizedStyle = utils.getPerformanceOptimizedStyle({
  backdropFilter: 'blur(20px)',
  boxShadow: 'complex shadow...'
});
// Automatically removes unsupported properties on older devices
```

## CSS Custom Properties

### Auto-Apply Variables

```tsx
// Applies all VELOCITY CSS variables to document root
const { applyCSSVariables } = useVelocityTheme();

useEffect(() => {
  applyCSSVariables();
}, []);
```

### Available Variables

```css
/* Colors */
--velocity-primary-500: #0066ff;
--velocity-neon-cyan: #00f5ff;

/* Elevation */
--velocity-elevation-1: /* shadow definition */;
--velocity-elevation-8: /* maximum shadow */;

/* Glass */
--velocity-glass-backdrop-light: blur(8px) saturate(150%);
--velocity-glass-transparency-medium: rgba(26, 31, 46, 0.75);

/* Effects */
--velocity-neon-cyan: /* neon glow effect */;
--velocity-glow-strong: /* strong glow */;

/* Gradients */
--velocity-gradient-holographic: /* gradient definition */;
--velocity-gradient-plasma: /* plasma gradient */;
```

## Theme Integration

### Theme Context

```tsx
import { ThemeProvider } from '@/contexts/ThemeContext';

<ThemeProvider defaultTheme="velocity">
  <App />
</ThemeProvider>
```

### Theme Switching

```tsx
import { useTheme } from '@/contexts/ThemeContext';

function ThemeSwitcher() {
  const { setTheme } = useTheme();
  
  return (
    <button onClick={() => setTheme('velocity')}>
      Switch to VELOCITY
    </button>
  );
}
```

## Best Practices

### 1. Performance
- Use responsive utilities for mobile optimization
- Prefer CSS classes for static styles
- Use dynamic styles sparingly for interactive elements

### 2. Accessibility
- Always test with high contrast mode
- Ensure keyboard navigation works with focus styles
- Respect user motion preferences

### 3. Visual Hierarchy
- Use elevation system consistently (1-3 for UI, 4-6 for modals, 7-8 for special effects)
- Combine glass effects with appropriate elevation
- Use neon accents sparingly for emphasis

### 4. Color Usage
- Primary neon (cyan #00f5ff) for main actions
- Secondary neon (blue #0066ff) for navigation
- Accent neon (purple #6366f1) for highlights
- Special effects (plasma, laser) for premium features only

## Demo Component

View the complete demo at `@/components/dev/VelocityThemeDemo` for comprehensive examples of all features.
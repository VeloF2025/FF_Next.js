# Pull Request

## Description
<!-- Describe the changes in this PR -->

## Type of Change
<!-- Mark with an 'x' in [ ] -->
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Refactoring (no functional changes, code improvements)
- [ ] Documentation update
- [ ] UI/UX change

## Accessibility Checklist (MANDATORY for UI changes)
<!-- WCAG 2.1 AA compliance is non-negotiable. Mark with 'x' or N/A if not applicable -->
- [ ] **Color contrast:** All text meets WCAG AA contrast (4.5:1 minimum, use color-mix pattern for status badges)
- [ ] **Keyboard navigation:** All interactive elements are keyboard-operable (Enter/Space, visible focus states)
- [ ] **Screen readers:** All form controls have labels, buttons have aria-labels, images have alt text
- [ ] **Touch targets:** Interactive elements are minimum 44×44px
- [ ] **Responsive design:** Layout works on mobile (320px) to desktop (1920px+)
- [ ] **Semantic HTML:** Proper heading hierarchy, landmarks, roles
- [ ] **No JS-only interactions:** Core functionality works without JavaScript
- [ ] N/A — This PR does not change UI

**Axe DevTools report:** <!-- Paste axe DevTools output or "0 violations" -->

## Testing
<!-- Describe tests performed, browsers tested, accessibility audit results -->

## Related Issues
<!-- Link GitHub issues, MC tasks, or FibreFlow tickets -->
- Closes #
- Related to MC task: [link]

## Screenshots / Videos
<!-- Add visual evidence for UI changes -->

## Deployment Notes
<!-- Any migration steps, environment variables, or config changes needed? -->
- [ ] No deployment changes required
- [ ] Database migration required
- [ ] Environment variables added/changed
- [ ] Deployment process documented

---
**Developer Standards:** Read `knowledge/fibreflow-developer-handover.md` before submitting. Violations block PRs.

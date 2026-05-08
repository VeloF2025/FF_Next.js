/**
 * Shared archetype types.
 *
 * `ArchetypeResolved` is the set of concrete behavioural archetypes the
 * Phase 1 rules and proposed-defaults map produce: project / mobile / office.
 *
 * `Archetype` is the wider DB column type that Phase 2 will introduce — it
 * adds the `'auto'` sentinel value, which means "use the department default
 * at lookup time". Phase 1 doesn't write or read `'auto'`, but defining the
 * wider type now means Phase 2 doesn't have to widen and rename things in
 * flight (per the architecture review on PR #1555).
 */

export type ArchetypeResolved = 'project' | 'mobile' | 'office';

export type Archetype = ArchetypeResolved | 'auto';

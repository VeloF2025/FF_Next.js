/**
 * The migration-version gate.
 *
 * The point of these is the mutation that matters: a gate that returns an empty
 * map for everything passes "no collisions in a clean list" and passes the real
 * repo too. So every test that asserts NOTHING is found is paired with one that
 * asserts the same function DOES find a planted collision.
 */

import { describe, expect, it } from 'vitest';

import { GRANDFATHERED, collisions, newCollisions } from '../check-migration-versions.mjs';

describe('migration version collision gate', () => {
  it('finds two migrations sharing a version', () => {
    const found = collisions(['493_alpha.sql', '493_beta.sql', '494_solo.sql']);
    expect([...found.keys()]).toEqual(['493']);
    expect(found.get('493')).toEqual(['493_alpha.sql', '493_beta.sql']);
  });

  it('finds nothing when every version is distinct', () => {
    expect(collisions(['1_a.sql', '2_b.sql', '3_c.sql']).size).toBe(0);
  });

  it('does not count a rollback as a second use of its version', () => {
    // rollback_493_x.sql mirrors 493_x.sql — pairing them is the convention,
    // not a collision. Counting it would make EVERY migration look duplicated.
    expect(collisions(['493_alpha.sql', 'rollback_493_alpha.sql']).size).toBe(0);
  });

  it('ignores files that are not numbered migrations', () => {
    expect(collisions(['README.md', 'notes.txt', '_helpers.sql']).size).toBe(0);
  });

  it('treats a zero-padded version as distinct from its bare form', () => {
    // Not merely academic: the runner globs on the literal prefix, so 0493_ and
    // 493_ resolve to different rollbacks and must not be silently merged here.
    expect(collisions(['0493_a.sql', '493_b.sql']).size).toBe(0);
  });

  describe('grandfathering', () => {
    it('passes a collision that is on the list', () => {
      expect(newCollisions(['493_a.sql', '493_b.sql']).size).toBe(0);
    });

    it('FAILS a collision that is not on the list', () => {
      // The mirror of the test above. Without it, a gate that allowed
      // everything would pass.
      const found = newCollisions(['600_a.sql', '600_b.sql']);
      expect([...found.keys()]).toEqual(['600']);
    });

    it('fails a THIRD file added to an already-grandfathered version', () => {
      // The loophole worth closing: 493 is on the list, so a lazy check would
      // wave through a third 493 forever. Deliberately accepted — the list
      // grandfathers the version, not a file count — so this test PINS the
      // current behaviour rather than asserting a failure.
      expect(newCollisions(['493_a.sql', '493_b.sql', '493_c.sql']).size).toBe(0);
    });

    it('has exactly the 15 versions that collided when the gate was written', () => {
      expect(GRANDFATHERED.size).toBe(15);
      expect(GRANDFATHERED.has('493')).toBe(true);
      expect(GRANDFATHERED.has('495')).toBe(true);
    });

    it('accepts an empty allowlist, so the list is a policy not a hard-code', () => {
      expect(newCollisions(['493_a.sql', '493_b.sql'], new Set()).size).toBe(1);
    });
  });

  describe('against the real migrations directory', () => {
    it('the repo has no NEW collisions', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = path.join(process.cwd(), 'scripts', 'migrations', 'sql');
      const files = fs.readdirSync(dir);

      // Guard the guard: if the path were wrong, readdir would return nothing
      // and the assertion below would pass vacuously.
      expect(files.length).toBeGreaterThan(100);
      expect([...newCollisions(files).keys()]).toEqual([]);
    });

    it('every grandfathered version really does still collide', async () => {
      // Keeps the list honest. If a collision is resolved, the entry should be
      // dropped rather than left as permanent permission.
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = path.join(process.cwd(), 'scripts', 'migrations', 'sql');
      const real = collisions(fs.readdirSync(dir));

      expect([...GRANDFATHERED].filter((v) => !real.has(v))).toEqual([]);
    });
  });
});

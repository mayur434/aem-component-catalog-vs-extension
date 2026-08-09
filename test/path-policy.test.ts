import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPolicy, loadPolicy } from '../src/core/policy';
import { assertPathInside, isPathInside, safeRelativePath } from '../src/utils/pathSecurity';
import { createAemCloudFixture, type AemFixture } from './helpers/fixture';

let fixture: AemFixture | undefined;
afterEach(() => fixture?.cleanup());

describe('path containment and policies', () => {
  it('prevents generated paths from escaping the project', () => {
    fixture = createAemCloudFixture();
    const inside = path.join(fixture.root, 'ui.apps', 'file.txt');
    expect(isPathInside(fixture.root, inside)).toBe(true);
    expect(safeRelativePath(fixture.root, inside)).toBe('ui.apps/file.txt');
    expect(() => assertPathInside(fixture.root, path.join(fixture.root, '..', 'escape.txt'))).toThrow(
      'escapes',
    );
  });

  it('loads defaults and rejects invalid policy levels', () => {
    fixture = createAemCloudFixture();
    expect(defaultPolicy().rules['aemaacs.project']).toBe('error');
    fs.writeFileSync(
      path.join(fixture.root, '.aem-catalog-policy.json'),
      JSON.stringify({ rules: { 'component.require-owner': 'critical' } }),
    );
    expect(() => loadPolicy(fixture.root)).toThrow('Invalid policy level');
    expect(() => loadPolicy(fixture.root, '../outside-policy.json')).toThrow('escapes');
  });
});

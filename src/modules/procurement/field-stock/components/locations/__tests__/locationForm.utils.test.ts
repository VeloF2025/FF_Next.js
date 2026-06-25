import { describe, it, expect } from 'vitest';
import { toCreateInput, generateCode, EMPTY_LOCATION_FORM, type LocationFormValue } from '../locationForm.utils';

describe('generateCode', () => {
  it('returns empty string for blank/whitespace input', () => {
    expect(generateCode('')).toBe('');
    expect(generateCode('   ')).toBe('');
  });
  it('single word → first 8 chars uppercased', () => {
    expect(generateCode('Warehouse')).toBe('WAREHOUS');
    expect(generateCode('DC')).toBe('DC');
  });
  it('multi word → first 4 of each joined by dash, capped 15, uppercased', () => {
    expect(generateCode('Main Warehouse')).toBe('MAIN-WARE');
    expect(generateCode('Garstfontein DC')).toBe('GARS-DC');
  });
});

describe('toCreateInput', () => {
  const base: LocationFormValue = { ...EMPTY_LOCATION_FORM };

  it('trims, uppercases code, and includes coordinates when both lat+lng are finite', () => {
    const out = toCreateInput({
      ...base,
      name: '  Main WH  ', code: 'wh-main', locationType: 'warehouse',
      address: '  10 Foo St  ', lat: '-25.7896', lng: '28.2768',
      parentId: 'parent-uuid', projectId: 'project-uuid', assignedToName: '  John  ', assignedToPhone: ' 0123 ',
    });
    expect(out.name).toBe('Main WH');
    expect(out.code).toBe('WH-MAIN');
    expect(out.address).toBe('10 Foo St');
    expect(out.coordinates).toEqual({ lat: -25.7896, lng: 28.2768 });
    expect(out.parentId).toBe('parent-uuid');
    expect(out.projectId).toBe('project-uuid');
    expect(out.assignedToName).toBe('John');
    expect(out.assignedToPhone).toBe('0123');
  });

  it('omits coordinates when only one of lat/lng is provided', () => {
    expect(toCreateInput({ ...base, name: 'X', code: 'X', lat: '-25.7', lng: '' }).coordinates).toBeUndefined();
    expect(toCreateInput({ ...base, name: 'X', code: 'X', lat: '', lng: '28.2' }).coordinates).toBeUndefined();
  });

  it('omits coordinates when lat/lng are non-numeric', () => {
    expect(toCreateInput({ ...base, name: 'X', code: 'X', lat: 'abc', lng: 'def' }).coordinates).toBeUndefined();
  });

  it('drops blank optional fields to undefined', () => {
    const out = toCreateInput({ ...base, name: 'X', code: 'X', address: '', parentId: '', projectId: '', assignedToName: '', assignedToPhone: '' });
    expect(out.address).toBeUndefined();
    expect(out.parentId).toBeUndefined();
    expect(out.projectId).toBeUndefined();
    expect(out.assignedToName).toBeUndefined();
    expect(out.assignedToPhone).toBeUndefined();
  });
});

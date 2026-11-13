import { describe, expect, it } from 'vitest';
import { errorText } from './errorText';

describe('the text of an error', () => {
  it('is the message of an Error, with no class name', () => {
    expect(errorText(new TypeError('No camera.'))).toBe('No camera.');
  });

  it('is the value itself for anything else that was thrown', () => {
    expect(errorText('Model missing')).toBe('Model missing');
    expect(errorText(404)).toBe('404');
  });
});

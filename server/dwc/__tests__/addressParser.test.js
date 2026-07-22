import { describe, it, expect } from 'vitest';
import addressParser from '../addressParser.js';

const { parseAddress, buildIdentityKey } = addressParser;

describe('parseAddress', () => {
    // Table-driven: no comma, one comma, two commas with normal state,
    // ZIP+4 fallback, malformed trailing text.
    const cases = [
        {
            label: 'no comma — everything is street',
            input: '100 EXAMPLE ST STE 200',
            expected: { street: '100 EXAMPLE ST STE 200', city: '', state: '', zipCode: '' }
        },
        {
            label: 'one comma — street + city only',
            input: '100 EXAMPLE ST STE 200, SAMPLETOWN',
            expected: { street: '100 EXAMPLE ST STE 200', city: 'SAMPLETOWN', state: '', zipCode: '' }
        },
        {
            label: 'two commas, normal 2-letter state + ZIP',
            input: '100 EXAMPLE ST STE 200, SAMPLETOWN, CA 90001',
            expected: { street: '100 EXAMPLE ST STE 200', city: 'SAMPLETOWN', state: 'CA', zipCode: '90001' }
        },
        {
            label: 'ZIP+4 with irregular state segment (trailing-ZIP regex fallback)',
            input: '42 FICTIONAL AVE, TESTVILLE, CALIFORNIA 90002-1234',
            expected: { street: '42 FICTIONAL AVE', city: 'TESTVILLE', state: 'CALIFORNIA', zipCode: '90002-1234' }
        },
        {
            label: 'ZIP+4 with normal state',
            input: '42 FICTIONAL AVE, TESTVILLE, CA 90002-1234',
            expected: { street: '42 FICTIONAL AVE', city: 'TESTVILLE', state: 'CA', zipCode: '90002-1234' }
        },
        {
            label: 'malformed trailing text with no ZIP — all goes to state',
            input: '42 FICTIONAL AVE, TESTVILLE, SEE FRONT DESK',
            expected: { street: '42 FICTIONAL AVE', city: 'TESTVILLE', state: 'SEE FRONT DESK', zipCode: '' }
        },
        {
            label: 'state-only third segment (no space)',
            input: '42 FICTIONAL AVE, TESTVILLE, CA',
            expected: { street: '42 FICTIONAL AVE', city: 'TESTVILLE', state: 'CA', zipCode: '' }
        },
        {
            label: 'empty string',
            input: '',
            expected: { street: '', city: '', state: '', zipCode: '' }
        }
    ];

    for (const { label, input, expected } of cases) {
        it(label, () => {
            expect(parseAddress(input)).toEqual(expected);
        });
    }
});

describe('buildIdentityKey', () => {
    it('builds a lowercase pipe-joined key', () => {
        expect(buildIdentityKey({ street: '100 EXAMPLE ST', city: 'SAMPLETOWN', state: 'CA', zipCode: '90001' }))
            .toBe('100 example st|sampletown|ca|90001');
    });

    it('is stable across case and whitespace variations (idempotent re-runs)', () => {
        const a = buildIdentityKey({ street: '100  Example St', city: ' Sampletown ', state: 'ca', zipCode: '90001' });
        const b = buildIdentityKey({ street: '100 EXAMPLE ST', city: 'SAMPLETOWN', state: 'CA', zipCode: '90001' });
        expect(a).toBe(b);
    });

    it('handles missing fields without throwing', () => {
        expect(buildIdentityKey({ street: '100 EXAMPLE ST' })).toBe('100 example st|||');
    });
});

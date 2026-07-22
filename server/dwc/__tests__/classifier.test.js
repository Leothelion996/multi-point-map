import { describe, it, expect } from 'vitest';
import classifier from '../classifier.js';

const { classify } = classifier;

describe('classify', () => {
    it('classifies the exact PME phone (digits only) as pme', () => {
        expect(classify('8003108707')).toBe('pme');
    });

    it('normalizes formatting variations to a match', () => {
        expect(classify('800-310-8707')).toBe('pme');
        expect(classify('(800) 310-8707')).toBe('pme');
        expect(classify('800.310.8707')).toBe('pme');
        expect(classify(' 800 310 8707 ')).toBe('pme');
    });

    it('classifies a different number as not_pme', () => {
        expect(classify('800-555-0100')).toBe('not_pme');
    });

    it('does not fuzzy-match a superset of digits (straight equality)', () => {
        expect(classify('1-800-310-8707')).toBe('not_pme');
    });

    it('classifies blank/missing phone as needs_review', () => {
        expect(classify('')).toBe('needs_review');
        expect(classify('   ')).toBe('needs_review');
        expect(classify(null)).toBe('needs_review');
        expect(classify(undefined)).toBe('needs_review');
    });

    it('classifies a phone with no digits at all as needs_review', () => {
        expect(classify('call front desk')).toBe('needs_review');
    });
});

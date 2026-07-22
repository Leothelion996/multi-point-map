import { describe, it, expect } from 'vitest';
import nameMatcher from '../nameMatcher.js';

const { rowBelongsToDoctor, extractCredentials } = nameMatcher;

describe('rowBelongsToDoctor', () => {
    const doctor = { firstName: 'Jane', lastName: 'Sample' };

    it('matches an exact first/last name', () => {
        expect(rowBelongsToDoctor('JANE SAMPLE , MD, QME', doctor)).toBe(true);
    });

    it('tolerates a middle initial in the DWC name', () => {
        expect(rowBelongsToDoctor('JANE Q SAMPLE , MD', doctor)).toBe(true);
    });

    it('tolerates &nbsp;-style extra spacing (already collapsed upstream)', () => {
        expect(rowBelongsToDoctor('JANE  Q  SAMPLE , DC, L.Ac.', doctor)).toBe(true);
    });

    it('rejects a different last name', () => {
        expect(rowBelongsToDoctor('JANE Q OTHER , MD', doctor)).toBe(false);
    });

    it('rejects when the last name only appears as a non-final token', () => {
        // Last token of the name part is the last name — SAMPLE JONES has
        // last name JONES, not SAMPLE.
        expect(rowBelongsToDoctor('JANE SAMPLE JONES , MD', doctor)).toBe(false);
    });

    it('rejects out-of-order first-name tokens', () => {
        const multiFirst = { firstName: 'Chun Keung', lastName: 'Sample' };
        expect(rowBelongsToDoctor('CHUN KEUNG SAMPLE , MD', multiFirst)).toBe(true);
        expect(rowBelongsToDoctor('KEUNG CHUN SAMPLE , MD', multiFirst)).toBe(false);
    });

    it('rejects a row whose first name does not appear', () => {
        expect(rowBelongsToDoctor('ROBERT SAMPLE , MD', doctor)).toBe(false);
    });

    it('matches a multi-token (compound/hyphenated) last name', () => {
        // Verified against live DWC data — the legacy last-token-only
        // comparison rejected this shape (see rowBelongsToDoctor comment).
        const compound = { firstName: 'Oscar', lastName: 'Del Rio-Marquez' };
        expect(rowBelongsToDoctor('OSCAR M DEL RIO-MARQUEZ , DC', compound)).toBe(true);
    });

    it('rejects when only part of a multi-token last name matches', () => {
        const compound = { firstName: 'Oscar', lastName: 'Del Rio-Marquez' };
        expect(rowBelongsToDoctor('OSCAR M RIO-MARQUEZ , DC', compound)).toBe(false);
    });

    it('single-token last names behave exactly like the legacy algorithm', () => {
        // "JOHNSON" must not tail-match doctor last name "Son"
        expect(rowBelongsToDoctor('JOHN JOHNSON , MD', { firstName: 'John', lastName: 'Son' })).toBe(false);
    });

    it('matches case-insensitively and ignores punctuation in the last name', () => {
        const oDoctor = { firstName: 'Mary', lastName: "O'Sample" };
        expect(rowBelongsToDoctor("MARY O'SAMPLE , MD", oDoctor)).toBe(true);
    });

    it('returns false for empty inputs', () => {
        expect(rowBelongsToDoctor('', doctor)).toBe(false);
        expect(rowBelongsToDoctor('JANE SAMPLE , MD', { firstName: '', lastName: '' })).toBe(false);
    });
});

describe('extractCredentials', () => {
    it('extracts allowlisted credentials', () => {
        expect(extractCredentials('JANE Q SAMPLE , MD')).toEqual(['MD']);
    });

    it('extracts dotted credentials via dot-stripping (L.Ac. -> LAC)', () => {
        expect(extractCredentials('JANE Q SAMPLE , DC, L.Ac.')).toEqual(['DC', 'L.Ac.']);
    });

    it('extracts generic short-pattern credentials like QME', () => {
        expect(extractCredentials('JANE Q SAMPLE , MD, QME')).toEqual(['MD', 'QME']);
    });

    it('rejects junk tokens that are not credential-like', () => {
        expect(extractCredentials('JANE Q SAMPLE , MEDICAL DIRECTOR')).toEqual([]);
    });

    it('dedups case-insensitively, keeping first-seen casing', () => {
        expect(extractCredentials('JANE SAMPLE , MD, md')).toEqual(['MD']);
    });

    it('returns [] when there is no comma (no credentials tail)', () => {
        expect(extractCredentials('JANE SAMPLE')).toEqual([]);
    });

    it('returns [] for empty input', () => {
        expect(extractCredentials('')).toEqual([]);
    });
});

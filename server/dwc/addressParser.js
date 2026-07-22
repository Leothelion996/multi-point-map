// Address splitting — parseAddress is ported VERBATIM (pure string logic)
// from the legacy Apps Script ("Remove after implementation verified/Dr.
// Location Aggregator/06. Reformatted DWC Addresses.gs.txt").

// Parses a full address string into components.
// Expected format: "STREET, CITY, STATE ZIP"
// Example: "1055 WILSHIRE BLVD STE 1930, LOS ANGELES, CA 90017"
function parseAddress(addressText) {
    const text = String(addressText || '').trim();

    const commaIndex1 = text.indexOf(',');
    if (commaIndex1 === -1) {
        return { street: text, city: '', state: '', zipCode: '' };
    }

    const commaIndex2 = text.indexOf(',', commaIndex1 + 1);
    if (commaIndex2 === -1) {
        return {
            street: text.substring(0, commaIndex1).trim(),
            city: text.substring(commaIndex1 + 1).trim(),
            state: '',
            zipCode: ''
        };
    }

    const street = text.substring(0, commaIndex1).trim();
    const city = text.substring(commaIndex1 + 1, commaIndex2).trim();
    const stateZip = text.substring(commaIndex2 + 1).trim();

    const spaceIndex = stateZip.indexOf(' ');
    let state = '';
    let zipCode = '';

    if (spaceIndex !== -1 && spaceIndex <= 2) {
        state = stateZip.substring(0, spaceIndex);
        zipCode = stateZip.substring(spaceIndex + 1).trim();
    } else {
        const zipMatch = stateZip.match(/(\d{5}(?:-\d{4})?)$/);
        if (zipMatch) {
            zipCode = zipMatch[1];
            state = stateZip.substring(0, stateZip.length - zipCode.length).trim();
        } else {
            state = stateZip;
        }
    }

    return { street, city, state, zipCode };
}

// New (not ported — the legacy system never had a formal identity key).
// Normalized lowercase pipe-joined street|city|state|zip for
// dwc_location.identity_key. Phone is deliberately excluded, per the legacy
// identity rule (doctor + address defines a location, phone can change).
function buildIdentityKey({ street, city, state, zipCode }) {
    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return [norm(street), norm(city), norm(state), norm(zipCode)].join('|');
}

module.exports = { parseAddress, buildIdentityKey };

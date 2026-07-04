// Stub for the future .xlsx workbook parser. Real spreadsheet parsing is a
// later batch — this only defines the normalized shape the Panel Stock
// Analysis page consumes, so the parser can slot in without page changes.
//
// Normalized shape:
//   groups:    [{ id, name }]
//   locations: [{ zipCode, title, number, color, groupId }]
//     - zipCode: 5-digit string used for POST /api/zipcodes/lookup
//     - number:  panel stock count shown centered on the ZIP polygon
// eslint-disable-next-line no-unused-vars
export function mapWorkbookToPanelStock(file) {
    return {
        groups: [],
        locations: []
    };
}

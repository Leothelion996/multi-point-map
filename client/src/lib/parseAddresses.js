// Port of parseAddresses (script.js:1943-1977).
export function parseAddresses(input) {
    if (!input || !input.trim()) return [];

    input = input.trim();

    // Limit input length to prevent abuse
    if (input.length > 10000) {
        input = input.substring(0, 10000);
    }

    // Split by newlines first, then by commas as fallback
    let addresses = input.split('\n').map((addr) => addr.trim()).filter((addr) => addr);

    // If only one line but contains commas, split by commas
    if (addresses.length === 1 && addresses[0].includes(',')) {
        addresses = addresses[0].split(',').map((addr) => addr.trim()).filter((addr) => addr);
    }

    addresses = addresses.map((addr) => {
        addr = addr.replace(/[<>]/g, '');
        if (addr.length > 200) {
            addr = addr.substring(0, 200);
        }
        return addr.trim();
    }).filter((addr) => addr.length > 0);

    // Remove duplicates and limit to 50
    return [...new Set(addresses)].slice(0, 50);
}

// Builds the imperative DOM content shown inside google.maps.InfoWindow —
// this lives outside the React tree, so plain DOM (ported from
// createMarker/createPolygonFromGeometry in script.js) is the right tool.

const INFO_COLORS = [
    { name: 'Red', value: '#ef4444', class: 'bg-red-500' },
    { name: 'Blue', value: '#3b82f6', class: 'bg-blue-500' },
    { name: 'Green', value: '#10b981', class: 'bg-green-500' },
    { name: 'Yellow', value: '#f59e0b', class: 'bg-yellow-500' },
    { name: 'Purple', value: '#8b5cf6', class: 'bg-purple-500' },
    { name: 'Pink', value: '#ec4899', class: 'bg-pink-500' },
    { name: 'Orange', value: '#f97316', class: 'bg-orange-500' },
    { name: 'Gray', value: '#6b7280', class: 'bg-gray-500' }
];

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {{lat:number,lng:number}} [opts.position] - shown for markers, omitted for polygons
 * @param {string} opts.currentColor
 * @param {(color:{name:string,value:string}) => void} opts.onColorPick
 * @param {() => void} opts.onDelete
 */
export function buildInfoWindowContent({ title, position, currentColor, onColorPick, onDelete }) {
    const content = document.createElement('div');
    content.className = 'marker-popup';

    const titleElement = document.createElement('h3');
    titleElement.className = 'font-medium text-gray-900';
    titleElement.textContent = title;
    content.appendChild(titleElement);

    if (position) {
        const latElement = document.createElement('p');
        latElement.className = 'text-sm text-gray-500 mt-1';
        latElement.textContent = `Lat: ${position.lat.toFixed(4)}`;

        const lngElement = document.createElement('p');
        lngElement.className = 'text-sm text-gray-500';
        lngElement.textContent = `Lng: ${position.lng.toFixed(4)}`;

        content.appendChild(latElement);
        content.appendChild(lngElement);
    }

    const colorSection = document.createElement('div');
    colorSection.className = 'mt-2 mb-2';

    const colorLabel = document.createElement('div');
    colorLabel.className = 'text-xs font-medium text-gray-700 mb-1';
    colorLabel.textContent = 'Change Color:';

    const colorPicker = document.createElement('div');
    colorPicker.className = 'flex space-x-1';

    INFO_COLORS.forEach((color) => {
        const colorButton = document.createElement('button');
        colorButton.className = `w-5 h-5 rounded-full ${color.class} border-2 border-gray-300 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-500`;
        colorButton.title = `Change to ${color.name}`;
        // Tailwind classes don't apply inside the info window in all cases, so set the color directly too
        colorButton.style.backgroundColor = color.value;

        if (currentColor === color.value) {
            colorButton.classList.add('ring-2', 'ring-offset-1', 'ring-gray-500');
        }

        colorButton.addEventListener('click', () => onColorPick(color));
        colorPicker.appendChild(colorButton);
    });

    colorSection.appendChild(colorLabel);
    colorSection.appendChild(colorPicker);
    content.appendChild(colorSection);

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'mt-2 flex space-x-2';

    const deleteButton = document.createElement('button');
    deleteButton.className = 'text-xs px-2 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200';
    deleteButton.textContent = 'Delete';
    deleteButton.addEventListener('click', onDelete);

    buttonContainer.appendChild(deleteButton);
    content.appendChild(buttonContainer);

    return content;
}

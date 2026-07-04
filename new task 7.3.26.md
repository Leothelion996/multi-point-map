Implement this directly in the existing React/Vite project. Priority: preserve the current project structure, reuse existing patterns, keep files clean, and avoid broad rewrites.

Current relevant files:
- `client/src/App.jsx`
- `client/src/components/NavBar.jsx`
- `client/src/context/ShellContext.jsx`
- `client/src/pages/MapPage.jsx`
- `client/src/pages/LocationsPage.jsx`
- `client/src/pages/ZipCodesPage.jsx`
- `client/src/pages/UploadsPage.jsx`
- `client/src/components/Sidebar.jsx`
- `client/src/hooks/useMapEngine.js`
- `client/src/lib/markerIcons.js`
- `client/src/lib/screenshot.js`
- `client/src/components/modals/ExportModal.jsx`

Do not revert unrelated worktree changes.

Goal:
Replace the existing Uploads page with a new Panel Stock Analysis page, reorganize the top navigation into a left hamburger popover, keep the right-side map panel toggle as a separate icon, and prepare the Panel Stock map for future `.xlsx` parsing without implementing real spreadsheet parsing yet.

Navigation changes:
1. Move the hamburger menu to the left side of the nav, near the logo.
2. The hamburger opens a compact popover menu, not a drawer.
3. The popover has exactly 5 entries for now:
   - Zip Code Outline -> `/zipcodes`
   - Multiple Location Mapping -> `/`
   - Panel Stock Analysis -> `/panel-stock-analysis`
   - Screenshot -> calls the active page’s screenshot handler
   - Export -> calls the active page’s export handler
4. Screenshot and Export should be visually grouped at the bottom of the popover list.
5. Remove the current top-nav route buttons for Zip Codes and Uploads.
6. Remove the current top-nav Screenshot and Export buttons.
7. Keep Logout in the top nav.
8. Replace the current top-right hamburger/sidebar toggle with a simple right-panel icon button. It should still toggle the existing right sidebar open/closed.
9. The right-panel toggle should appear on map-style pages: Locations, Zip Code Outline, and Panel Stock Analysis.
10. Existing unsaved-temp navigation guard behavior must still apply when switching routes from the new menu.

Routing/page changes:
1. Remove the `/uploads` route entirely. Do not redirect it.
2. Remove the `UploadsPage` import/usage from `App.jsx`.
3. Add a new protected route:
   - `/panel-stock-analysis`
   - component: `PanelStockAnalysisPage.jsx`
4. Delete `UploadsPage.jsx` if it becomes unused.
5. If `UploadPanel.jsx` and `client/src/api/uploads.js` become unused after the new page is complete, remove them or leave them only if reused cleanly. Do not change `server.js` upload APIs in this batch.

Shared structure:
1. Reuse the existing map page structure instead of duplicating large blocks.
2. Prefer extracting a small shared map workspace component from `MapPage.jsx` if needed, so Locations, Zip Codes, and Panel Stock Analysis share layout behavior:
   - body `map-page` class
   - map container sizing
   - sidebar margin behavior
   - window resize/map resize handling
   - nav handler registration pattern
3. Existing Locations and Zip Code pages must behave the same after the refactor.

Panel Stock Analysis page:
1. The page should visually match the current map pages: nav, full map area, right-side panel, same general spacing/styles.
2. Add a top control area for Panel Stock uploads/versions. Keep it compact.
3. Include:
   - upload/version dropdown
   - “New Upload” button
   - “Hide all empty locations” toggle
4. “New Upload” opens a modal, not a page.
5. Modal requirements:
   - upload title is required
   - file is required
   - accept `.xlsx` only
   - support drag/drop and file picker
   - store this upload only in browser session state for now
6. Use `sessionStorage` for upload versions. Suggested key: `panelStockUploads`.
7. Each upload version should have its own data object:
   - `id`
   - `title`
   - `fileName`
   - `createdAt`
   - `groups`
   - `locations`
8. Since spreadsheet parsing is later, do not add an XLSX parser dependency and do not implement real workbook parsing now.
9. Add a clean mapping hook/stub for the future parser, such as `client/src/lib/panelStockMapper.js`, that returns the normalized shape the page expects.
10. For now, uploaded versions can create an empty normalized data set, but the shape must be ready for ZIP/group/location data.

Panel Stock map behavior:
1. This page is a merger of ZIP code outlines and location-style number markers.
2. ZIP codes should use the same polygon outline/rendering approach as the Zip Code page.
3. Each ZIP polygon should support a centered number icon.
4. The number must come from a panel-stock-specific field/hook, not from list order.
5. Until real spreadsheet mapping exists, default the number value to `0`.
6. Add support for hiding empty locations:
   - when off: show ZIP outline and centered `0` icon
   - when on: hide both the ZIP outline and centered icon for entries whose number is `0`
7. Keep this as a visual filter; do not delete the underlying session data.
8. Reuse `createNumberedMarkerIcon` where practical, but ensure `0` renders correctly.
9. If updating screenshot rendering, use `item.number` when provided instead of always using `index + 1`.

Screenshot/export:
1. Screenshot and Export must be triggered from the hamburger popover.
2. They should apply to whichever active map page is open.
3. Existing Locations/Zip Codes screenshot/export behavior should remain unchanged.
4. Panel Stock should register compatible handlers even if there are no parsed groups yet.

Acceptance criteria:
1. `npm run build` succeeds.
2. Locations page still works.
3. Zip Code Outline page still works.
4. Left hamburger opens compact menu with the 5 required entries.
5. Right icon toggles the existing right sidebar.
6. `/uploads` no longer exists as an app page.
7. `/panel-stock-analysis` exists and matches the map-page structure.
8. Panel Stock upload modal requires title + `.xlsx`.
9. Upload versions are selectable during the browser session.
10. Hide-empty toggle is wired into the panel stock map rendering path.
11. No real `.xlsx` parsing is implemented in this batch.
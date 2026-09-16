# Verification

Run `npm test` for the warehouse ledger, cart lifecycle, receiving, approvals,
allocation, fulfillment, integration contracts, PIN gate, and mapping guards.
The historical workflow suites use explicit mappings in `mapped-fixture.mjs`.
The production seed still requires the user to map previously unmapped SKUs.

`*-render.jsx` and `render.jsx` are React server-render checks. Bundle each with
esbuild for Node before running. `rack3d-render.jsx` checks mapping/stock modes,
ABC/zone/SKU filters, accessible location targets and compact table filters.

For synthetic interactive QA, compile `ui-qa.jsx` into `qa-assets/qa.js`:

```sh
./node_modules/@esbuild/linux-x64/bin/esbuild tests/ui-qa.jsx --bundle --outfile=tests/qa-assets/qa.js
```

Start the supervised Sites preview from the project root, then use the dev-only
“Uji komponen dengan data sintetis” link. The fixture offers 390px, 820px and
1280px frames and generates isolated in-memory data. It never reads IndexedDB,
logs in, or calls a production API. These routes are absent from the production
Worker and portable server. The QA bundle is not checked into source control.

September 8, 2026: automated business and render checks passed. Cloud browser
interaction was blocked by URL policy after preview recovery; no physical
phone/tablet, scanner, camera, or Windows launcher validation is claimed.

`warehouse-layout.test.mjs` covers persisted layout and backup, authorization,
optimistic editing conflicts, rotated collision/boundary checks, drag snapping,
new rack masters, and utilization with inactive/unknown-capacity locations.
`layout-render.jsx` verifies editor labels and filters, shared utilization on
both pages, and 3D coordinates that remain stable through ABC/SKU filtering.

`outbound-cart.test.mjs` covers capacity splitting, physical-layout routing,
exclusive operator/cart ownership, duplicate scans, partial and merged parcels,
partial shipment conservation, short-pick/replan/cancel, cart reuse and V6 backup
compatibility. The 20-line cycle in `testing-data.test.mjs` exercises both retained
legacy documents and the new 12-store cart/parcel flow. `outbound-render.jsx`
checks scan-first controls and traceability through Shipping.

`rack-structure.test.mjs` covers rack expansion, safe retirement/restoration,
active-work/stock/mapping guards, stale edits, and historical/backup preservation.
`layout-navigation-render.jsx` verifies independent menu sections, permission
filtering, stored preferences, bin/level inputs, full-window map controls and
3D geometry after resizing. V9: 107 Node tests and six relevant SSR suites pass;
no additional data reset, browser interaction or physical device QA is claimed.

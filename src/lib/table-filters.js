// View-only filters. No inventory or document mutations are performed here.
export const textKey = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('id-ID');
export const valueKey = value => textKey(value);
export function numberValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '').trim().replace(/\s*(pcs|hari)$/i, '').trim();
  if (!text || !/^[+-]?[\d.,]+$/.test(text)) return null;
  // Display strings use Indonesian grouping/decimals. Raw values should be numbers.
  const normalized = text.includes(',') ? text.replaceAll('.', '').replace(',', '.') : /^[+-]?\d{1,3}(\.\d{3})+$/.test(text) ? text.replaceAll('.', '') : text;
  const result = Number(normalized);
  return Number.isFinite(result) ? result : null;
}
export const isActiveFilter = f => !!f && (!!textKey(f.query) || f.min !== '' && f.min != null || f.max !== '' && f.max != null || Array.isArray(f.values) || !!f.presence);
export function validRange(filter) {
  const min = filter?.min, max = filter?.max;
  return (min === '' || min == null || Number.isFinite(Number(min))) && (max === '' || max == null || Number.isFinite(Number(max))) && (min === '' || min == null || max === '' || max == null || Number(min) <= Number(max));
}
export function matchesFilter(value, filter, type = 'text') {
  if (!isActiveFilter(filter)) return true;
  const text = textKey(value), numeric = type === 'number' ? numberValue(value) : null;
  const empty = type === 'number' ? numeric == null : !text || text === '—';
  if (filter.presence === 'empty' && !empty || filter.presence === 'filled' && empty) return false;
  if (textKey(filter.query) && !text.includes(textKey(filter.query))) return false;
  if (Array.isArray(filter.values) && !filter.values.includes(valueKey(value))) return false;
  if (!validRange(filter)) return false;
  if (filter.min !== '' && filter.min != null && (numeric == null || numeric < Number(filter.min))) return false;
  if (filter.max !== '' && filter.max != null && (numeric == null || numeric > Number(filter.max))) return false;
  return true;
}
export function filterRows(rows, filters, columns) {
  const active = Object.entries(filters).filter(([,f]) => isActiveFilter(f));
  return active.length ? rows.filter(row => active.every(([index, filter]) => matchesFilter(row.values[index], filter, columns[index]?.type))) : rows;
}
export function paginateRows(rows, page, pageSize) {
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.max(1, Math.min(page, pages));
  return {page: currentPage, pages, rows: rows.slice((currentPage - 1) * pageSize, currentPage * pageSize)};
}
export function distinctValues(rows, index) {
  const values = new Map();
  for (const row of rows) {
    const value = row.values[index], key = valueKey(value);
    if (!values.has(key)) values.set(key, {key, label: String(value ?? '').trim() || '(Kosong)', count: 0});
    values.get(key).count++;
  }
  return [...values.values()].sort((a,b) => a.label.localeCompare(b.label, 'id', {numeric: true}));
}

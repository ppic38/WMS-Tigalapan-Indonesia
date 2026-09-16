import {PreferencesContext} from './preferences.jsx';
import React, {Children, isValidElement, useContext, useEffect, useId, useRef, useState} from 'react';
import {Filter, X, ChevronLeft, ChevronRight, Download, PackageOpen} from 'lucide-react';
import {distinctValues, filterRows, isActiveFilter, paginateRows, textKey, validRange} from './lib/table-filters.js';
import {csv, download} from './lib/files.js';

// Components with non-child display text expose a pure filterValue adapter.
export function cellValue(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(cellValue).filter(v => v !== '').join(' ');
  if (!isValidElement(node)) return '';
  const p = node.props;
  if (Object.hasOwn(p, 'data-filter-value')) return p['data-filter-value'];
  if (p.hidden || p['aria-hidden'] === true) return '';
  if (node.type.filterValue) return node.type.filterValue(p);
  if (node.type === 'input' || node.type === 'select') return p.value ?? '';
  const children = cellValue(p.children);
  const text = children !== '' ? children : p['aria-label'] || p.title || '';
  return p.disabled && text ? `${text} (tidak tersedia)` : text;
}
export function tableRows(children, mobileRows) {
  const rows = [], mobile = [];
  Children.forEach(mobileRows, row => row && mobile.push(row));
  Children.forEach(children, row => {
    if (!isValidElement(row)) return;
    const values = [];
    Children.forEach(row.props.children, cell => isValidElement(cell) && values.push(cellValue(cell)));
    rows.push({element: row, key: row.key, values, mobile: mobile[rows.length]});
  });
  return rows;
}
export function Table({headers, ...props}) {
  const columns = headers.map(h => !isValidElement(h) && typeof h === 'object' ? {...h, name: h.filterLabel || String(cellValue(h.label))} : {label: h, name: String(cellValue(h)), type: 'text'});
  // Different tabs/documents must not inherit an unrelated column's filter.
  const schema = JSON.stringify(columns.map(c => [c.name, c.type]));
  const mobileRows=props.mobileRows??(props.mobileColumns?Children.toArray(props.children).filter(isValidElement).map(row=>{
    const cells=Children.toArray(row.props.children),indexes=props.mobileColumns;
    return <article className="operation-card" key={row.key}>{indexes.map((i,n)=><div key={i} className={n===0?'operation-card-title':'operation-card-field'}>{n>0&&<span>{columns[i]?.name}</span>}<div>{cells[i]?.props?.children}</div></div>)}</article>;
  }):undefined);
  return <FilterTable key={schema} columns={columns} {...props} mobileRows={mobileRows}/>;
}
function FilterTable({columns, children, empty, emptyText='Belum ada data', colSpan, pageSize: requestedPageSize, resetKey, mobileRows, exportFilename}) {
  const preferences=useContext(PreferencesContext),pageSize=requestedPageSize||preferences.tablePageSize||15;
  const [filters, setFilters] = useState({}), [open, setOpen] = useState(null), [page, setPage] = useState(1);
  const id = useId(), origin = useRef(), panel = useRef();
  const rows = empty ? [] : tableRows(children, mobileRows), filtered = filterRows(rows, filters, columns);
  const view = paginateRows(filtered, page, pageSize), active = Object.entries(filters).filter(([,f]) => isActiveFilter(f));
  useEffect(() => setPage(1), [resetKey]);
  useEffect(() => {if (view.page !== page) setPage(view.page)}, [view.page, page]);
  function edit(index, event) {origin.current = event.currentTarget; setOpen(index)}
  function close() {setOpen(null); origin.current?.focus()}
  function update(index, filter) {setFilters(current => {const next = {...current}; if (isActiveFilter(filter)) next[index] = filter; else delete next[index]; return next}); setPage(1)}
  const exportRows = () => download(exportFilename || 'hasil-filter-tabel.csv', csv(filtered.map(row => Object.fromEntries(columns.flatMap((c,i) => c.export === false ? [] : [[c.name, row.values[i]]])))));
  return <div className="filter-table" onKeyDown={e => {if (e.key === 'Escape' && open !== null) {e.preventDefault(); e.stopPropagation(); close()}}}>
    {exportFilename && !active.length && <div className="table-export-bar"><button type="button" className="text-button filtered-export" onClick={exportRows} disabled={!filtered.length}><Download size={15}/>Ekspor laporan</button></div>}
    {mobileRows && <div className="table-mobile-filters"><Filter size={16}/><label htmlFor={`${id}-column`}>Filter kolom</label><select id={`${id}-column`} value={open ?? ''} onChange={e => e.target.value !== '' && edit(Number(e.target.value), e)}><option value="">Pilih kolom…</option>{columns.map((c,i) => <option key={i} value={i}>{c.name}{isActiveFilter(filters[i]) ? ' • aktif' : ''}</option>)}</select></div>}
    {active.length > 0 && <div className="column-filter-summary"><span aria-live="polite"><strong>{filtered.length.toLocaleString('id-ID')}</strong> dari {rows.length.toLocaleString('id-ID')} data</span><div className="column-filter-chips">{active.map(([index]) => <span className="column-filter-chip" key={index}><button type="button" onClick={e => edit(Number(index), e)}>{columns[index].name}</button><button type="button" aria-label={`Hapus filter ${columns[index].name}`} onClick={() => update(index, null)}><X size={13}/></button></span>)}</div><button type="button" className="text-button" onClick={() => {setFilters({}); setPage(1); setOpen(null)}}>Reset semua filter</button><button type="button" className="text-button filtered-export" onClick={exportRows}><Download size={15}/>Ekspor hasil filter</button></div>}
    {open !== null && <FilterEditor key={open} id={`${id}-editor`} column={columns[open]} filter={filters[open]} options={distinctValues(rows, open)} onClose={close} onApply={filter => {update(open, filter); close()}} panelRef={panel}/>}
    <div className={`table-wrap ${mobileRows ? 'filter-table-desktop' : ''}`}><table><thead><tr>{columns.map((c,i) => <th key={i} scope="col"><div className="filter-heading"><span>{c.label}</span><button type="button" className={`column-filter-trigger ${isActiveFilter(filters[i]) ? 'is-filtered' : ''}`} aria-label={`Filter ${c.name}`} title={`Filter ${c.name}`} aria-expanded={open === i} aria-controls={open === i ? `${id}-editor` : undefined} onClick={e => open === i ? close() : edit(i, e)}><Filter size={14}/>{isActiveFilter(filters[i]) && <span className="filter-dot"/>}</button></div></th>)}</tr></thead><tbody>{view.rows.length ? view.rows.map(row => row.element) : <tr><td colSpan={colSpan || columns.length}><div className="empty"><PackageOpen size={30}/><h3>{active.length ? 'Tidak ada hasil yang cocok' : emptyText}</h3>{active.length > 0 && <p>Ubah atau reset filter untuk menampilkan data lain.</p>}</div></td></tr>}</tbody></table></div>
    {mobileRows && <div className="filter-table-mobile">{view.rows.map(row => row.mobile)}{!view.rows.length && <div className="empty"><h3>{active.length ? 'Tidak ada hasil yang cocok' : emptyText}</h3></div>}</div>}
    <div className="pager"><span aria-live="polite">{filtered.length ? `${(view.page-1)*pageSize+1}–${Math.min(view.page*pageSize, filtered.length)} dari ${filtered.length.toLocaleString('id-ID')} data` : '0 data'}</span><div><button type="button" aria-label="Halaman sebelumnya" disabled={view.page <= 1} onClick={() => setPage(view.page-1)}><ChevronLeft size={17}/></button><span>{view.page} / {view.pages}</span><button type="button" aria-label="Halaman berikutnya" disabled={view.page >= view.pages} onClick={() => setPage(view.page+1)}><ChevronRight size={17}/></button></div></div>
  </div>;
}
function FilterEditor({id, column, filter, options, onClose, onApply, panelRef}) {
  const blank = {query: '', min: '', max: '', values: null, presence: ''};
  const [draft, setDraft] = useState({...blank, ...filter}), [search, setSearch] = useState('');
  const first = useRef(), valid = validRange(draft);
  useEffect(() => {first.current?.focus()}, []);
  const set = (key, value) => setDraft(d => ({...d, [key]: value}));
  const found = options.filter(o => textKey(o.label).includes(textKey(search))), shown = found.slice(0, 100);
  const toggle = key => set('values', draft.values?.includes(key) ? draft.values.filter(v => v !== key) : [...(draft.values || []), key]);
  return <section className="column-filter-panel" id={id} ref={panelRef} aria-label={`Pengaturan filter ${column.name}`} onKeyDown={e => {if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {e.preventDefault(); if(valid) onApply(draft)}}}>
    <div className="column-filter-title"><span><Filter size={16}/><strong>Filter {column.name}</strong></span><button type="button" className="icon-button" aria-label="Tutup filter tanpa menerapkan" onClick={onClose}><X size={17}/></button></div>
    <div className="column-filter-fields"><div className="column-filter-condition">
      {column.type === 'number' ? <><div className="column-filter-range"><label className="field"><span>Minimum (termasuk)</span><input ref={first} aria-label={`Minimum ${column.name}`} type="number" step="any" value={draft.min} onChange={e => set('min', e.target.value)} placeholder="Tanpa batas"/></label><label className="field"><span>Maksimum (termasuk)</span><input aria-label={`Maksimum ${column.name}`} type="number" step="any" value={draft.max} onChange={e => set('max', e.target.value)} placeholder="Tanpa batas"/></label></div>{!valid && <p className="error-text" role="alert">Minimum tidak boleh lebih besar dari maksimum.</p>}<small className="muted">Isi kedua batas dengan angka yang sama untuk nilai tepat, termasuk 0.</small></> : <label className="field"><span>Teks mengandung</span><input ref={first} value={draft.query} onChange={e => set('query', e.target.value)} placeholder={`Cari pada ${column.name.toLowerCase()}…`}/></label>}
      <label className="field"><span>Kelengkapan nilai</span><select value={draft.presence} onChange={e => set('presence', e.target.value)}><option value="">Semua data</option><option value="filled">Memiliki nilai</option><option value="empty">Kosong / belum diisi</option></select></label>
    </div><div className="column-filter-values"><div className="column-filter-value-head"><strong>Pilih nilai</strong><button type="button" className="text-button" onClick={() => set('values', null)}>Semua nilai</button><span className="muted">{draft.values === null ? 'Semua' : `${draft.values.length} dipilih`}</span></div><input aria-label={`Cari pilihan ${column.name}`} value={search} onChange={e => setSearch(e.target.value)} placeholder="Cari pilihan nilai…"/><div className="column-filter-options">{shown.map(o => <label key={o.key}><input type="checkbox" checked={draft.values?.includes(o.key) || false} onChange={() => toggle(o.key)}/><span>{o.label}</span><small>{o.count}</small></label>)}{!found.length && <p className="muted">Pilihan tidak ditemukan.</p>}{found.length > 100 && <p className="muted">100 dari {found.length} pilihan. Persempit pencarian nilai.</p>}</div>{draft.values?.length === 0 && <small className="amber-text">Tidak ada nilai dipilih. Gunakan “Semua nilai” untuk menghapus pembatasan.</small>}</div></div>
    <div className="column-filter-actions"><small className="muted">Berlaku untuk seluruh halaman. Filter antarkolom digabungkan.</small><button type="button" className="btn secondary" onClick={() => onApply(null)}>Reset kolom</button><button type="button" className="btn primary" disabled={!valid} onClick={() => onApply(draft)}>Terapkan filter</button></div>
  </section>;
}

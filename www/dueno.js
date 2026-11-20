/* ==========================================================================
   CONTROL ULISES — DUEÑO (CONECTOR REST DIRECTO + CATÁLOGO + PERMISOS)
   ========================================================================== */

const SUPABASE_URL = 'https://locrbjklkpyxwlchjeri.supabase.co';
const SUPABASE_KEY = 'sb_publishable_k6VjN8Vn-aao-zKXMt6G2w_vXPNQFMq';

const CATEGORIAS_RESPALDO = [
  { id: 'cat-lacteos', nombre: 'Lácteos' },
  { id: 'cat-abarrotes', nombre: 'Abarrotes' },
  { id: 'cat-alimento', nombre: 'Alimento Animal' }
];

/* ---------------- ESTADO GLOBAL ---------------- */
const state = {
  categorias: [...CATEGORIAS_RESPALDO],
  productos: [],
  ventasHoy: [],
  movimientos: [],
  config: {
    nombre_trabajador: 'Trabajador Tienda',
    puede_editar_precio: false,
    puede_registrar_pedido: false
  },
  categoriaActiva: 'todas',
  busquedaProd: '',
  cargando: false,
  periodoActivo: 'hoy',       // 'hoy' | 'ayer' | 'semana' | 'mes' | 'todos'
  categoriaResumen: 'todas'
};

/* ---------------- UTILIDADES ---------------- */
const $ = (id) => document.getElementById(id);

function money(val) {
  return `C$ ${Number(val || 0).toLocaleString('es-NI', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function fmtNum(val) {
  const n = Number(val || 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inicioDeHoyISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function horaCorta(iso) {
  return new Date(iso).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
}

function fechaHoraCorta(iso) {
  return new Date(iso).toLocaleString('es-NI', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function showToast(msg, tipo = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${tipo !== 'info' ? `toast-${tipo}` : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 5500 : 3200);
}

function actualizarBadgeRed() {
  const badge = $('badge-red-dueno');
  const texto = $('texto-red-dueno');
  if (!badge || !texto) return;
  if (navigator.onLine) {
    badge.className = 'pill pill-online';
    texto.textContent = 'En línea';
  } else {
    badge.className = 'pill pill-offline';
    texto.textContent = 'Sin internet';
  }
}

/* ---------------- CLIENTE REST SUPABASE ---------------- */
async function restRequest(tabla, { method = 'GET', query = '', body = null, prefer = '' } = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${tabla}${query ? `?${query}` : ''}`;
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers['Prefer'] = prefer;

  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });

  const texto = await resp.text();
  let data = null;
  if (texto) {
    try {
      data = JSON.parse(texto);
    } catch {
      data = texto;
    }
  }

  if (!resp.ok) {
    const detalle =
      (data && (data.message || data.error || data.hint)) ||
      (typeof data === 'string' ? data : `HTTP ${resp.status}`);
    throw new Error(detalle);
  }

  return data;
}

/* ---------------- CARGA COMPLETA ---------------- */
async function cargarTodo(silencioso = false) {
  if (state.cargando) return;
  actualizarBadgeRed();

  if (!navigator.onLine) {
    renderTodo();
    if (!silencioso) showToast('Sin conexión a internet para actualizar', 'warning');
    return;
  }

  state.cargando = true;
  const errores = [];

  try {
    const [cats, prods, ventas, movs, cfg] = await Promise.allSettled([
      restRequest('categorias', { query: 'select=*&order=nombre.asc' }),
      restRequest('productos', { query: 'select=*&activo=eq.true&order=nombre.asc' }),
      restRequest('ventas', {
        query: 'select=*&order=creada_en.desc&limit=500'
      }),
      restRequest('movimientos_inventario', {
        query: 'select=*&order=creada_en.desc&limit=80'
      }),
      restRequest('configuracion_trabajador', { query: 'select=*&id=eq.1' })
    ]);

    if (cats.status === 'fulfilled') {
      state.categorias =
        Array.isArray(cats.value) && cats.value.length > 0
          ? cats.value
          : [...CATEGORIAS_RESPALDO];
    } else {
      errores.push(`Categorías: ${cats.reason.message}`);
    }

    if (prods.status === 'fulfilled') {
      state.productos = Array.isArray(prods.value) ? prods.value : [];
    } else {
      errores.push(`Productos: ${prods.reason.message}`);
    }

    if (movs.status === 'fulfilled') {
      state.movimientos = Array.isArray(movs.value) ? movs.value : [];
    } else {
      errores.push(`Movimientos: ${movs.reason.message}`);
    }

    if (cfg.status === 'fulfilled' && Array.isArray(cfg.value) && cfg.value[0]) {
      state.config = cfg.value[0];
    }

    if (ventas.status === 'fulfilled') {
      const listaVentas = Array.isArray(ventas.value) ? ventas.value : [];
      const porVenta = {};

      for (let i = 0; i < listaVentas.length; i += 50) {
        const loteIds = listaVentas.slice(i, i + 50).map((v) => v.id).join(',');
        const detalles = await restRequest('detalle_ventas', {
          query: `select=*&venta_id=in.(${loteIds})`
        }).catch(() => []);
        if (Array.isArray(detalles)) {
          detalles.forEach((d) => {
            if (!porVenta[d.venta_id]) porVenta[d.venta_id] = [];
            porVenta[d.venta_id].push(d);
          });
        }
      }

      state.ventasHoy = listaVentas.map((v) => ({
        ...v,
        detalle_ventas: porVenta[v.id] || []
      }));
    } else {
      errores.push(`Ventas: ${ventas.reason.message}`);
    }
    renderTodo();

    if (errores.length > 0) {
      showToast(`Aviso: ${errores[0]}`, 'warning');
    } else if (!silencioso) {
      showToast('Datos actualizados', 'success');
    }
  } catch (err) {
    renderTodo();
    if (!silencioso) showToast(`Error: ${err.message}`, 'error');
  } finally {
    state.cargando = false;
  }
}

/* ---------------- NAVEGACIÓN ---------------- */
function cambiarVista(vistaId) {
  document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa'));
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('activa'));

  const target = $(vistaId);
  if (target) target.classList.add('activa');

  const btn = document.querySelector(`.nav-item[data-vista="${vistaId}"]`);
  if (btn) btn.classList.add('activa');
}

/* ---------------- RENDERIZADO ---------------- */
function nombreCategoria(catId) {
  const c = state.categorias.find((x) => x.id === catId);
  return c ? c.nombre : 'General';
}

function nombreProducto(prodId) {
  const p = state.productos.find((x) => x.id === prodId);
  return p ? p.nombre : 'Producto';
}

function obtenerVentasFiltradas() {
  const ahora = new Date();
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  const inicioAyer = new Date(inicioHoy);
  inicioAyer.setDate(inicioAyer.getDate() - 1);

  const inicioSemana = new Date(inicioHoy);
  const dia = inicioSemana.getDay();
  const diffLunes = dia === 0 ? 6 : dia - 1;
  inicioSemana.setDate(inicioSemana.getDate() - diffLunes);

  const inicioMes = new Date(inicioHoy);
  inicioMes.setDate(inicioMes.getDate() - 30);

  const porFecha = state.ventasHoy.filter((v) => {
    const f = new Date(v.creada_en);
    if (state.periodoActivo === 'hoy') return f >= inicioHoy;
    if (state.periodoActivo === 'ayer') return f >= inicioAyer && f < inicioHoy;
    if (state.periodoActivo === 'semana') return f >= inicioSemana;
    if (state.periodoActivo === 'mes') return f >= inicioMes;
    return true; // 'todos'
  });

  if (state.categoriaResumen === 'todas') return porFecha;

  return porFecha
    .map((v) => {
      const dets = (v.detalle_ventas || []).filter((d) => {
        const prod = state.productos.find((p) => p.id === d.producto_id);
        return prod && prod.categoria_id === state.categoriaResumen;
      });
      if (!dets.length) return null;
      const totalCat = dets.reduce((s, d) => s + Number(d.subtotal || 0), 0);
      return { ...v, total: totalCat, detalle_ventas: dets };
    })
    .filter(Boolean);
}

function etiquetaPeriodo() {
  const mapa = {
    hoy: 'hoy',
    ayer: 'ayer',
    semana: 'esta semana',
    mes: 'último mes',
    todos: 'histórico total'
  };
  return mapa[state.periodoActivo] || 'hoy';
}

function calcularResumenProductos(ventasFiltradas) {
  const mapa = new Map();
  let totalUnidades = 0;

  ventasFiltradas.forEach((v) => {
    (v.detalle_ventas || []).forEach((d) => {
      const clave = d.producto_id || d.nombre_producto;
      const actual = mapa.get(clave) || {
        producto_id: d.producto_id,
        nombre: d.nombre_producto,
        vendido: 0,
        dinero: 0
      };
      actual.vendido += Number(d.cantidad || 0);
      actual.dinero += Number(d.subtotal || 0);
      totalUnidades += Number(d.cantidad || 0);
      mapa.set(clave, actual);
    });
  });

  const lista = Array.from(mapa.values()).map((item) => {
    const prod = state.productos.find((p) => p.id === item.producto_id);
    return {
      ...item,
      stock_restante: prod ? Number(prod.stock_actual) : null,
      stock_minimo: prod ? Number(prod.stock_minimo) : 5
    };
  });

  lista.sort((a, b) => b.dinero - a.dinero);
  return { lista, totalUnidades };
}

function renderChipsResumen() {
  document.querySelectorAll('#chips-periodo-resumen .chip').forEach((btn) => {
    btn.classList.toggle('activa', btn.dataset.periodo === state.periodoActivo);
  });

  const contCat = $('chips-categorias-resumen');
  if (!contCat) return;
  contCat.innerHTML = [
    `<button type="button" class="chip ${state.categoriaResumen === 'todas' ? 'activa' : ''}" data-cat-resumen="todas">Todas las categorías</button>`,
    ...state.categorias.map(
      (c) =>
        `<button type="button" class="chip ${state.categoriaResumen === c.id ? 'activa' : ''}" data-cat-resumen="${esc(c.id)}">${esc(c.nombre)}</button>`
    )
  ].join('');
}

function renderTodo() {
  renderResumen();
  renderChipsCategorias();
  renderProductos();
  renderMovimientos();
  renderPermisosYCategorias();
}
function renderResumen() {
  renderChipsResumen();

  const ventasFiltradas = obtenerVentasFiltradas();
  const totalPeriodo = ventasFiltradas.reduce((sum, v) => sum + Number(v.total || 0), 0);
  const { lista: resumenProds, totalUnidades } = calcularResumenProductos(ventasFiltradas);

  // Ordenar "Por agotarse" de MENOR a MAYOR stock (0 arriba, luego 1, 2, 3...)
  const bajos = state.productos
    .filter((p) => Number(p.stock_actual) <= Number(p.stock_minimo))
    .filter((p) => state.categoriaResumen === 'todas' || p.categoria_id === state.categoriaResumen)
    .sort((a, b) => Number(a.stock_actual) - Number(b.stock_actual) || a.nombre.localeCompare(b.nombre));

  const sufijoCat =
    state.categoriaResumen === 'todas' ? '' : ` • ${nombreCategoria(state.categoriaResumen)}`;
  $('label-total-periodo').textContent = `Total vendido (${etiquetaPeriodo()}${sufijoCat})`;
  $('titulo-resumen-productos').textContent = `Vendido (${etiquetaPeriodo()}) y stock restante`;
  $('titulo-facturas-periodo').textContent =
    state.periodoActivo === 'todos'
      ? 'Historial de facturas por mes'
      : `Facturas (${etiquetaPeriodo()})`;

  $('kpi-total-dia').textContent = money(totalPeriodo);
  $('kpi-num-ventas').textContent = String(ventasFiltradas.length);
  $('kpi-unidades-vendidas').textContent = fmtNum(totalUnidades);
  $('kpi-total-productos').textContent = String(state.productos.length);
  $('kpi-stock-bajo').textContent = String(bajos.length);

  // Alertas de stock bajo
  const bloqueAlertas = $('bloque-alertas-stock');
  const contBajos = $('lista-stock-bajo');
  if (!bajos.length) {
    bloqueAlertas.classList.add('oculto');
  } else {
    bloqueAlertas.classList.remove('oculto');
    contBajos.innerHTML = bajos
      .map(
        (p) => `
        <div class="item-row">
          <div class="item-main">
            <div class="item-title">${esc(p.nombre)}</div>
            <div class="item-meta">Mínimo configurado: ${fmtNum(p.stock_minimo)}</div>
          </div>
          <div class="item-right">
            <span class="badge-status badge-low">Quedan ${fmtNum(p.stock_actual)}</span>
          </div>
        </div>
      `
      )
      .join('');
  }

  // Vendido vs stock restante
  const contResumen = $('lista-resumen-productos');
  if (!resumenProds.length) {
    contResumen.innerHTML = `<div class="empty-state-sm">No hay ventas registradas en este filtro.</div>`;
  } else {
    contResumen.innerHTML = resumenProds
      .map((r) => {
        const quedaTexto =
          r.stock_restante === null ? 'Sin dato' : `Quedan ${fmtNum(r.stock_restante)}`;
        const badgeClase =
          r.stock_restante !== null && r.stock_restante <= r.stock_minimo ? 'badge-low' : 'badge-ok';

        return `
          <div class="item-row">
            <div class="item-main">
              <div class="item-title">${esc(r.nombre)}</div>
              <div class="item-meta">
                <span>Vendió: <strong>${fmtNum(r.vendido)}</strong></span>
              </div>
            </div>
            <div class="item-right">
              <span class="item-amount">${money(r.dinero)}</span>
              <span class="badge-status ${badgeClase}">${quedaTexto}</span>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Facturas (agrupadas por mes y ordenadas por fecha cuando es "Todos")
  const contFacturas = $('lista-facturas-dueno');
  if (!ventasFiltradas.length) {
    contFacturas.innerHTML = `<div class="empty-state-sm">Sin movimientos en este período.</div>`;
    return;
  }

  const renderFilaFactura = (v, mostrarFecha) => {
    const numItems = (v.detalle_ventas || []).reduce((s, d) => s + Number(d.cantidad || 0), 0);
    const etiquetaHora = mostrarFecha ? fechaHoraCorta(v.creada_en) : horaCorta(v.creada_en);
    const ajustes = buscarAjustesDeVenta(v);
    const etiquetaMod = ajustes.length
      ? `<span class="badge-status badge-pending">Modificada</span>`
      : '';

    return `
      <div class="item-row clickable" data-venta-id="${esc(v.id)}">
        <div class="item-main">
          <div class="item-title">Factura • ${etiquetaHora}</div>
          <div class="item-meta">${fmtNum(numItems)} unidad(es) — toca para ver detalle</div>
        </div>
        <div class="item-right">
          <span class="item-amount">${money(v.total)}</span>
          ${etiquetaMod}
          <span class="badge-status badge-synced">Ver →</span>
        </div>
      </div>
    `;
  };

  if (state.periodoActivo === 'todos') {
    const grupos = new Map();
    ventasFiltradas.forEach((v) => {
      const f = new Date(v.creada_en);
      const claveMes = `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
      const tituloMes = f.toLocaleDateString('es-NI', { month: 'long', year: 'numeric' });
      if (!grupos.has(claveMes)) grupos.set(claveMes, { titulo: tituloMes, ventas: [] });
      grupos.get(claveMes).ventas.push(v);
    });

    let html = '';
    grupos.forEach((grupo) => {
      const totalMes = grupo.ventas.reduce((s, x) => s + Number(x.total || 0), 0);
      html += `<div class="month-group-title">${esc(grupo.titulo)} — ${money(totalMes)} (${grupo.ventas.length})</div>`;
      html += grupo.ventas.map((v) => renderFilaFactura(v, true)).join('');
    });
    contFacturas.innerHTML = html;
 } else {
    const mostrarFecha = state.periodoActivo !== 'hoy';
    contFacturas.innerHTML = ventasFiltradas.map((v) => renderFilaFactura(v, mostrarFecha)).join('');
  }
}

function renderChipsCategorias() {
  const cont = $('chips-categorias-dueno');
  cont.innerHTML = [
    `<button type="button" class="chip ${state.categoriaActiva === 'todas' ? 'activa' : ''}" data-categoria="todas">Todos</button>`,
    ...state.categorias.map(
      (c) =>
        `<button type="button" class="chip ${state.categoriaActiva === c.id ? 'activa' : ''}" data-categoria="${esc(c.id)}">${esc(c.nombre)}</button>`
    )
  ].join('');
}

function renderProductos() {
  const cont = $('lista-productos-dueno');
  const q = state.busquedaProd.trim().toLowerCase();

  const filtrados = state.productos.filter((p) => {
    const matchCat = state.categoriaActiva === 'todas' || p.categoria_id === state.categoriaActiva;
    const matchQ = !q || p.nombre.toLowerCase().includes(q);
    return matchCat && matchQ;
  });

  if (!filtrados.length) {
    cont.innerHTML = `<div class="empty-state">No hay productos registrados. Toca "+ Nuevo" para agregar el primero.</div>`;
    return;
  }

  cont.innerHTML = filtrados
    .map((p) => {
      const bajo = Number(p.stock_actual) <= Number(p.stock_minimo);
      return `
        <div class="item-row clickable" data-edit-prod="${esc(p.id)}">
          <div class="item-main">
            <div class="item-title">${esc(p.nombre)}</div>
            <div class="item-meta">
              <span>${esc(nombreCategoria(p.categoria_id))}</span>
              <span>•</span>
              <span>Precio: <strong>${money(p.precio_venta)}</strong></span>
            </div>
          </div>
          <div class="item-right">
            <span class="item-amount">${fmtNum(p.stock_actual)}</span>
            <span class="badge-status ${bajo ? 'badge-low' : 'badge-ok'}">${bajo ? 'Stock bajo' : 'En stock'}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderMovimientos() {
  const select = $('select-prod-movimiento');
  const actual = select.value;
  select.innerHTML =
    `<option value="">Selecciona un producto...</option>` +
    state.productos
      .map((p) => `<option value="${esc(p.id)}">${esc(p.nombre)} (Quedan: ${fmtNum(p.stock_actual)})</option>`)
      .join('');
  if (actual) select.value = actual;

  const cont = $('lista-movimientos-recientes');
  if (!state.movimientos.length) {
    cont.innerHTML = `<div class="empty-state-sm">Sin movimientos registrados todavía.</div>`;
    return;
  }

  cont.innerHTML = state.movimientos
    .map((m) => {
      const nombreProd = nombreProducto(m.producto_id);
      const esEntrada = m.tipo === 'entrada';
      const esVenta = m.tipo === 'venta';
      const esAjuste = m.tipo === 'ajuste';
      const signo = Number(m.cantidad) > 0 ? '+' : '';
      const badgeClase = esEntrada ? 'badge-entry' : esVenta ? 'badge-pending' : 'badge-adjust';
      const tipoLabel = esEntrada
        ? 'Entrada'
        : esVenta
          ? 'Venta'
          : Number(m.cantidad) > 0
            ? 'Devolución'
            : 'Ajuste';

      const tituloMov = esAjuste
        ? `${nombreProd} • ${Number(m.cantidad) > 0 ? 'Devuelto a stock' : 'Ajustado en venta'}`
        : nombreProd;

      return `
        <div class="item-row">
          <div class="item-main">
            <div class="item-title">${esc(tituloMov)}</div>
            <div class="item-meta">
              <span>${fechaHoraCorta(m.creada_en)}</span>
              ${m.nota ? `<span>•</span><span>${esc(m.nota)}</span>` : ''}
            </div>
          </div>
          <div class="item-right">
            <span class="item-amount">${signo}${fmtNum(m.cantidad)}</span>
            <span class="badge-status ${badgeClase}">${tipoLabel}</span>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderPermisosYCategorias() {
  $('input-nombre-trabajador').value = state.config.nombre_trabajador || 'Trabajador Tienda';
  $('toggle-editar-precio').checked = Boolean(state.config.puede_editar_precio);
  $('toggle-registrar-pedido').checked = Boolean(state.config.puede_registrar_pedido);

  const contCats = $('lista-categorias-config');
  contCats.innerHTML = state.categorias.length
    ? state.categorias
        .map((c) => {
          const esReal = !String(c.id).startsWith('cat-');
          return `
            <span class="tag-chip">
              <span>${esc(c.nombre)}</span>
              ${
                esReal
                  ? `<button type="button" class="tag-chip-del" data-del-cat="${esc(c.id)}" data-cat-nombre="${esc(c.nombre)}" title="Eliminar categoría" aria-label="Eliminar ${esc(c.nombre)}">✕</button>`
                  : ''
              }
            </span>
          `;
        })
        .join('')
    : `<span class="modal-subtitle">Sin categorías todavía</span>`;

  const selProdCat = $('prod-categoria');
  const valActual = selProdCat.value;
  selProdCat.innerHTML =
    `<option value="">Selecciona una categoría...</option>` +
    state.categorias.map((c) => `<option value="${esc(c.id)}">${esc(c.nombre)}</option>`).join('') +
    `<option value="__nueva__">+ Agregar nueva categoría...</option>`;
  if (valActual && valActual !== '__nueva__') selProdCat.value = valActual;
}

/* ---------------- MODAL PRODUCTO ---------------- */
function abrirModalProducto(productoId = null) {
  renderPermisosYCategorias();
  const form = $('form-producto');
  form.reset();

  if (productoId) {
    const p = state.productos.find((x) => x.id === productoId);
    if (!p) return;
    $('titulo-modal-producto').textContent = 'Editar producto';
    $('prod-id').value = p.id;
    $('prod-nombre').value = p.nombre;
    $('prod-categoria').value = p.categoria_id || '';
    $('prod-precio').value = p.precio_venta;
    $('prod-stock').value = p.stock_actual;
    $('prod-stock-min').value = p.stock_minimo;
    $('btn-eliminar-producto').classList.remove('oculto');
  } else {
    $('titulo-modal-producto').textContent = 'Nuevo producto';
    $('prod-id').value = '';
    $('prod-stock-min').value = '5';
    $('btn-eliminar-producto').classList.add('oculto');
  }

  $('modal-producto').classList.remove('oculto');
}

function cerrarModalProducto() {
  $('modal-producto').classList.add('oculto');
}

async function guardarProducto(e) {
  e.preventDefault();
  if (!navigator.onLine) {
    showToast('Necesitas internet para guardar productos', 'warning');
    return;
  }

  const id = $('prod-id').value;
  const catSeleccionada = $('prod-categoria').value;
  const categoriaIdReal =
    catSeleccionada && !catSeleccionada.startsWith('cat-') ? catSeleccionada : null;

  const payload = {
    nombre: $('prod-nombre').value.trim(),
    categoria_id: categoriaIdReal,
    precio_venta: Number($('prod-precio').value),
    stock_actual: Number($('prod-stock').value),
    stock_minimo: Number($('prod-stock-min').value),
    actualizado_en: new Date().toISOString()
  };

  if (!payload.nombre) return;

  try {
    if (id) {
      await restRequest('productos', {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(id)}`,
        body: payload,
        prefer: 'return=representation'
      });
      showToast('Producto actualizado', 'success');
    } else {
      await restRequest('productos', {
        method: 'POST',
        body: { ...payload, activo: true },
        prefer: 'return=representation'
      });
      showToast('Producto creado en el catálogo', 'success');
    }

    cerrarModalProducto();
    await cargarTodo(true);
  } catch (err) {
    showToast(`Error al guardar: ${err.message}`, 'error');
  }
}

async function desactivarProducto() {
  const id = $('prod-id').value;
  if (!id) return;
  if (!confirm('¿Quitar este producto del catálogo activo?')) return;

  try {
    await restRequest('productos', {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(id)}`,
      body: { activo: false, actualizado_en: new Date().toISOString() }
    });
    cerrarModalProducto();
    showToast('Producto desactivado', 'success');
    await cargarTodo(true);
  } catch (err) {
    showToast(`Error al desactivar: ${err.message}`, 'error');
  }
}

function buscarAjustesDeVenta(venta) {
  const codigo = String(venta?.id_local || venta?.id || '').slice(0, 8);
  if (!codigo) return [];
  return (state.movimientos || []).filter(
    (m) => m.tipo === 'ajuste' && String(m.nota || '').includes(codigo)
  );
}

/* ---------------- DETALLE DE FACTURA ---------------- */
function abrirDetalleVenta(ventaId) {
  const venta = state.ventasHoy.find((v) => v.id === ventaId);
  if (!venta) return;

  $('fecha-detalle-venta').textContent = fechaHoraCorta(venta.creada_en);
  $('total-detalle-venta').textContent = money(venta.total);

  const items = venta.detalle_ventas || [];
  $('lista-items-detalle-venta').innerHTML = items.length
    ? items
        .map(
          (i) => `
          <div class="item-row">
            <div class="item-main">
              <div class="item-title">${esc(i.nombre_producto)}</div>
              <div class="item-meta">${fmtNum(i.cantidad)} × ${money(i.precio_unitario)}</div>
            </div>
            <div class="item-right">
              <span class="item-amount">${money(i.subtotal)}</span>
            </div>
          </div>
        `
        )
        .join('')
    : `<div class="empty-state-sm">Sin detalle disponible.</div>`;
    
    const ajustes = buscarAjustesDeVenta(venta);
  if (ajustes.length) {
    const notasHtml = ajustes
      .map(
        (a) =>
          `<div class="empty-state-sm" style="text-align:left;">
            <strong>${Number(a.cantidad) > 0 ? 'Devolución' : 'Cambio'}:</strong> ${esc(nombreProducto(a.producto_id))} (${Number(a.cantidad) > 0 ? '+' : ''}${fmtNum(a.cantidad)}) — ${esc(a.nota || '')}
          </div>`
      )
      .join('');
    $('lista-items-detalle-venta').innerHTML += notasHtml;
  }

  $('modal-detalle-venta').classList.remove('oculto');
}

/* ---------------- MOVIMIENTOS DE INVENTARIO ---------------- */
async function guardarMovimiento(e) {
  e.preventDefault();
  if (!navigator.onLine) {
    showToast('Necesitas internet para registrar movimientos', 'warning');
    return;
  }

  const productoId = $('select-prod-movimiento').value;
  const tipo = $('select-tipo-movimiento').value;
  const cantidad = Number($('input-cant-movimiento').value);
  const nota = $('input-nota-movimiento').value.trim();

  if (!productoId || isNaN(cantidad) || cantidad === 0) {
    showToast('Verifica el producto y la cantidad', 'error');
    return;
  }
  if (tipo === 'entrada' && cantidad < 0) {
    showToast('Una entrada de pedido debe ser positiva', 'warning');
    return;
  }

  try {
    const filas = await restRequest('productos', {
      query: `select=stock_actual,nombre&id=eq.${encodeURIComponent(productoId)}`
    });
    const prod = Array.isArray(filas) ? filas[0] : null;
    if (!prod) throw new Error('Producto no encontrado');

    const nuevoStock = Math.max(0, Number(prod.stock_actual) + cantidad);

    await restRequest('productos', {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(productoId)}`,
      body: { stock_actual: nuevoStock, actualizado_en: new Date().toISOString() }
    });

    await restRequest('movimientos_inventario', {
      method: 'POST',
      body: {
        producto_id: productoId,
        tipo,
        cantidad,
        nota: nota || (tipo === 'entrada' ? 'Pedido ingresado por dueño' : 'Ajuste manual')
      }
    });

    $('form-movimiento-dueno').reset();
    showToast(`Stock de ${prod.nombre} actualizado a ${fmtNum(nuevoStock)}`, 'success');
    await cargarTodo(true);
  } catch (err) {
    showToast(`Error al registrar: ${err.message}`, 'error');
  }
}

/* ---------------- PERMISOS Y CATEGORÍAS ---------------- */
async function guardarPermisos() {
  if (!navigator.onLine) {
    showToast('Necesitas internet para guardar permisos', 'warning');
    return;
  }

  const payload = {
    id: 1,
    nombre_trabajador: $('input-nombre-trabajador').value.trim() || 'Trabajador Tienda',
    puede_editar_precio: $('toggle-editar-precio').checked,
    puede_registrar_pedido: $('toggle-registrar-pedido').checked,
    actualizado_en: new Date().toISOString()
  };

  try {
    await restRequest('configuracion_trabajador', {
      method: 'POST',
      body: payload,
      prefer: 'resolution=merge-duplicates,return=representation'
    });
    state.config = payload;
    showToast('Permisos actualizados para el trabajador', 'success');
  } catch (err) {
    showToast(`Error al guardar permisos: ${err.message}`, 'error');
  }
}

async function agregarCategoria(e) {
  e.preventDefault();
  const nombre = $('input-nueva-categoria').value.trim();
  if (!nombre) return;

  try {
    await restRequest('categorias', {
      method: 'POST',
      body: { nombre },
      prefer: 'return=representation'
    });
    $('input-nueva-categoria').value = '';
    showToast(`Categoría "${nombre}" agregada`, 'success');
    await cargarTodo(true);
  } catch (err) {
    showToast(`No se pudo crear: ${err.message}`, 'warning');
  }
}

async function crearCategoriaDesdeSelector() {
  const sel = $('prod-categoria');
  const nombre = prompt('Nombre de la nueva categoría (ej. Bebidas, Granos):');

  if (!nombre || !nombre.trim()) {
    sel.value = '';
    return;
  }

  try {
    const creada = await restRequest('categorias', {
      method: 'POST',
      body: { nombre: nombre.trim() },
      prefer: 'return=representation'
    });
    const nuevaCat = Array.isArray(creada) ? creada[0] : creada;
    showToast(`Categoría "${nombre.trim()}" creada`, 'success');
    await cargarTodo(true);
    if (nuevaCat && nuevaCat.id) {
      $('prod-categoria').value = nuevaCat.id;
    }
  } catch (err) {
    sel.value = '';
    showToast(`No se pudo crear: ${err.message}`, 'warning');
  }
}

async function eliminarCategoria(catId, nombre) {
  if (!confirm(`¿Eliminar la categoría "${nombre}"? Los productos que la tenían quedarán en "General".`)) {
    return;
  }

  try {
    await restRequest('categorias', {
      method: 'DELETE',
      query: `id=eq.${encodeURIComponent(catId)}`
    });
    if (state.categoriaActiva === catId) {
      state.categoriaActiva = 'todas';
    }
    showToast(`Categoría "${nombre}" eliminada`, 'success');
    await cargarTodo(true);
  } catch (err) {
    showToast(`Error al eliminar categoría: ${err.message}`, 'error');
  }
}

/* ---------------- COPIAR REPORTE DEL DÍA ---------------- */
async function copiarReporteDelDia() {
  const ventasFiltradas = obtenerVentasFiltradas();
  if (!ventasFiltradas.length) {
    showToast('No hay ventas en este período para reportar', 'warning');
    return;
  }

  const totalDia = ventasFiltradas.reduce((s, v) => s + Number(v.total || 0), 0);
  const { lista } = calcularResumenProductos(ventasFiltradas);
  const fecha = new Date().toLocaleDateString('es-NI', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  });

  const lineas = [
    `*CIERRE DEL DÍA — DISTRIBUIDORA ULISES*`,
    `Fecha: ${fecha}`,
    `Total vendido: *${money(totalDia)}* (${state.ventasHoy.length} ventas)`,
    ``,
    `*Detalle por producto:*`,
    ...lista.map(
      (r) =>
        `• ${r.nombre}: vendió ${fmtNum(r.vendido)} (${money(r.dinero)}) | Quedan: ${
          r.stock_restante === null ? '—' : fmtNum(r.stock_restante)
        }`
    )
  ];

  const bajos = state.productos.filter((p) => Number(p.stock_actual) <= Number(p.stock_minimo));
  if (bajos.length) {
    lineas.push('', '*Stock bajo (reponer):*');
    bajos.forEach((p) => lineas.push(`• ${p.nombre}: quedan ${fmtNum(p.stock_actual)}`));
  }

  const texto = lineas.join('\n');
  try {
    await navigator.clipboard.writeText(texto);
    showToast('Reporte copiado. Listo para pegar en WhatsApp', 'success');
  } catch {
    prompt('Copia el reporte del día:', texto);
  }
}

/* ---------------- EVENTOS E INICIO ---------------- */
function bindEventos() {
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      cambiarVista(btn.dataset.vista);
      if (navigator.onLine) cargarTodo(true);
    });
  });

  $('btn-refrescar-todo').addEventListener('click', () => cargarTodo(false));
  $('btn-copiar-cierre').addEventListener('click', copiarReporteDelDia);

  $('btn-nuevo-producto').addEventListener('click', () => abrirModalProducto(null));
  $('btn-cerrar-modal-producto').addEventListener('click', cerrarModalProducto);
  $('form-producto').addEventListener('submit', guardarProducto);
  $('btn-eliminar-producto').addEventListener('click', desactivarProducto);

  $('input-buscar-dueno').addEventListener('input', (e) => {
    state.busquedaProd = e.target.value;
    renderProductos();
  });

  $('chips-categorias-dueno').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.categoriaActiva = chip.dataset.categoria;
    renderChipsCategorias();
    renderProductos();
  });

  $('lista-productos-dueno').addEventListener('click', (e) => {
    const row = e.target.closest('[data-edit-prod]');
    if (row) abrirModalProducto(row.dataset.editProd);
  });

  $('lista-facturas-dueno').addEventListener('click', (e) => {
    const row = e.target.closest('[data-venta-id]');
    if (row) abrirDetalleVenta(row.dataset.ventaId);
  });
  $('btn-cerrar-detalle-venta').addEventListener('click', () =>
    $('modal-detalle-venta').classList.add('oculto')
  );

  $('form-movimiento-dueno').addEventListener('submit', guardarMovimiento);
  $('btn-guardar-permisos').addEventListener('click', guardarPermisos);
  $('form-nueva-categoria').addEventListener('submit', agregarCategoria);

  $('prod-categoria').addEventListener('change', (e) => {
    if (e.target.value === '__nueva__') {
      crearCategoriaDesdeSelector();
    }
  });

  $('chips-periodo-resumen').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-periodo]');
    if (!chip) return;
    state.periodoActivo = chip.dataset.periodo;
    renderResumen();
  });

  $('chips-categorias-resumen').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat-resumen]');
    if (!chip) return;
    state.categoriaResumen = chip.dataset.catResumen;
    renderResumen();
  });

  $('lista-categorias-config').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del-cat]');
    if (!btn) return;
    eliminarCategoria(btn.dataset.delCat, btn.dataset.catNombre);
  });

  window.addEventListener('online', () => {
    actualizarBadgeRed();
    cargarTodo(true);
  });
  window.addEventListener('offline', actualizarBadgeRed);

 setInterval(() => {
    const hayModalAbierto =
      !$('modal-producto').classList.contains('oculto') ||
      !$('modal-detalle-venta').classList.contains('oculto');
    if (navigator.onLine && !hayModalAbierto && !state.cargando) {
      cargarTodo(true);
    }
  }, 10000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      cargarTodo(true);
    }
  });
}

function initDueno() {
  $('fecha-hoy-header').textContent = new Date().toLocaleDateString('es-NI', {
    weekday: 'short',
    day: '2-digit',
    month: 'short'
  });
  renderTodo();
  bindEventos();
  cargarTodo(true);
}

document.addEventListener('DOMContentLoaded', initDueno);
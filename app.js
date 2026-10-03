(function () {
  "use strict";

  const state = { rows: [], fileName: "", duplicates: 0 };
  const fields = {
    ot: "OT", unit: "Unidad", maintenance: "Tipo_mantenimiento", labor: "Horas_mano_obra",
    downtime: "Downtime_h", cost: "Costo_total_CLP", repair: "Tiempo_reparacion_h",
    start: "Fecha_inicio", end: "Fecha_fin", equipment: "Equipo", equipmentType: "Tipo_equipo",
    failure: "Modo_falla", status: "Estado", planned: "Planificado", criticality: "Criticidad"
  };
  const colors = { "q-severe": "#bc5944", "q-chronic": "#d68c3f", "q-acute": "#5584a0", "q-control": "#4d9b7a" };
  const numberFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 1 });
  const currencyFormat = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 });
  const $ = (id) => document.getElementById(id);

  function clean(value) {
    return String(value == null ? "" : value).replace(/^\uFEFF/, "").replace(/^'+/, "").trim();
  }

  function parseCSV(text) {
    const source = text.replace(/^\uFEFF/, "");
    const firstLine = source.split(/\r?\n/, 1)[0] || "";
    const delimiter = [",", ";", "\t"].map((candidate) => ({ candidate, count: (firstLine.match(new RegExp(candidate === "\t" ? "\\t" : candidate, "g")) || []).length })).sort((a, b) => b.count - a.count)[0].candidate;
    const records = [];
    let row = [], value = "", quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (character === '"' && source[index + 1] === '"') { value += '"'; index += 1; }
        else if (character === '"') quoted = false;
        else value += character;
      } else if (character === '"') quoted = true;
      else if (character === delimiter) { row.push(value); value = ""; }
      else if (character === "\n" || character === "\r") {
        if (character === "\r" && source[index + 1] === "\n") index += 1;
        row.push(value); value = "";
        if (row.some((cell) => cell.trim() !== "")) records.push(row);
        row = [];
      } else value += character;
    }
    if (value.length || row.length) { row.push(value); if (row.some((cell) => cell.trim() !== "")) records.push(row); }
    if (records.length < 2) throw new Error("El archivo no contiene filas de datos.");
    const headers = records.shift().map(clean);
    const seen = new Set();
    const rows = [];
    records.forEach((cells) => {
      const record = {};
      headers.forEach((header, index) => { record[header] = clean(cells[index]); });
      if (fields.maintenance in record) record[fields.maintenance] = normalizeMaintenance(record[fields.maintenance]);
      if (fields.status in record) record[fields.status] = normalizeStatus(record[fields.status]);
      if (fields.planned in record) record[fields.planned] = normalizePlanned(record[fields.planned]);
      const signature = JSON.stringify(headers.map((header) => record[header] || ""));
      if (seen.has(signature)) return;
      seen.add(signature);
      rows.push(record);
    });
    return { rows, duplicates: records.length - rows.length, headers };
  }

  function numeric(value) {
    let text = clean(value).replace(/[\s$\u00a0]/g, "");
    if (!text) return 0;
    const comma = text.lastIndexOf(","), dot = text.lastIndexOf(".");
    if (comma >= 0 && dot >= 0) {
      const decimal = comma > dot ? "," : ".";
      text = text.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".");
    } else if (comma >= 0) {
      text = /,\d{1,3}$/.test(text) ? text.replace(",", ".") : text.replace(/,/g, "");
    } else if ((text.match(/\./g) || []).length > 1) {
      const parts = text.split(".");
      text = parts.slice(0, -1).join("") + "." + parts.at(-1);
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function dateValue(value) {
    const text = clean(value);
    if (!text) return null;
    let match = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match) return new Date(+match[3], +match[2] - 1, +match[1], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
    match = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) return new Date(+match[1], +match[2] - 1, +match[3], +(match[4] || 0), +(match[5] || 0), +(match[6] || 0));
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  function fmt(value, digits) { return numberFormat.format(Number.isFinite(value) ? value : 0); }
  function fmtPct(value) { return `${fmt(value, 1)}%`; }
  function total(rows, field) { return rows.reduce((sum, row) => sum + numeric(row[field]), 0); }
  function unique(rows, field) { return new Set(rows.map((row) => clean(row[field])).filter(Boolean)).size; }
  function mean(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  function groupBy(rows, field) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = clean(row[field]) || "Sin dato";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }
  function filterRows() {
    const unit = $("unit-filter").value, maintenance = $("maintenance-filter").value;
    return state.rows.filter((row) => (!unit || clean(row[fields.unit]) === unit) && (!maintenance || normalizeMaintenance(row[fields.maintenance]) === maintenance));
  }
  function normalizeMaintenance(value) {
    const cleaned = clean(value).replace(/\s+/g, " ");
    const text = categoryKey(cleaned);
    if (["correctivo", "correctiva"].includes(text)) return "Correctivo";
    if (["preventiva", "preventivo"].includes(text)) return "Preventivo";
    if (["predictivo", "predictiva"].includes(text)) return "Predictivo";
    return cleaned ? `${cleaned[0].toLocaleUpperCase("es")}${cleaned.slice(1).toLocaleLowerCase("es")}` : "Sin dato";
  }

  function categoryKey(value) {
    return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").toLocaleLowerCase("es");
  }

  function normalizeStatus(value) {
    const cleaned = clean(value).replace(/\s+/g, " ");
    const text = categoryKey(cleaned);
    if (["cerrada", "cerrado"].includes(text)) return "CERRADA";
    if (["abierta", "abierto"].includes(text)) return "ABIERTA";
    if (["en ejecucion", "ejecutando"].includes(text)) return "EN EJECUCIÓN";
    return cleaned ? `${cleaned[0].toLocaleUpperCase("es")}${cleaned.slice(1).toLocaleLowerCase("es")}` : "Sin dato";
  }

  function normalizePlanned(value) {
    const cleaned = clean(value);
    const text = categoryKey(cleaned);
    if (text === "si") return "Sí";
    if (text === "no") return "No";
    return cleaned ? `${cleaned[0].toLocaleUpperCase("es")}${cleaned.slice(1).toLocaleLowerCase("es")}` : "Sin dato";
  }
  function populateFilters() {
    const units = [...new Set(state.rows.map((row) => clean(row[fields.unit])).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const types = [...new Set(state.rows.map((row) => normalizeMaintenance(row[fields.maintenance])).filter((value) => value !== "Sin dato"))].sort((a, b) => a.localeCompare(b, "es"));
    $("unit-filter").innerHTML = '<option value="">Todas las unidades</option>' + units.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join("");
    $("maintenance-filter").innerHTML = '<option value="">Todos los tipos</option>' + types.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join("");
  }

  function renderKpis(rows) {
    const totalOrders = unique(rows, fields.ot);
    const labor = total(rows, fields.labor), downtime = total(rows, fields.downtime), cost = total(rows, fields.cost);
    const correctives = rows.filter((row) => normalizeMaintenance(row[fields.maintenance]) === "Correctivo");
    const validRepairs = correctives.filter((row) => {
      const start = dateValue(row[fields.start]), end = dateValue(row[fields.end]);
      return start && end && end >= start && numeric(row[fields.repair]) > 0 && (!clean(row[fields.status]) || /cerrad/i.test(clean(row[fields.status])));
    }).map((row) => numeric(row[fields.repair]));
    $("kpi-orders").textContent = numberFormat.format(totalOrders);
    $("kpi-labor").textContent = fmt(labor);
    $("kpi-downtime").textContent = fmt(downtime);
    $("kpi-cost").textContent = currencyFormat.format(cost);
    $("kpi-mttr").textContent = validRepairs.length ? fmt(mean(validRepairs)) : "N/D";
    $("kpi-median").textContent = validRepairs.length ? fmt(median(validRepairs)) : "N/D";
    const correct = rows.filter((row) => normalizeMaintenance(row[fields.maintenance]) === "Correctivo");
    const orderPct = totalOrders ? unique(correct, fields.ot) / totalOrders * 100 : 0;
    const laborPct = labor ? total(correct, fields.labor) / labor * 100 : 0;
    const downtimePct = downtime ? total(correct, fields.downtime) / downtime * 100 : 0;
    const costPct = cost ? total(correct, fields.cost) / cost * 100 : 0;
    $("key-finding").innerHTML = `<span class="finding-mark">!</span><div><span class="finding-label">HALLAZGO CLAVE</span><p>El mantenimiento correctivo representa el <b>${fmtPct(orderPct)}</b> de las OT, consume el <b>${fmtPct(laborPct)}</b> de las horas-hombre, concentra el <b>${fmtPct(downtimePct)}</b> del downtime y genera el <b>${fmtPct(costPct)}</b> del costo directo.</p></div>`;
    $("scope-note").textContent = $("unit-filter").value || $("maintenance-filter").value ? "ALCANCE FILTRADO" : "VISIÓN GENERAL";
    return { totalOrders, labor, downtime, cost, validRepairs, mttr: mean(validRepairs) };
  }

  function renderMix(rows) {
    const grand = { orders: unique(rows, fields.ot), labor: total(rows, fields.labor), downtime: total(rows, fields.downtime), cost: total(rows, fields.cost) };
    const normalizedGroups = new Map();
    rows.forEach((row) => {
      const type = normalizeMaintenance(row[fields.maintenance]);
      if (!normalizedGroups.has(type)) normalizedGroups.set(type, []);
      normalizedGroups.get(type).push(row);
    });
    const groups = [...normalizedGroups.entries()].map(([type, records]) => ({
      type, records,
      orders: grand.orders ? unique(records, fields.ot) / grand.orders * 100 : 0,
      labor: grand.labor ? total(records, fields.labor) / grand.labor * 100 : 0,
      downtime: grand.downtime ? total(records, fields.downtime) / grand.downtime * 100 : 0,
      cost: grand.cost ? total(records, fields.cost) / grand.cost * 100 : 0
    })).sort((a, b) => b.orders - a.orders);
    $("mix-table").innerHTML = groups.map((group) => `<tr><td>${esc(group.type)}</td><td>${fmtPct(group.orders)}</td><td>${fmtPct(group.labor)}</td><td>${fmtPct(group.downtime)}</td><td>${fmtPct(group.cost)}</td></tr>`).join("") || '<tr><td colspan="5">Sin registros disponibles</td></tr>';
    drawMix(groups);
  }

  function drawMix(groups) {
    const width = 680, left = 128, right = 26, rowHeight = 37, top = 12, height = Math.max(148, top + groups.length * rowHeight + 16), plotWidth = width - left - right;
    if (!groups.length) return emptyChart("mix-chart", "Sin registros en este filtro.");
    const series = [{ key: "orders", cls: "bar-primary" }, { key: "labor", cls: "bar-secondary" }, { key: "downtime", cls: "bar-third" }, { key: "cost", cls: "bar-fourth" }];
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Participación por tipo de mantenimiento">`;
    [0, 25, 50, 75, 100].forEach((tick) => { const x = left + plotWidth * tick / 100; svg += `<line class="grid-line" x1="${x}" y1="${top - 3}" x2="${x}" y2="${height - 15}"/><text class="axis-text" x="${x}" y="${height - 1}" text-anchor="middle">${tick}%</text>`; });
    groups.forEach((group, index) => {
      const y = top + index * rowHeight;
      svg += `<text class="axis-text" x="${left - 10}" y="${y + 11}" text-anchor="end">${esc(shorten(group.type, 18))}</text>`;
      series.forEach((item, seriesIndex) => { const barY = y + seriesIndex * 6; const value = Math.min(100, group[item.key]); svg += `<rect class="${item.cls}" x="${left}" y="${barY}" width="${Math.max(value ? 1 : 0, plotWidth * value / 100)}" height="4" rx="1"><title>${esc(group.type)} · ${item.key}: ${fmtPct(value)}</title></rect>`; });
    });
    svg += "</svg>"; $("mix-chart").innerHTML = svg;
  }

  function renderPareto(rows) {
    const metric = $("pareto-metric").value;
    const field = metric === "downtime" ? fields.downtime : metric === "cost" ? fields.cost : fields.failure;
    const metricNames = { frequency: ["Modo de falla por frecuencia", "órdenes únicas"], downtime: ["Modo de falla por downtime", "horas acumuladas"], cost: ["Modo de falla por costo directo", "CLP acumulados"] };
    $("pareto-title").textContent = metricNames[metric][0]; $("pareto-unit").textContent = metricNames[metric][1];
    const groups = [...groupBy(rows, fields.failure).entries()].filter(([name]) => name !== "Sin dato").map(([name, records]) => ({ name, value: metric === "frequency" ? unique(records, fields.ot) : total(records, field) })).sort((a, b) => b.value - a.value);
    const grandTotal = groups.reduce((sum, item) => sum + item.value, 0);
    drawPareto(groups.slice(0, 10), metric, grandTotal);
  }

  function drawPareto(groups, metric, grandTotal) {
    if (!groups.length) return emptyChart("pareto-chart", "No hay modos de falla para este análisis.");
    const width = 960, height = 320, left = 54, right = 58, top = 22, bottom = 76, plotWidth = width - left - right, plotHeight = height - top - bottom;
    const maxValue = Math.max(...groups.map((item) => item.value), 1), slotWidth = plotWidth / groups.length, barWidth = Math.min(48, slotWidth * .54), cumulative = []; let running = 0;
    groups.forEach((item) => { running += item.value; cumulative.push(grandTotal ? running / grandTotal : 0); });
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Gráfico Pareto de modos de falla">`;
    [0, .25, .5, .75, 1].forEach((tick) => { const y = top + plotHeight * (1 - tick); svg += `<line class="grid-line" x1="${left}" y1="${y}" x2="${left + plotWidth}" y2="${y}"/><text class="axis-text" x="${left - 8}" y="${y + 3}" text-anchor="end">${fmt(maxValue * tick)}</text><text class="axis-text" x="${left + plotWidth + 8}" y="${y + 3}">${fmtPct(tick * 100)}</text>`; });
    const points = [];
    groups.forEach((item, index) => {
      const center = left + slotWidth * (index + .5), barHeight = plotHeight * item.value / maxValue, barY = top + plotHeight - barHeight, lineY = top + plotHeight * (1 - cumulative[index]);
      svg += `<rect class="bar-primary" x="${center - barWidth / 2}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="1"><title>${esc(item.name)}: ${metric === "cost" ? currencyFormat.format(item.value) : fmt(item.value)}</title></rect><text class="value-text" x="${center}" y="${Math.max(top - 5, barY - 4)}" text-anchor="middle">${metric === "cost" ? shorten(currencyFormat.format(item.value), 8) : fmt(item.value)}</text><text class="axis-label" transform="rotate(-38 ${center} ${height - bottom + 13})" x="${center}" y="${height - bottom + 13}" text-anchor="end">${esc(shorten(item.name, 25))}</text>`;
      points.push(`${center},${lineY}`);
    });
    svg += `<polyline class="pareto-line" points="${points.join(" ")}"/>`;
    groups.forEach((item, index) => { const [x, y] = points[index].split(","); svg += `<circle class="pareto-point" cx="${x}" cy="${y}" r="3"><title>${esc(item.name)} · Acumulado ${fmtPct(cumulative[index] * 100)}</title></circle>`; });
    svg += "</svg>"; $("pareto-chart").innerHTML = svg;
  }

  function validCorrectiveRows(rows) {
    return rows.filter((row) => {
      if (normalizeMaintenance(row[fields.maintenance]) !== "Correctivo") return false;
      if (clean(row[fields.status]) && !/cerrad/i.test(clean(row[fields.status]))) return false;
      const start = dateValue(row[fields.start]), end = dateValue(row[fields.end]);
      return Boolean(start && end && end >= start && numeric(row[fields.repair]) > 0);
    });
  }

  function renderMttr(rows, globalMttr) {
    const groups = [...groupBy(validCorrectiveRows(rows), fields.equipmentType).entries()].map(([type, records]) => ({ type, value: mean(records.map((row) => numeric(row[fields.repair]))), count: unique(records, fields.ot) })).sort((a, b) => b.value - a.value).slice(0, 12);
    drawMttr(groups, globalMttr);
  }

  function drawMttr(groups, globalMttr) {
    if (!groups.length) return emptyChart("mttr-chart", "No hay reparaciones correctivas cerradas con fechas y tiempo válidos.");
    const width = 960, left = 185, right = 75, top = 14, rowHeight = 25, height = top + groups.length * rowHeight + 18, plotWidth = width - left - right, maxValue = Math.max(...groups.map((item) => item.value), globalMttr, 1) * 1.12;
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="MTTR por tipo de equipo">`;
    [0, .25, .5, .75, 1].forEach((tick) => { const x = left + plotWidth * tick; svg += `<line class="grid-line" x1="${x}" y1="${top - 3}" x2="${x}" y2="${height - 15}"/><text class="axis-text" x="${x}" y="${height - 1}" text-anchor="middle">${fmt(maxValue * tick)} h</text>`; });
    const averageX = left + plotWidth * globalMttr / maxValue;
    svg += `<line class="reference-line" x1="${averageX}" y1="${top - 3}" x2="${averageX}" y2="${height - 15}"/><text class="axis-text" x="${Math.min(averageX + 4, width - right)}" y="${top + 8}">Global ${fmt(globalMttr)} h</text>`;
    groups.forEach((item, index) => { const y = top + index * rowHeight, barWidth = plotWidth * item.value / maxValue; svg += `<text class="axis-label" x="${left - 10}" y="${y + 12}" text-anchor="end">${esc(shorten(item.type, 28))}</text><rect class="bar-secondary" x="${left}" y="${y + 2}" width="${barWidth}" height="13" rx="1"><title>${esc(item.type)} · ${fmt(item.value)} horas · ${fmt(item.count)} OT</title></rect><text class="value-text" x="${left + barWidth + 5}" y="${y + 12}">${fmt(item.value)} h</text>`; });
    svg += "</svg>"; $("mttr-chart").innerHTML = svg;
  }

  function renderJackknife(rows) {
    const records = validCorrectiveRows(rows), groups = [...groupBy(records, fields.equipment).entries()].filter(([name]) => name !== "Sin dato").map(([name, items]) => ({
      name, frequency: unique(items, fields.ot), mttr: mean(items.map((row) => numeric(row[fields.repair]))), downtime: total(items, fields.downtime),
      type: clean(items[0][fields.equipmentType]) || "Sin tipo", criticality: clean(items[0][fields.criticality]) || "—"
    })).filter((item) => item.frequency > 0 && item.mttr > 0);
    const frequencyMean = mean(groups.map((item) => item.frequency)), mttrMean = mean(groups.map((item) => item.mttr));
    groups.forEach((item) => {
      item.frequencyNorm = item.frequency / (frequencyMean || 1); item.mttrNorm = item.mttr / (mttrMean || 1);
      item.risk = item.frequencyNorm * item.mttrNorm;
      item.quadrant = item.frequencyNorm >= 1 ? (item.mttrNorm >= 1 ? "Grave" : "Crónico") : (item.mttrNorm >= 1 ? "Agudo" : "Bajo control");
    });
    groups.sort((a, b) => b.risk - a.risk);
    $("asset-table").innerHTML = groups.slice(0, 8).map((item) => `<tr><td title="${esc(item.name)}">${esc(shorten(item.name, 17))}</td><td>${fmt(item.frequency)}</td><td>${fmt(item.mttr)} h</td><td><span class="quadrant-cell ${classFor(item.quadrant)}">${esc(item.quadrant)}</span></td></tr>`).join("") || '<tr><td colspan="4">Sin activos evaluables</td></tr>';
    drawJackknife(groups.slice(0, 80));
  }

  function classFor(quadrant) { return ({ "Grave": "q-severe", "Crónico": "q-chronic", "Agudo": "q-acute", "Bajo control": "q-control" })[quadrant] || ""; }
  function drawJackknife(groups) {
    if (!groups.length) return emptyChart("jackknife-chart", "No hay equipos correctivos con reparación válida.");
    const width = 640, height = 280, left = 48, right = 18, top = 18, bottom = 36, plotW = width - left - right, plotH = height - top - bottom;
    const maxX = Math.max(2, ...groups.map((item) => item.frequencyNorm)) * 1.08, maxY = Math.max(2, ...groups.map((item) => item.mttrNorm)) * 1.08;
    const xPos = (value) => left + plotW * value / maxX, yPos = (value) => top + plotH - plotH * value / maxY;
    let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Diagrama Jack-Knife por equipo"><rect x="${left}" y="${top}" width="${Math.max(0, xPos(1) - left)}" height="${Math.max(0, yPos(1) - top)}" fill="#eef3f3"/><rect x="${xPos(1)}" y="${top}" width="${Math.max(0, left + plotW - xPos(1))}" height="${Math.max(0, yPos(1) - top)}" fill="#f8f0e9"/><rect x="${left}" y="${yPos(1)}" width="${Math.max(0, xPos(1) - left)}" height="${Math.max(0, top + plotH - yPos(1))}" fill="#edf4ee"/><rect x="${xPos(1)}" y="${yPos(1)}" width="${Math.max(0, left + plotW - xPos(1))}" height="${Math.max(0, top + plotH - yPos(1))}" fill="#f8eeee"/>`;
    for (let tick = 0; tick <= 4; tick += 1) { const value = maxX * tick / 4, x = xPos(value); svg += `<line class="grid-line" x1="${x}" y1="${top}" x2="${x}" y2="${top + plotH}"/><text class="axis-text" x="${x}" y="${height - 12}" text-anchor="middle">${fmt(value)}</text>`; }
    for (let tick = 0; tick <= 4; tick += 1) { const value = maxY * tick / 4, y = yPos(value); svg += `<line class="grid-line" x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}"/><text class="axis-text" x="${left - 8}" y="${y + 3}" text-anchor="end">${fmt(value)}</text>`; }
    svg += `<line class="reference-line" x1="${xPos(1)}" y1="${top}" x2="${xPos(1)}" y2="${top + plotH}"/><line class="reference-line" x1="${left}" y1="${yPos(1)}" x2="${left + plotW}" y2="${yPos(1)}"/><text class="axis-text" x="${left + plotW / 2}" y="${height - 1}" text-anchor="middle">Frecuencia normalizada</text><text class="axis-text" transform="translate(12 ${top + plotH / 2}) rotate(-90)" text-anchor="middle">MTTR normalizado</text>`;
    groups.forEach((item) => { const radius = Math.min(9, 3 + Math.sqrt(item.frequency)); svg += `<circle class="scatter-point" cx="${xPos(item.frequencyNorm)}" cy="${yPos(item.mttrNorm)}" r="${radius}" fill="${colors[classFor(item.quadrant)]}"><title>${esc(item.name)} · ${item.quadrant} · ${fmt(item.frequency)} fallas · MTTR ${fmt(item.mttr)} h · Riesgo ${fmt(item.risk)}</title></circle>`; });
    svg += "</svg>"; $("jackknife-chart").innerHTML = svg;
  }

  function renderQuality(rows) {
    const missingEquipment = rows.filter((row) => !clean(row[fields.equipment])).length;
    const badDates = rows.filter((row) => { const start = dateValue(row[fields.start]), end = dateValue(row[fields.end]); return start && end && end < start; }).length;
    const negativeDowntime = rows.filter((row) => numeric(row[fields.downtime]) < 0).length;
    const missingFailure = rows.filter((row) => normalizeMaintenance(row[fields.maintenance]) === "Correctivo" && !clean(row[fields.failure])).length;
    $("quality-summary").innerHTML = [
      ["OT EN ALCANCE", numberFormat.format(unique(rows, fields.ot)), "identificadores únicos"],
      ["OT SIN EQUIPO", numberFormat.format(missingEquipment), "se conservan en el análisis"],
      ["FECHAS INCONSISTENTES", numberFormat.format(badDates), "fin anterior al inicio"],
      ["CORRECTIVOS SIN FALLA", numberFormat.format(missingFailure), "limitados en Pareto"]
    ].map(([label, value, note]) => `<div class="quality-item"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join("");
    return negativeDowntime;
  }

  function render() {
    const rows = filterRows();
    const summary = renderKpis(rows);
    renderMix(rows); renderPareto(rows); renderMttr(rows, summary.mttr); renderJackknife(rows);
    const negativeDowntime = renderQuality(rows);
    $("footer-date").textContent = new Date().toLocaleDateString("es-CL");
    $("dataset-status").textContent = `${numberFormat.format(rows.length)} registros analizados · ${numberFormat.format(state.duplicates)} duplicados exactos eliminados · ${numberFormat.format(negativeDowntime)} downtimes negativos`;
    $("dataset-status").className = "dataset-status success";
  }

  function emptyChart(id, message) { $(id).innerHTML = `<div class="chart-empty">${esc(message)}</div>`; }
  function shorten(value, max) { const text = String(value); return text.length > max ? `${text.slice(0, max - 1)}…` : text; }

  async function loadFile(file) {
    if (!file || !/\.(csv|txt)$/i.test(file.name)) { setError("Formato no compatible. Selecciona un archivo CSV o TXT delimitado."); return; }
    try {
      setStatus(`Leyendo ${file.name}…`);
      const parsed = parseCSV(await file.text());
      if (!parsed.rows.length) throw new Error("No se encontraron registros válidos.");
      state.rows = parsed.rows; state.fileName = file.name; state.duplicates = parsed.duplicates;
      $("dataset-name").textContent = state.fileName; $("updated-at").textContent = `${numberFormat.format(state.rows.length)} registros · ${new Date().toLocaleString("es-CL")}`;
      populateFilters(); render();
    } catch (error) { setError(error.message || "No fue posible procesar el archivo."); }
  }
  function setStatus(message) { $("dataset-status").textContent = message; $("dataset-status").className = "dataset-status"; }
  function setError(message) { $("dataset-status").textContent = message; $("dataset-status").className = "dataset-status error"; }

  $("unit-filter").addEventListener("change", render);
  $("maintenance-filter").addEventListener("change", render);
  $("pareto-metric").addEventListener("change", render);
  $("reset-filters").addEventListener("click", () => { $("unit-filter").value = ""; $("maintenance-filter").value = ""; $("pareto-metric").value = "frequency"; render(); });
  $("upload-trigger").addEventListener("click", () => $("file-input").click());
  $("file-input").addEventListener("change", (event) => { loadFile(event.target.files[0]); event.target.value = ""; });
  $("export-pdf").addEventListener("click", () => window.print());
  document.addEventListener("dragover", (event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); });
  document.addEventListener("drop", (event) => { if (event.dataTransfer.files.length) { event.preventDefault(); loadFile(event.dataTransfer.files[0]); } });

  fetch("data/CMMS_grupo_D.csv")
    .then((response) => { if (!response.ok) throw new Error("El dataset de ejemplo no está disponible. Carga un archivo CSV para comenzar."); return response.text(); })
    .then((text) => {
      const parsed = parseCSV(text);
      state.rows = parsed.rows; state.fileName = "CMMS_grupo_D.csv"; state.duplicates = parsed.duplicates;
      $("dataset-name").textContent = state.fileName;
      $("updated-at").textContent = `${numberFormat.format(state.rows.length)} registros · ${new Date().toLocaleString("es-CL")}`;
      populateFilters(); render();
    })
    .catch((error) => { $("dataset-name").textContent = "Sin dataset"; setError(error.message); });
})();
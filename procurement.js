/* SOUZA SPORTS — compras, importações e vendas diretas */
const PROCUREMENT_STATUSES = [
  "Pedido realizado",
  "Aguardando confirmação do fornecedor",
  "Aguardando envio",
  "Enviado pelo fornecedor",
  "Em trânsito",
  "Em fiscalização / importação",
  "Aguardando liberação",
  "Liberado",
  "Em rota de entrega",
  "Recebido",
  "Cancelado"
];
let procurementDraftCosts = [];

function roundPurchaseCost(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1000000) / 1000000;
}
function parseProcurementMoney(value) {
  const raw = String(value ?? "").trim().replace(/[R$\s]/g, "");
  if (!raw) return NaN;
  const comma = raw.lastIndexOf(",");
  const dot = raw.lastIndexOf(".");
  let normalized = raw;
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? raw.replace(/\./g, "").replace(",", ".")
      : raw.replace(/,/g, "");
  } else if (comma >= 0) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}
function procurementTotalUnits(items) {
  return items.reduce((sum, item) => sum + Number(item.qty || 0), 0);
}
function procurementCostsTotal(costs) {
  return costs.reduce((sum, item) => sum + Number(item.amount || 0), 0);
}
function procurementItemsFromForm() {
  return [...document.querySelectorAll("#procurementItems .procurement-item")].map(row => ({
    productId: row.querySelector(".proc-existing")?.value || null,
    productName: row.querySelector('[data-field="name"]')?.value.trim() || "",
    team: row.querySelector('[data-field="team"]')?.value.trim() || "",
    brand: row.querySelector('[data-field="brand"]')?.value.trim() || "",
    kind: normalizeKind(row.querySelector('[data-field="kind"]')?.value || "Torcedor"),
    size: row.querySelector('[data-field="size"]')?.value || "",
    qty: Number(row.querySelector('[data-field="qty"]')?.value),
    unitCost: parseProcurementMoney(row.querySelector('[data-field="unitCost"]')?.value),
    unitSalePrice: parseProcurementMoney(row.querySelector('[data-field="unitSalePrice"]')?.value || "0")
  }));
}
function renderProcurementItemSizes(row, selected = "") {
  const kind = row.querySelector('[data-field="kind"]').value;
  const select = row.querySelector('[data-field="size"]');
  select.innerHTML = '<option value="">Selecione</option>' +
    sizesForKind(kind).map(size => '<option value="' + size + '" ' +
      (size === selected ? "selected" : "") + ">" + size + "</option>").join("");
}
function onProcurementKindChange(select) {
  renderProcurementItemSizes(select.closest(".procurement-item"));
  updateProcurementSummary();
}
function onProcurementProductChange(select) {
  const row = select.closest(".procurement-item");
  const product = db.products.find(item => item.id === select.value);
  if (product) {
    row.querySelector('[data-field="name"]').value = product.name || "";
    row.querySelector('[data-field="team"]').value = product.team || "";
    row.querySelector('[data-field="brand"]').value = product.brand || "";
    row.querySelector('[data-field="kind"]').value = normalizeKind(product.kind || "Torcedor");
    row.querySelector('[data-field="unitSalePrice"]').value = product.price || "";
    renderProcurementItemSizes(row, normalizeKind(product.kind) === "Infantil" ? "16" : "P");
  } else {
    row.querySelector('[data-field="name"]').value = "";
    row.querySelector('[data-field="team"]').value = "";
    row.querySelector('[data-field="brand"]').value = "";
    row.querySelector('[data-field="kind"]').value = "Torcedor";
    row.querySelector('[data-field="unitSalePrice"]').value = "";
    renderProcurementItemSizes(row);
  }
  updateProcurementSummary();
}
function addProcurementItem(item = {}) {
  const host = document.getElementById("procurementItems");
  if (!host) return;
  const row = document.createElement("div");
  row.className = "panel procurement-item";
  const productOptions = '<option value="">Novo produto / preencher abaixo</option>' +
    db.products.map(p => '<option value="' + esc(p.id) + '" ' +
      (p.id === item.productId ? "selected" : "") + ">" + esc(p.name) +
      (p.team ? " • " + esc(p.team) : "") + "</option>").join("");
  const kind = normalizeKind(item.kind || "Torcedor");
  const kindOptions = PRODUCT_KINDS.map(k =>
    '<option ' + (k === kind ? "selected" : "") + ">" + esc(k) + "</option>"
  ).join("");
  const sizeOptions = sizesForKind(kind).map(size =>
    '<option value="' + size + '" ' + (size === (item.size || "") ? "selected" : "") +
    ">" + size + "</option>"
  ).join("");
  row.innerHTML =
    '<div class="row"><b>Produto do pedido</b><button class="btn danger remove-row" type="button" onclick="removeProcurementItem(this)">Remover</button></div>' +
    '<label>Produto já cadastrado (opcional)</label><select class="proc-existing" onchange="onProcurementProductChange(this)">' + productOptions + "</select>" +
    '<div class="grid2"><div><label>Nome / modelo *</label><input data-field="name" value="' + esc(item.productName || "") + '" placeholder="Ex.: Camisa Brasil 2026"></div>' +
    '<div><label>Time / coleção</label><input data-field="team" value="' + esc(item.team || "") + '" placeholder="Ex.: Brasil"></div></div>' +
    '<div class="grid2"><div><label>Marca</label><input data-field="brand" value="' + esc(item.brand || "") + '" placeholder="Ex.: Adidas"></div>' +
    '<div><label>Tipo</label><select data-field="kind" onchange="onProcurementKindChange(this)">' + kindOptions + "</select></div></div>" +
    '<div class="grid2"><div><label>Tamanho *</label><select data-field="size"><option value="">Selecione</option>' + sizeOptions + "</select></div>" +
    '<div><label>Quantidade *</label><input data-field="qty" type="number" min="1" step="1" value="' + (item.qty ?? 1) + '"></div></div>' +
    '<div class="grid2"><div><label>Custo de compra por peça (R$) *</label><input data-field="unitCost" type="text" inputmode="decimal" value="' + (item.unitCost ?? "") + '" placeholder="0,00"></div>' +
    '<div class="proc-sale-price"><label>Preço de venda por peça (R$) *</label><input data-field="unitSalePrice" type="text" inputmode="decimal" value="' + (item.unitSalePrice ?? "") + '" placeholder="0,00"></div></div>' +
    '<div class="muted procurement-item-cost-preview">Informe custo e quantidade para calcular o custo final.</div>';
  host.appendChild(row);
  updateProcurementDestination();
  updateProcurementSummary();
}
function removeProcurementItem(button) {
  const rows = document.querySelectorAll("#procurementItems .procurement-item");
  if (rows.length <= 1) {
    alert("O pedido precisa ter pelo menos um produto.");
    return;
  }
  button.closest(".procurement-item").remove();
  updateProcurementSummary();
}
function updateProcurementDestination() {
  const direct = document.getElementById("procurementDestination").value === "direct";
  document.getElementById("procurementClientFields").classList.toggle("hidden", !direct);
  document.querySelectorAll("#procurementItems .proc-sale-price").forEach(el =>
    el.classList.toggle("hidden", !direct)
  );
  updateProcurementSummary();
}
function addProcurementCost() {
  const description = document.getElementById("procurementCostDescription").value.trim();
  const amount = parseProcurementMoney(document.getElementById("procurementCostAmount").value);
  if (!description || !Number.isFinite(amount) || amount <= 0) {
    alert("Informe a descrição e um valor de taxa maior que zero.");
    return;
  }
  procurementDraftCosts.push({
    id: crypto.randomUUID(),
    description,
    amount: roundPurchaseCost(amount),
    date: new Date().toISOString()
  });
  document.getElementById("procurementCostDescription").value = "";
  document.getElementById("procurementCostAmount").value = "";
  renderProcurementCosts();
  updateProcurementSummary();
}
function removeProcurementCost(id) {
  procurementDraftCosts = procurementDraftCosts.filter(item => item.id !== id);
  renderProcurementCosts();
  updateProcurementSummary();
}
function renderProcurementCosts() {
  const el = document.getElementById("procurementCostsList");
  if (!el) return;
  el.innerHTML = procurementDraftCosts.length
    ? procurementDraftCosts.map(item =>
      '<div class="procurement-cost-row"><span>' + esc(item.description) + "</span><b>" +
      money(item.amount) + '</b><button type="button" class="btn danger remove-row" onclick="removeProcurementCost(\'' +
      esc(item.id) + '\')">Excluir</button></div>'
    ).join("")
    : '<div class="muted" style="padding:8px 0">Nenhuma taxa adicional registrada.</div>';
}
function updateProcurementSummary() {
  const el = document.getElementById("procurementSummary");
  if (!el) return;
  const items = procurementItemsFromForm().filter(item =>
    Number.isFinite(item.qty) && item.qty > 0 &&
    Number.isFinite(item.unitCost) && item.unitCost >= 0
  );
  const units = procurementTotalUnits(items);
  const goodsTotal = items.reduce((sum, item) => sum + item.qty * item.unitCost, 0);
  const extras = procurementCostsTotal(procurementDraftCosts);
  const extraPerPiece = units ? extras / units : 0;
  document.querySelectorAll("#procurementItems .procurement-item").forEach(row => {
    const preview = row.querySelector(".procurement-item-cost-preview");
    if (!preview) return;
    const qty = Number(row.querySelector('[data-field="qty"]')?.value);
    const unitCost = parseProcurementMoney(row.querySelector('[data-field="unitCost"]')?.value);
    if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(unitCost) || unitCost < 0) {
      preview.textContent = "Informe quantidade e custo de compra válidos.";
      return;
    }
    const landed = roundPurchaseCost(unitCost + extraPerPiece);
    preview.textContent = "Custo final estimado: " + money(landed) +
      " por peça • Total desta linha: " + money(landed * qty);
  });
  el.innerHTML =
    "<div><b>Resumo do pedido</b></div>" +
    '<div class="row"><span>Quantidade total de peças</span><b>' + units + "</b></div>" +
    '<div class="row"><span>Custo inicial das mercadorias</span><b>' + money(goodsTotal) + "</b></div>" +
    '<div class="row"><span>Fretes e taxas adicionais</span><b>' + money(extras) + "</b></div>" +
    '<div class="row"><span>Taxa adicional por peça (divisão igualitária)</span><b>' + money(extraPerPiece) + "</b></div>" +
    '<div class="row" style="border-top:1px solid #cbd9e6;margin-top:6px;padding-top:7px"><b>Custo final estimado</b><b>' +
    money(goodsTotal + extras) + "</b></div>";
}
function resetProcurementForm() {
  ["procurementEditId", "procurementSupplier", "procurementReference", "procurementExpected",
   "procurementTracking", "procurementCustomer", "procurementCustomerContact", "procurementNote",
   "procurementCostDescription", "procurementCostAmount"].forEach(id =>
    document.getElementById(id).value = ""
  );
  document.getElementById("procurementDestination").value = "stock";
  document.getElementById("procurementDate").value = new Date().toISOString().slice(0, 10);
  document.getElementById("procurementStatus").value = "Pedido realizado";
  document.getElementById("procurementItems").innerHTML = "";
  procurementDraftCosts = [];
  renderProcurementCosts();
  addProcurementItem();
  updateProcurementDestination();
  document.querySelector('#procurement button[onclick="saveProcurement()"]').textContent = "Salvar pedido";
}
function editProcurement(id) {
  const order = db.procurements.find(item => item.id === id);
  if (!order) return;
  if (order.receivedAt) {
    alert("Este pedido já foi recebido e lançado. O registro fica bloqueado para evitar duplicar o estoque ou a venda.");
    return;
  }
  showTab("procurement");
  document.getElementById("procurementEditId").value = order.id;
  document.getElementById("procurementDestination").value = order.destination || "stock";
  document.getElementById("procurementSupplier").value = order.supplier || "";
  document.getElementById("procurementReference").value = order.reference || "";
  document.getElementById("procurementDate").value = order.orderDate || "";
  document.getElementById("procurementExpected").value = order.expectedDate || "";
  document.getElementById("procurementTracking").value = order.tracking || "";
  document.getElementById("procurementCustomer").value = order.customer || "";
  document.getElementById("procurementCustomerContact").value = order.customerContact || "";
  document.getElementById("procurementNote").value = order.note || "";
  document.getElementById("procurementStatus").value = order.status || "Pedido realizado";
  procurementDraftCosts = Array.isArray(order.costs) ? JSON.parse(JSON.stringify(order.costs)) : [];
  renderProcurementCosts();
  document.getElementById("procurementItems").innerHTML = "";
  (order.items || []).forEach(item => addProcurementItem(item));
  updateProcurementDestination();
  document.querySelector('#procurement button[onclick="saveProcurement()"]').textContent = "Atualizar pedido";
  window.scrollTo(0, 0);
}
function finalizeProcurement(order) {
  const items = order.items || [];
  const units = procurementTotalUnits(items);
  const extras = procurementCostsTotal(order.costs || []);
  if (!units) throw new Error("O pedido não possui peças válidas.");
  const extraPerPiece = extras / units;
  const now = new Date().toISOString();
  for (const item of items) {
    const landedUnitCost = roundPurchaseCost(Number(item.unitCost) + extraPerPiece);
    item.allocatedExtraPerUnit = roundPurchaseCost(extraPerPiece);
    item.landedUnitCost = landedUnitCost;
    if (order.destination === "direct") {
      db.moves.unshift({
        id: crypto.randomUUID(), type: "direct_sale", productId: item.productId || null,
        productName: item.productName, size: item.size, qty: item.qty, delta: 0,
        price: Number(item.unitSalePrice), discount: 0, cost: landedUnitCost,
        supplier: order.supplier, note: order.note || "", procurementId: order.id,
        detail: "Compra direta vinculada ao pedido " + (order.reference || order.id) +
          " • Sem entrada no estoque • Custo final " + money(landedUnitCost) + " por peça",
        date: now
      });
      continue;
    }
    let product = item.productId ? db.products.find(p => p.id === item.productId) : null;
    if (!product) {
      product = db.products.find(p =>
        p.name.toLowerCase() === item.productName.toLowerCase() &&
        (p.team || "").toLowerCase() === (item.team || "").toLowerCase() &&
        (p.brand || "").toLowerCase() === (item.brand || "").toLowerCase() &&
        normalizeKind(p.kind) === normalizeKind(item.kind)
      );
    }
    if (!product) {
      product = {
        id: crypto.randomUUID(), name: item.productName, team: item.team || "",
        brand: item.brand || "", kind: normalizeKind(item.kind),
        cost: landedUnitCost, price: Number(item.unitSalePrice) || 0,
        qty: {}, photo: "", created: now
      };
      db.products.unshift(product);
    }
    const oldQty = total(product);
    const oldCost = Number(product.cost) || 0;
    const newQty = Number(item.qty) || 0;
    product.qty = product.qty || {};
    product.qty[item.size] = (Number(product.qty[item.size]) || 0) + newQty;
    product.cost = oldQty + newQty > 0
      ? roundPurchaseCost(((oldQty * oldCost) + (newQty * landedUnitCost)) / (oldQty + newQty))
      : landedUnitCost;
    if (Number(item.unitSalePrice) > 0) product.price = Number(item.unitSalePrice);
    db.moves.unshift({
      id: crypto.randomUUID(), type: "entry", productId: product.id,
      productName: product.name, size: item.size, qty: newQty, delta: newQty,
      cost: landedUnitCost, supplier: order.supplier, note: order.reference || "",
      procurementId: order.id,
      detail: "Recebimento do pedido " + (order.reference || order.id) +
        " • Custo final por peça " + money(landedUnitCost),
      date: now
    });
  }
  order.receivedAt = now;
  order.stockPosted = true;
  order.extraCostPerPiece = roundPurchaseCost(extraPerPiece);
  order.finalCost = roundPurchaseCost(items.reduce((sum, item) =>
    sum + (Number(item.unitCost) || 0) * Number(item.qty || 0), 0) + extras);
  order.totalUnits = units;
}
function saveProcurement() {
  if (!["owner", "partner", "local"].includes(workspaceRole)) {
    alert("Somente o administrador ou o sócio pode registrar compras e importações.");
    return;
  }
  const id = document.getElementById("procurementEditId").value;
  const old = id ? db.procurements.find(item => item.id === id) : null;
  if (old?.receivedAt) {
    alert("Este pedido já foi recebido. Não é possível alterá-lo para evitar duplicidade.");
    return;
  }
  const destination = document.getElementById("procurementDestination").value;
  const supplier = document.getElementById("procurementSupplier").value.trim();
  const items = procurementItemsFromForm();
  const status = document.getElementById("procurementStatus").value;
  const customer = document.getElementById("procurementCustomer").value.trim();
  const validItems = items.length > 0 && items.every(item =>
    item.productName && item.size && Number.isInteger(item.qty) && item.qty > 0 &&
    Number.isFinite(item.unitCost) && item.unitCost >= 0
  );
  if (!supplier) { alert("Informe o nome do fornecedor."); return; }
  if (!validItems) { alert("Confira todos os produtos: nome, tamanho, quantidade e custo de compra por peça."); return; }
  if (destination === "direct" && !customer) { alert("Informe o nome do cliente da compra direta."); return; }
  if (destination === "direct" && items.some(item =>
    !Number.isFinite(item.unitSalePrice) || item.unitSalePrice <= 0
  )) {
    alert("Informe o preço de venda por peça em todos os itens da compra direta.");
    return;
  }
  if (status === "Recebido" && !old?.receivedAt && !confirm(
    "Confirmar recebimento? O aplicativo registrará as peças no estoque ou lançará a venda direta ao cliente. Esta ação não poderá ser repetida."
  )) return;

  const now = new Date().toISOString();
  const totalUnits = procurementTotalUnits(items);
  const extraPerPiece = totalUnits ? procurementCostsTotal(procurementDraftCosts) / totalUnits : 0;
  const itemsWithLandedCost = items.map(item => ({
    ...item,
    allocatedExtraPerUnit: roundPurchaseCost(extraPerPiece),
    landedUnitCost: roundPurchaseCost(item.unitCost + extraPerPiece)
  }));
  const history = old?.statusHistory ? JSON.parse(JSON.stringify(old.statusHistory)) : [];
  if (!history.length || old?.status !== status) history.push({ status, date: now });
  const order = {
    id: old?.id || crypto.randomUUID(),
    destination, supplier,
    reference: document.getElementById("procurementReference").value.trim(),
    orderDate: document.getElementById("procurementDate").value || now.slice(0, 10),
    expectedDate: document.getElementById("procurementExpected").value,
    tracking: document.getElementById("procurementTracking").value.trim(),
    customer: destination === "direct" ? customer : "",
    customerContact: destination === "direct"
      ? document.getElementById("procurementCustomerContact").value.trim() : "",
    customerPaymentTracking: destination === "direct" ? true : Boolean(old?.customerPaymentTracking),
    customerPayments: Array.isArray(old?.customerPayments) ? old.customerPayments : [],
    supplierPaymentTracking: old ? Boolean(old.supplierPaymentTracking) : true,
    supplierPayments: Array.isArray(old?.supplierPayments) ? old.supplierPayments : [],
    items: itemsWithLandedCost,
    costs: JSON.parse(JSON.stringify(procurementDraftCosts)),
    status,
    note: document.getElementById("procurementNote").value.trim(),
    statusHistory: history,
    createdAt: old?.createdAt || now,
    updatedAt: now
  };
  if (status === "Recebido" && !order.receivedAt) finalizeProcurement(order);
  if (old) Object.assign(old, order);
  else db.procurements.unshift(order);
  persist();
  resetProcurementForm();
  renderProcurements();
  alert(order.receivedAt
    ? "Pedido recebido e lançado com sucesso!"
    : "Pedido salvo. O estoque só será atualizado quando o status for Recebido.");
}
function renderProcurements() {
  const el = document.getElementById("procurementsList");
  if (!el) return;
  const filter = document.getElementById("procurementFilter")?.value || "";
  const query = (document.getElementById("procurementSearch")?.value || "").toLowerCase();
  const orders = (db.procurements || []).filter(order =>
    (!filter || order.status === filter) &&
    (order.supplier + " " + order.reference + " " + order.customer + " " + (order.tracking || "")).toLowerCase().includes(query)
  );
  el.innerHTML = orders.length ? orders.map(order => {
    const units = order.totalUnits || procurementTotalUnits(order.items || []);
    const goods = (order.items || []).reduce((sum, item) =>
      sum + (Number(item.unitCost) || 0) * Number(item.qty || 0), 0
    );
    const extras = procurementCostsTotal(order.costs || []);
    const extraPerPiece = units ? extras / units : 0;
    const totalCost = order.finalCost ?? (goods + extras);
    const destination = order.destination === "direct"
      ? "Venda direta para " + esc(order.customer)
      : "Entrada no estoque";
    const itemsText = (order.items || []).map(item => {
      const landed = Number.isFinite(Number(item.landedUnitCost))
        ? Number(item.landedUnitCost)
        : roundPurchaseCost((Number(item.unitCost) || 0) + extraPerPiece);
      return esc(item.productName) + " (" + esc(item.size) + "): " + item.qty +
        " un. • Custo final: " + money(landed) + "/peça";
    }).join(" • ");
    const timeline = (order.statusHistory || []).slice(-5).map(step =>
      esc(step.status) + " — " + new Date(step.date).toLocaleString("pt-BR")
    ).join("<br>");
    return '<article class="panel procurement-card">' +
      '<div class="row"><b>' + esc(order.supplier) + '</b><span class="tag">' + esc(order.status) + "</span></div>" +
      '<div class="muted">' + esc(order.reference || "Sem referência") + " • Compra em " + esc(order.orderDate || "") + "</div>" +
      '<div class="muted">' + destination + (order.expectedDate ? " • Previsão: " + esc(order.expectedDate) : "") + "</div>" +
      '<div style="margin-top:8px">' + itemsText + '</div><div class="row" style="margin-top:8px"><span>' +
      units + " peça(s)</span><b>" + money(totalCost) + "</b></div>" +
      '<div class="muted">Custos adicionais: ' + money(extras) + " • Rateio por peça: " +
      money(order.extraCostPerPiece ?? (units ? extras / units : 0)) + "</div>" +
      (order.tracking ? '<div class="muted">Rastreamento: ' + esc(order.tracking) + "</div>" : "") +
      (order.receivedAt ? '<div class="positive" style="margin-top:7px">Recebimento concluído em ' +
        new Date(order.receivedAt).toLocaleString("pt-BR") + "</div>" : "") +
      '<details style="margin-top:8px"><summary class="muted">Histórico de etapas</summary><div class="procurement-timeline">' +
      (timeline || "Sem histórico") + "</div></details>" +
      (!order.receivedAt ? '<button class="btn secondary" style="width:100%;margin-top:10px" onclick="editProcurement(\'' +
        esc(order.id) + "')\">Editar pedido e atualizar etapa</button>" : "") +
      "</article>";
  }).join("") : '<div class="panel empty">Nenhum pedido cadastrado.</div>';
}
function initializeProcurementForm() {
  const dateInput = document.getElementById("procurementDate");
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
  if (document.getElementById("procurementItems")?.children.length === 0) addProcurementItem();
  renderProcurementCosts();
  document.getElementById("procurementDestination")?.addEventListener("change", updateProcurementDestination);
  document.getElementById("procurementItems")?.addEventListener("input", updateProcurementSummary);
  updateProcurementDestination();
}
initializeProcurementForm();


/* SOUZA SPORTS — pagamentos, recebíveis, contas a pagar e alertas */
let financePaymentOrderId = null;
let financePaymentMode = "customer";
let financePaymentDraft = [];
const FINANCE_PAYMENT_METHODS = [
  "PIX", "PIX parcelado", "Dinheiro", "Cartão de débito",
  "Cartão de crédito", "Transferência bancária", "Boleto", "A combinar", "Outro"
];

function financeToday() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function financeDateAdd(dateValue, days) {
  const d = new Date(String(dateValue || financeToday()) + "T12:00:00");
  d.setDate(d.getDate() + Number(days || 0));
  return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
}
function financeDateDiff(dateValue) {
  const a = Date.parse(String(dateValue) + "T00:00:00");
  const b = Date.parse(financeToday() + "T00:00:00");
  return Math.round((a-b) / 86400000);
}
function financeSaleTotal(order) {
  return roundPurchaseCost((order.items || []).reduce((sum,item) =>
    sum + (Number(item.unitSalePrice) || 0) * (Number(item.qty) || 0), 0));
}
function financeSupplierTotal(order) {
  if (Number.isFinite(Number(order.finalCost))) return Number(order.finalCost);
  const goods = (order.items || []).reduce((sum,item) =>
    sum + (Number(item.unitCost) || 0) * (Number(item.qty) || 0), 0);
  return roundPurchaseCost(goods + procurementCostsTotal(order.costs || []));
}
function financePaidTotal(rows) {
  return (rows || []).filter(row => row.paidAt).reduce((sum,row) => sum + (Number(row.amount) || 0), 0);
}
function financeExpectedTotal() {
  const order = (db.procurements || []).find(x => x.id === financePaymentOrderId);
  if (!order) return 0;
  return financePaymentMode === "customer" ? financeSaleTotal(order) : financeSupplierTotal(order);
}
function financeMethodOptions(selected) {
  return FINANCE_PAYMENT_METHODS.map(method =>
    '<option value="' + esc(method) + '" ' + (method === selected ? "selected" : "") + '>' +
    esc(method) + '</option>'
  ).join("");
}
function openFinancePaymentManager(orderId, mode) {
  if (!["owner","partner","local"].includes(workspaceRole)) {
    alert("Somente o administrador ou o sócio pode acessar os controles financeiros.");
    return;
  }
  const order = (db.procurements || []).find(x => x.id === orderId);
  if (!order) return;
  financePaymentOrderId = orderId;
  financePaymentMode = mode === "supplier" ? "supplier" : "customer";
  const existing = financePaymentMode === "customer" ? order.customerPayments : order.supplierPayments;
  financePaymentDraft = Array.isArray(existing) ? JSON.parse(JSON.stringify(existing)) : [];
  const title = financePaymentMode === "customer" ? "Pagamentos do cliente" : "Pagamentos ao fornecedor";
  document.getElementById("financePaymentTitle").textContent = title;
  const expected = financeExpectedTotal();
  document.getElementById("financePaymentContext").textContent =
    (financePaymentMode === "customer"
      ? "Cliente: " + (order.customer || "Não informado") + " • Pedido: " + (order.reference || order.id)
      : "Fornecedor: " + (order.supplier || "Não informado") + " • Pedido: " + (order.reference || order.id)) +
    " • Valor total: " + money(expected);
  document.getElementById("financePaymentMethod").value = financePaymentMode === "supplier" ? "A combinar" : "PIX";
  document.getElementById("financePaymentCount").value = 1;
  document.getElementById("financePaymentFirstDue").value = financeToday();
  document.getElementById("financePaymentInterval").value = 30;
  renderFinancePaymentRows();
  document.getElementById("financePaymentModal").classList.remove("hidden");
}
function closeFinancePaymentManager() {
  document.getElementById("financePaymentModal").classList.add("hidden");
  financePaymentOrderId = null;
  financePaymentDraft = [];
}
function financePaymentMethodChanged() {
  const method = document.getElementById("financePaymentMethod").value;
  const count = document.getElementById("financePaymentCount");
  if (method === "PIX parcelado" && Number(count.value) < 2) count.value = 2;
  if (method !== "PIX parcelado" && Number(count.value) === 2) {
    // Mantém a quantidade escolhida; o método pode ter parcelas também.
  }
}
function generateFinanceInstallments() {
  const expected = financeExpectedTotal();
  if (!(expected > 0)) {
    alert("Não há valor válido para gerar parcelas neste pedido.");
    return;
  }
  const method = document.getElementById("financePaymentMethod").value;
  let count = Math.max(1, Math.min(24, Math.floor(Number(document.getElementById("financePaymentCount").value) || 1)));
  if (method === "PIX parcelado" && count < 2) count = 2;
  document.getElementById("financePaymentCount").value = count;
  const firstDue = document.getElementById("financePaymentFirstDue").value || financeToday();
  const interval = Math.max(1, Math.min(365, Math.floor(Number(document.getElementById("financePaymentInterval").value) || 30)));
  const alreadyPaid = financePaymentDraft.filter(row => row.paidAt);
  const paidTotal = financePaidTotal(alreadyPaid);
  const remainingCents = Math.round(Math.max(0, expected - paidTotal) * 100);
  if (remainingCents <= 0) {
    alert("Este pedido já está totalmente pago. Não há saldo para parcelar.");
    return;
  }
  const base = Math.floor(remainingCents / count);
  const remainder = remainingCents - base * count;
  const next = alreadyPaid.slice();
  for (let index=0; index<count; index++) {
    const cents = base + (index < remainder ? 1 : 0);
    next.push({
      id: crypto.randomUUID(),
      amount: cents / 100,
      method,
      dueDate: financeDateAdd(firstDue, index * interval),
      paidAt: "",
      note: method === "PIX parcelado" && count === 2 ? "PIX parcelado em 2x" : ""
    });
  }
  financePaymentDraft = next;
  renderFinancePaymentRows();
}
function addFinancePaymentRow() {
  financePaymentDraft.push({
    id: crypto.randomUUID(),
    amount: 0,
    method: document.getElementById("financePaymentMethod").value || "PIX",
    dueDate: financeToday(),
    paidAt: "",
    note: ""
  });
  renderFinancePaymentRows();
}
function removeFinancePaymentRow(id) {
  financePaymentDraft = financePaymentDraft.filter(row => row.id !== id);
  renderFinancePaymentRows();
}
function readFinancePaymentRows() {
  return [...document.querySelectorAll("#financePaymentRows .finance-payment-row")].map(row => ({
    id: row.dataset.id || crypto.randomUUID(),
    amount: parseProcurementMoney(row.querySelector('[data-finance-field="amount"]')?.value),
    method: row.querySelector('[data-finance-field="method"]')?.value || "",
    dueDate: row.querySelector('[data-finance-field="dueDate"]')?.value || "",
    paidAt: row.querySelector('[data-finance-field="paidAt"]')?.value || "",
    note: row.querySelector('[data-finance-field="note"]')?.value.trim() || ""
  }));
}
function renderFinancePaymentRows() {
  const host = document.getElementById("financePaymentRows");
  if (!host) return;
  host.innerHTML = financePaymentDraft.length ? financePaymentDraft.map((row,index) =>
    '<div class="panel finance-payment-row" data-id="' + esc(row.id) + '">' +
    '<div class="row"><b>Parcela / pagamento ' + (index+1) + '</b>' +
    '<button class="btn danger" type="button" onclick="removeFinancePaymentRow(\'' + esc(row.id) + '\')">Remover</button></div>' +
    '<div class="grid2"><div><label>Valor (R$)</label><input type="text" inputmode="decimal" data-finance-field="amount" value="' + esc(String(row.amount ?? "").replace(".",",")) + '"></div>' +
    '<div><label>Forma de pagamento</label><select data-finance-field="method">' + financeMethodOptions(row.method || "PIX") + '</select></div></div>' +
    '<div class="grid2"><div><label>Data de vencimento</label><input type="date" data-finance-field="dueDate" value="' + esc(row.dueDate || "") + '"></div>' +
    '<div><label>Data em que foi pago (vazio = pendente)</label><input type="date" data-finance-field="paidAt" value="' + esc(row.paidAt || "") + '"></div></div>' +
    '<label>Observação (opcional)</label><input data-finance-field="note" value="' + esc(row.note || "") + '" placeholder="Ex.: PIX parcelado em 2x">' +
    '</div>'
  ).join("") : '<div class="empty">Nenhuma parcela cadastrada. Gere as parcelas ou adicione uma manualmente.</div>';
  updateFinancePaymentSummary();
}
function updateFinancePaymentSummary() {
  const host = document.getElementById("financePaymentSummary");
  if (!host) return;
  const rows = readFinancePaymentRows();
  const expected = financeExpectedTotal();
  const scheduled = rows.reduce((sum,row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0);
  const paid = rows.filter(row => row.paidAt).reduce((sum,row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0);
  host.innerHTML = '<div class="row"><span>Valor total</span><b>' + money(expected) + '</b></div>' +
    '<div class="row"><span>Total programado</span><b>' + money(scheduled) + '</b></div>' +
    '<div class="row"><span>Já recebido / pago</span><b class="positive">' + money(paid) + '</b></div>' +
    '<div class="row"><span>Saldo pendente</span><b class="negative">' + money(Math.max(0,expected-paid)) + '</b></div>';
}
function saveFinancePayments() {
  const order = (db.procurements || []).find(x => x.id === financePaymentOrderId);
  if (!order) return;
  const rows = readFinancePaymentRows();
  const expected = financeExpectedTotal();
  if (!rows.length) {
    alert("Cadastre ao menos uma parcela ou pagamento.");
    return;
  }
  if (rows.some(row => !Number.isFinite(row.amount) || row.amount <= 0 || !row.method || !row.dueDate)) {
    alert("Confira o valor, a forma de pagamento e a data de vencimento de todas as parcelas.");
    return;
  }
  const total = rows.reduce((sum,row) => sum + row.amount, 0);
  if (Math.abs(total - expected) > 0.02) {
    alert("As parcelas precisam somar o valor total do pedido (" + money(expected) + "). Total informado: " + money(total) + ".");
    return;
  }
  if (financePaymentMode === "customer") {
    order.customerPayments = rows;
    order.customerPaymentTracking = true;
  } else {
    order.supplierPayments = rows;
    order.supplierPaymentTracking = true;
  }
  order.updatedAt = new Date().toISOString();
  persist();
  closeFinancePaymentManager();
  renderProcurements();
  renderFinancialDashboard();
  alert("Controle financeiro atualizado com sucesso!");
}
function financeFormatDue(dateValue) {
  if (!dateValue) return "Sem vencimento";
  return new Date(dateValue + "T12:00:00").toLocaleDateString("pt-BR");
}
function financeWhatsAppUrl(contact) {
  let digits = String(contact || "").replace(/\D/g,"");
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits ? "https://wa.me/" + digits : "";
}
function renderFinancialDashboard() {
  const panel = document.getElementById("financeDashboard");
  if (!panel) return;
  if (workspaceRole === "collaborator") {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const sales = (db.moves || []).filter(move => move.type === "sale" || move.type === "direct_sale");
  const soldValue = sales.reduce((sum,move) => sum + (Number(move.price)||0)*(Number(move.qty)||0) - (Number(move.discount)||0), 0);
  const directOrders = (db.procurements || []).filter(order => order.destination === "direct" && order.status !== "Cancelado");
  const quickSales = (db.moves || []).filter(move => move.type === "sale");
  const quickSalesPaid = quickSales.reduce((sum,move) => sum + financePaidTotal(move.payments || []), 0);
  const quickSalesReceivable = quickSales.reduce((sum,move) => {
    if (!Array.isArray(move.payments)) return sum;
    const saleTotal = Math.max(0,(Number(move.price)||0)*(Number(move.qty)||0)-(Number(move.discount)||0));
    return sum + Math.max(0,saleTotal-financePaidTotal(move.payments));
  }, 0);
  const clientReceived = directOrders.reduce((sum,order) => sum + financePaidTotal(order.customerPayments || []), 0) +
    quickSalesPaid + (db.orders || []).reduce((sum,order) => sum + (Number(order.paid)||0), 0);
  const clientReceivable = directOrders.reduce((sum,order) => {
    if (!order.customerPaymentTracking && !Array.isArray(order.customerPayments)) return sum;
    return sum + Math.max(0, financeSaleTotal(order) - financePaidTotal(order.customerPayments || []));
  }, 0) + quickSalesReceivable + (db.orders || []).filter(order => order.status !== "Cancelado")
    .reduce((sum,order) => sum + Math.max(0,(Number(order.total)||0)-(Number(order.paid)||0)),0);
  const supplierOrders = (db.procurements || []).filter(order => order.status !== "Cancelado");
  const invested = supplierOrders.reduce((sum,order) => sum + financeSupplierTotal(order),0);
  const supplierPaid = supplierOrders.reduce((sum,order) => sum + financePaidTotal(order.supplierPayments || []),0);
  const supplierDue = supplierOrders.reduce((sum,order) => {
    if (!order.supplierPaymentTracking && !Array.isArray(order.supplierPayments)) return sum;
    return sum + Math.max(0, financeSupplierTotal(order) - financePaidTotal(order.supplierPayments || []));
  }, 0);
  document.getElementById("finSales").textContent = money(soldValue);
  document.getElementById("finReceived").textContent = money(clientReceived);
  document.getElementById("finReceivable").textContent = money(clientReceivable);
  document.getElementById("finInvested").textContent = money(invested);
  document.getElementById("finSupplierPaid").textContent = money(supplierPaid);
  document.getElementById("finSupplierDue").textContent = money(supplierDue);
  renderFinancialAlerts();
}
function renderFinancialAlerts() {
  const host = document.getElementById("financeAlerts");
  if (!host) return;
  const today = financeToday();
  const limit = financeDateAdd(today,7);
  const alerts = [];
  (db.procurements || []).forEach(order => {
    if (order.status === "Cancelado") return;
    const customerRows = order.destination === "direct" ? (order.customerPayments || []) : [];
    customerRows.forEach(payment => {
      if (!payment.paidAt && payment.dueDate && payment.dueDate <= limit) {
        const days = financeDateDiff(payment.dueDate);
        alerts.push({
          type:"customer", orderId:order.id, overdue:days<0,
          dueDate:payment.dueDate, amount:Number(payment.amount)||0,
          name:order.customer||"Cliente não informado", supplier:order.supplier||"",
          note:days<0?"Atrasada há "+Math.abs(days)+" dia(s)":days===0?"Vence hoje":"Vence em "+days+" dia(s)",
          contact:order.customerContact||"", index:alerts.length
        });
      }
    });
    (order.supplierPayments || []).forEach(payment => {
      if (!payment.paidAt && payment.dueDate && payment.dueDate <= limit) {
        const days = financeDateDiff(payment.dueDate);
        alerts.push({
          type:"supplier", orderId:order.id, overdue:days<0,
          dueDate:payment.dueDate, amount:Number(payment.amount)||0,
          name:order.supplier||"Fornecedor não informado", supplier:"",
          note:days<0?"Atrasado há "+Math.abs(days)+" dia(s)":days===0?"Vence hoje":"Vence em "+days+" dia(s)",
          contact:"", index:alerts.length
        });
      }
    });
  });
  (db.moves || []).filter(move => move.type === "sale").forEach(move => {
    (move.payments || []).forEach(payment => {
      if (!payment.paidAt && payment.dueDate && payment.dueDate <= limit) {
        const days = financeDateDiff(payment.dueDate);
        alerts.push({
          type:"sale", orderId:move.id, paymentId:payment.id, overdue:days<0,
          dueDate:payment.dueDate, amount:Number(payment.amount)||0,
          name:move.customer || move.productName || "Venda",
          note:days<0?"Atrasada há "+Math.abs(days)+" dia(s)":days===0?"Vence hoje":"Vence em "+days+" dia(s)",
          contact:move.customerContact||"", index:alerts.length
        });
      }
    });
  });
  alerts.sort((a,b) => a.dueDate.localeCompare(b.dueDate));
  const customerAlerts = alerts.filter(a => a.type === "customer");
  const supplierAlerts = alerts.filter(a => a.type === "supplier");
  function renderGroup(title,items,type) {
    if (!items.length) return '<div class="finance-alert-group"><b>' + title + '</b><div class="muted">Nenhum vencimento nos próximos 7 dias.</div></div>';
    return '<div class="finance-alert-group"><b>' + title + '</b>' + items.map(item => {
      const order = (db.procurements || []).find(x => x.id === item.orderId);
      const wa = item.type === "customer" || item.type === "sale" ? financeWhatsAppUrl(item.contact) : "";
      const paymentAction = item.type === "sale"
        ? '<button class="btn secondary" type="button" onclick="markFinancePaymentPaid(\'sale\',\'' + esc(item.orderId) + '\',\'' + esc(item.paymentId) + '\')">Marcar como pago</button>'
        : '<button class="btn secondary" type="button" onclick="openFinancePaymentManager(\'' + esc(item.orderId) + '\',\'' + item.type + '\')">Ver pagamento</button>';
      return '<div class="finance-alert-item ' + (item.overdue?'overdue':'') + '">' +
        '<div class="row"><b>' + esc(item.name) + '</b><b>' + money(item.amount) + '</b></div>' +
        '<div class="muted">' + esc(item.note) + ' • Vencimento: ' + financeFormatDue(item.dueDate) +
        (item.type === "customer" && order ? ' • Pedido: ' + esc(order.reference || "") : item.type === "supplier" ? ' • Fornecedor' : ' • Venda') + '</div>' +
        '<div class="actions">' + paymentAction +
        (wa ? '<a href="' + wa + '" target="_blank" rel="noopener">Contato WhatsApp</a>' : '') +
        '</div></div>';
    }).join("") + '</div>';
  }
  host.innerHTML = renderGroup("Cobranças de clientes",customerAlerts,"customer") +
    renderGroup("Contas a pagar aos fornecedores",supplierAlerts,"supplier");
}
function markFinancePaymentPaid(type,recordId,paymentId) {
  let rows = null;
  if (type === "sale") {
    const move = (db.moves || []).find(item => item.id === recordId);
    rows = move?.payments;
  } else {
    const order = (db.procurements || []).find(item => item.id === recordId);
    rows = type === "supplier" ? order?.supplierPayments : order?.customerPayments;
  }
  const payment = (rows || []).find(item => item.id === paymentId);
  if (!payment || payment.paidAt) return;
  if (!confirm("Confirmar que o pagamento de " + money(payment.amount) + " foi recebido / pago hoje?")) return;
  payment.paidAt = financeToday();
  persist();
  renderFinancialDashboard();
}
function renderProcurements() {
  const el = document.getElementById("procurementsList");
  if (!el) return;
  const filter = document.getElementById("procurementFilter")?.value || "";
  const query = (document.getElementById("procurementSearch")?.value || "").toLowerCase();
  const orders = (db.procurements || []).filter(order =>
    (!filter || order.status === filter) &&
    (order.supplier + " " + order.reference + " " + order.customer + " " + (order.tracking || "")).toLowerCase().includes(query)
  );
  el.innerHTML = orders.length ? orders.map(order => {
    const units = order.totalUnits || procurementTotalUnits(order.items || []);
    const goods = (order.items || []).reduce((sum,item) => sum + (Number(item.unitCost)||0) * Number(item.qty||0),0);
    const extras = procurementCostsTotal(order.costs || []);
    const extraPerPiece = units ? extras / units : 0;
    const totalCost = order.finalCost ?? (goods + extras);
    const destination = order.destination === "direct" ? "Venda direta para " + esc(order.customer) : "Entrada no estoque";
    const itemsText = (order.items || []).map(item => {
      const landed = Number.isFinite(Number(item.landedUnitCost)) ? Number(item.landedUnitCost) :
        roundPurchaseCost((Number(item.unitCost)||0) + extraPerPiece);
      return esc(item.productName) + " (" + esc(item.size) + "): " + item.qty + " un. • Custo final: " + money(landed) + "/peça";
    }).join(" • ");
    const customerPaid = financePaidTotal(order.customerPayments || []);
    const customerTotal = financeSaleTotal(order);
    const supplierPaidAmount = financePaidTotal(order.supplierPayments || []);
    const supplierBalance = Math.max(0,financeSupplierTotal(order)-supplierPaidAmount);
    const customerBalance = Math.max(0,customerTotal-customerPaid);
    const timeline = (order.statusHistory || []).slice(-5).map(step =>
      esc(step.status) + " — " + new Date(step.date).toLocaleString("pt-BR")
    ).join("<br>");
    const paymentInfo = order.destination === "direct"
      ? (order.customerPaymentTracking || Array.isArray(order.customerPayments)
        ? '<div class="muted" style="margin-top:6px">Cliente: recebido ' + money(customerPaid) + ' • falta receber ' + money(customerBalance) + '</div>'
        : '<div class="muted" style="margin-top:6px">Pagamento do cliente ainda não configurado.</div>')
      : "";
    const supplierInfo = order.supplierPaymentTracking || Array.isArray(order.supplierPayments)
      ? '<div class="muted">Fornecedor: pago ' + money(supplierPaidAmount) + ' • falta pagar ' + money(supplierBalance) + '</div>'
      : '<div class="muted">Pagamento ao fornecedor ainda não configurado.</div>';
    return '<article class="panel procurement-card">' +
      '<div class="row"><b>' + esc(order.supplier) + '</b><span class="tag">' + esc(order.status) + '</span></div>' +
      '<div class="muted">' + esc(order.reference || "Sem referência") + " • Compra em " + esc(order.orderDate || "") + '</div>' +
      '<div class="muted">' + destination + (order.expectedDate ? " • Previsão: " + esc(order.expectedDate) : "") + '</div>' +
      '<div style="margin-top:8px">' + itemsText + '</div><div class="row" style="margin-top:8px"><span>' +
      units + ' peça(s)</span><b>' + money(order.destination === "direct" ? customerTotal : totalCost) + '</b></div>' +
      '<div class="muted">Custos adicionais: ' + money(extras) + ' • Rateio por peça: ' +
      money(order.extraCostPerPiece ?? (units ? extras/units : 0)) + '</div>' +
      paymentInfo + supplierInfo +
      (order.tracking ? '<div class="muted">Rastreamento: ' + esc(order.tracking) + '</div>' : '') +
      (order.receivedAt ? '<div class="positive" style="margin-top:7px">Recebimento concluído em ' + new Date(order.receivedAt).toLocaleString("pt-BR") + '</div>' : '') +
      '<details style="margin-top:8px"><summary class="muted">Histórico de etapas</summary><div class="procurement-timeline">' +
      (timeline || "Sem histórico") + '</div></details>' +
      '<div class="actions">' +
      (order.destination === "direct" ? '<button class="btn secondary" type="button" onclick="openFinancePaymentManager(\'' + esc(order.id) + '\',\'customer\')">Pagamentos do cliente</button>' : '') +
      '<button class="btn secondary" type="button" onclick="openFinancePaymentManager(\'' + esc(order.id) + '\',\'supplier\')">Pagamento ao fornecedor</button>' +
      (!order.receivedAt ? '<button class="btn secondary" type="button" onclick="editProcurement(\'' + esc(order.id) + '\')">Editar pedido e etapa</button>' : '') +
      '</div></article>';
  }).join("") : '<div class="panel empty">Nenhum pedido cadastrado.</div>';
}

function financeInitialize() {
  const saleDate = document.getElementById("salePaymentFirstDue");
  if (saleDate && !saleDate.value) saleDate.value = financeToday();
  const rows = document.getElementById("financePaymentRows");
  if (rows) {
    rows.addEventListener("input",updateFinancePaymentSummary);
    rows.addEventListener("change",updateFinancePaymentSummary);
  }
  renderProcurements();
  renderFinancialDashboard();
  if (!window.financeDashboardTimer) {
    window.financeDashboardTimer = setInterval(renderFinancialDashboard,60000);
  }
}
financeInitialize();

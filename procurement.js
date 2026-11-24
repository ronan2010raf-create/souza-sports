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
    unitCost: Number(row.querySelector('[data-field="unitCost"]')?.value),
    unitSalePrice: Number(row.querySelector('[data-field="unitSalePrice"]')?.value || 0)
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
    renderProcurementItemSizes(row, product.kind === "Infantil" ? "16" : "P");
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
    '<div class="grid2"><div><label>Custo de compra por peça (R$) *</label><input data-field="unitCost" type="number" min="0" step=".01" value="' + (item.unitCost ?? "") + '" placeholder="0,00"></div>' +
    '<div class="proc-sale-price"><label>Preço de venda por peça (R$) *</label><input data-field="unitSalePrice" type="number" min="0" step=".01" value="' + (item.unitSalePrice ?? "") + '" placeholder="0,00"></div></div>';
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
  const amount = Number(document.getElementById("procurementCostAmount").value);
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
    if (order.destination === "direct") {
      db.moves.unshift({
        id: crypto.randomUUID(), type: "direct_sale", productId: item.productId || null,
        productName: item.productName, size: item.size, qty: item.qty, delta: 0,
        price: Number(item.unitSalePrice), discount: 0, cost: landedUnitCost,
        customer: order.customer, customerContact: order.customerContact || "",
        supplier: order.supplier, note: order.note || "", procurementId: order.id,
        detail: "Compra direta para " + order.customer + " • Fornecedor: " + order.supplier +
          " • Custo final " + money(landedUnitCost) + " por peça",
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
    items,
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
    const totalCost = order.finalCost ?? (goods + extras);
    const destination = order.destination === "direct"
      ? "Venda direta para " + esc(order.customer)
      : "Entrada no estoque";
    const itemsText = (order.items || []).map(item =>
      esc(item.productName) + " (" + esc(item.size) + "): " + item.qty + " un."
    ).join(" • ");
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

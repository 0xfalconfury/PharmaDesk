const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
let medicines=[],suppliers=[],saleLines=[],purchaseLines=[],dashChart,analyticsChart;
let buyerLookupTimer=null,buyerLookupSeq=0;
const money=n=>'৳'+Number(n||0).toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,opts={}){const r=await fetch('/api'+url,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||'Request failed');return d}
function notice(msg,bad=false){$('#notice').textContent=msg;$('#notice').classList.remove('hidden','bad');if(bad)$('#notice').classList.add('bad');window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>$('#notice').classList.add('hidden'),5000)}
function table(rows,cols){if(!rows.length)return '<p class="muted">No records found.</p>';return `<div class="table-wrap"><table><thead><tr>${cols.map(c=>`<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${c[1](r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`}
function showPage(name){$$('.page').forEach(p=>p.classList.add('hidden'));$('#page-'+name).classList.remove('hidden');$$('#nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));$('#pageTitle').textContent=name==='stock'?'Stock history':name[0].toUpperCase()+name.slice(1);$('#sidebar')?.classList.remove('open');loadPage(name).catch(e=>notice(e.message,true))}
async function loadPage(name){if(name==='dashboard')return dashboard();if(name==='medicines')return loadMedicines();if(name==='purchases')return loadPurchaseOptions();if(name==='suppliers')return loadSuppliers();if(name==='expiry')return loadExpiry();if(name==='stock')return loadMovements();if(name==='sales')return loadSaleOptions();if(name==='history')return history();if(name==='analytics')return analytics();if(name==='expenses')return expenses();if(name==='security')return auditLogs()}
async function dashboard(){const d=await api('/dashboard');$('#todayRevenue').textContent=money(d.sales.revenue);$('#salesCount').textContent=d.sales.sales_count+' sales';$('#stockUnits').textContent=d.stock.units;$('#medicineCount').textContent=d.stock.medicines+' medicines';$('#expiryCount').textContent=Number(d.expiry.expired)+Number(d.expiry.critical);$('#todayProfit').textContent=money(d.profit.gross_profit);$('#todayExpenses').textContent='Expenses '+money(d.expenses.amount);const labels=d.weekly.map(x=>new Date(x.day).toLocaleDateString());if(dashChart)dashChart.destroy();dashChart=new Chart($('#dashChart'),{type:'line',data:{labels,datasets:[{label:'Revenue',data:d.weekly.map(x=>x.revenue),borderColor:'#52dfbd',backgroundColor:'#52dfbd22',fill:true,tension:.35}]},options:{plugins:{legend:{labels:{color:'#cbd8e8'}}},scales:{x:{ticks:{color:'#91a2b8'}},y:{ticks:{color:'#91a2b8'}}}}})}
async function loadMedicines(){medicines=await api('/medicines');renderMedicines()}
function renderMedicines(){const q=($('#medicineSearch').value||'').toLowerCase();const rows=medicines.filter(m=>m.name.toLowerCase().includes(q));$('#medicineTable').innerHTML=table(rows,[['Medicine',m=>`<b>${esc(m.name)}</b><br><small>${esc(m.strength||'')}</small>`],['Category',m=>esc(m.category||'—')],['Stock',m=>m.stock],['Price',m=>money(m.selling_price)],['Status',m=>`<span class="pill ${m.stock<=m.reorder_level?'warn':''}">${m.stock<=m.reorder_level?'Low stock':'Available'}</span>`],['Action',m=>`<button class="ghost" onclick="editMedicine(${m.id})">Edit</button> <button class="ghost" onclick="archiveMedicine(${m.id})">Archive</button>`]])}
window.editMedicine=id=>{const m=medicines.find(x=>x.id===id);const f=$('#medicineForm');f.id.value=m.id;['name','generic_name','strength','category','reorder_level'].forEach(k=>f[k].value=m[k]??'');$('#medicineFormWrap').classList.remove('hidden')};
window.archiveMedicine=async id=>{if(confirm('Archive this medicine?')){await api('/medicines/'+id,{method:'DELETE'});await loadMedicines();notice('Medicine archived.')}};
$('#addMedicineBtn').onclick=()=>{$('#medicineForm').reset();$('#medicineForm').id.value='';$('#medicineFormWrap').classList.remove('hidden')};$('#cancelMedicine').onclick=()=>$('#medicineFormWrap').classList.add('hidden');$('#medicineSearch').oninput=renderMedicines;
$('#medicineForm').onsubmit=async e=>{e.preventDefault();const f=e.target,d=Object.fromEntries(new FormData(f));const id=d.id;delete d.id;await api('/medicines'+(id?'/'+id:''),{method:id?'PUT':'POST',body:JSON.stringify(d)});f.reset();$('#medicineFormWrap').classList.add('hidden');await loadMedicines();notice('Medicine saved.')};
async function loadSuppliers(){suppliers=await api('/suppliers');$('#supplierTable').innerHTML=table(suppliers,[['Supplier',s=>esc(s.name)],['Phone',s=>esc(s.phone||'—')],['Email',s=>esc(s.email||'—')],['Address',s=>esc(s.address||'—')]])}
$('#supplierForm').onsubmit=async e=>{e.preventDefault();await api('/suppliers',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();await loadSuppliers();notice('Supplier saved.')};
async function loadPurchaseOptions(){await Promise.all([loadMedicines(),loadSuppliers()]);$('#purchaseSupplier').innerHTML='<option value="">Select supplier</option>'+suppliers.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');$('#purchaseMedicine').innerHTML='<option value="">Select medicine</option>'+medicines.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('')}
$('#addPurchaseLine').onclick=()=>{const medicine_id=$('#purchaseMedicine').value,medicine=medicines.find(m=>m.id==medicine_id),batch_no=$('#batchNo').value,expiry_date=$('#batchExpiry').value,purchase_price=Number($('#purchaseCost').value),selling_price=Number($('#purchasePrice').value),quantity=Number($('#purchaseQty').value);if(!medicine||!batch_no||!expiry_date||!Number.isInteger(quantity)||quantity<1||purchase_price<0||selling_price<0)return notice('Complete all purchase line fields.',true);purchaseLines.push({medicine_id:Number(medicine_id),name:medicine.name,batch_no,expiry_date,purchase_price,selling_price,quantity});$('#purchaseLines').innerHTML=purchaseLines.map((x,i)=>`<div class="line-row">${esc(x.name)} · ${x.quantity} units · batch ${esc(x.batch_no)} <button type="button" class="ghost" onclick="removePurchase(${i})">Remove</button></div>`).join('')};
window.removePurchase=i=>{purchaseLines.splice(i,1);$('#purchaseLines').innerHTML=purchaseLines.map((x,j)=>`<div class="line-row">${esc(x.name)} · ${x.quantity} units <button type="button" class="ghost" onclick="removePurchase(${j})">Remove</button></div>`).join('')};
$('#purchaseForm').onsubmit=async e=>{e.preventDefault();if(!purchaseLines.length)return notice('Add at least one purchase line.',true);const f=Object.fromEntries(new FormData(e.target));await api('/purchases',{method:'POST',body:JSON.stringify({...f,items:purchaseLines})});purchaseLines=[];$('#purchaseLines').innerHTML='';e.target.reset();notice('Purchase saved and stock increased.');};
async function loadExpiry(){const d=await api('/expiry');$('#expiryTable').innerHTML=table(d,[['Medicine',x=>esc(x.medicine_name)],['Batch',x=>esc(x.batch_no)],['Expiry',x=>new Date(x.expiry_date).toLocaleDateString()],['Remaining',x=>x.quantity_remaining],['Supplier',x=>esc(x.supplier_name||'—')],['Status',x=>`<span class="pill ${x.status==='EXPIRED'?'bad':x.status==='SAFE'?'':'warn'}">${x.status}</span>`]])}
async function loadMovements(){const [d,m]=await Promise.all([api('/movements'),api('/medicines')]);const ex=await api('/expiry');$('#adjustBatch').innerHTML='<option value="">Select batch</option>'+ex.map(b=>`<option value="${b.id}">${esc(b.medicine_name)} · ${esc(b.batch_no)} · ${b.quantity_remaining} left</option>`).join('');$('#movementTable').innerHTML=table(d,[['Date',x=>new Date(x.created_at).toLocaleString()],['Medicine',x=>esc(x.medicine_name)],['Batch',x=>esc(x.batch_no||'—')],['Type',x=>esc(x.movement_type)],['Change',x=>x.quantity_change],['After',x=>x.quantity_after??'—'],['Reason',x=>esc(x.reason||'—')]])}
$('#adjustForm').onsubmit=async e=>{e.preventDefault();await api('/stock-adjustments',{method:'POST',body:JSON.stringify({batch_id:$('#adjustBatch').value,quantity_change:$('#adjustQty').value,reason:$('#adjustReason').value})});e.target.reset();await loadMovements();notice('Stock adjustment recorded.')};

/* ================= SALES ================= */

async function loadSaleOptions(){
  medicines=await api('/medicines');
  $('#saleMedicine').innerHTML='<option value="">Choose medicine</option>'+
    medicines.filter(m=>m.stock>0).map(m=>
      `<option value="${m.id}">${esc(m.name)} · ${m.stock} available · ${money(m.selling_price)}</option>`
    ).join('');
  renderSaleLines();
}

$('#saleMedicineSearch').oninput=()=>{
  const q=$('#saleMedicineSearch').value.toLowerCase();
  $('#saleMedicine').innerHTML='<option value="">Choose medicine</option>'+
    medicines.filter(m=>m.stock>0&&(m.name.toLowerCase().includes(q)||(m.generic_name||'').toLowerCase().includes(q))).map(m=>
      `<option value="${m.id}">${esc(m.name)} · ${m.stock} available · ${money(m.selling_price)}</option>`
    ).join('');
};

$('#buyerPhone').oninput=()=>{
  const q=$('#buyerPhone').value.trim();
  if(q.length<3)return;
  const seq=++buyerLookupSeq;
  clearTimeout(buyerLookupTimer);
  buyerLookupTimer=setTimeout(async()=>{
    try{
      const d=await api('/customers/suggest?q='+encodeURIComponent(q));
      if(seq!==buyerLookupSeq)return; // stale response
      if(d[0]){$('#buyerName').value=d[0].name;$('#buyerAddress').value=d[0].address}
    }catch{}
  },250);
};

$('#addSaleLine').onclick = async () => {
  const idRaw = $('#saleMedicine').value;
  const id = Number(idRaw);
  const qty = Number($('#saleQty').value);
  if (!idRaw || !Number.isInteger(id) || !Number.isInteger(qty) || qty < 1)
    return notice('Choose a medicine and valid quantity.', true);

  try {
    const freshList = await api('/medicines');
    // BIGINT comes back as a STRING from pg — compare as strings
    const fresh = freshList.find(x => String(x.id) === String(id));
    if (!fresh) return notice('Medicine not found (it may have been archived).', true);

    const inCart = saleLines.find(x => String(x.medicine_id) === String(id))?.quantity || 0;
    if (inCart + qty > fresh.stock)
      return notice(`Only ${fresh.stock} units of ${fresh.name} available (${inCart} already in cart).`, true);

    const old = saleLines.find(x => String(x.medicine_id) === String(id));
    if (old) old.quantity += qty;
    else saleLines.push({ medicine_id: fresh.id, name: fresh.name, quantity: qty, price: Number(fresh.selling_price) });
    medicines = freshList;
    renderSaleLines();
  } catch (e) { notice(e.message, true); }
};

function renderSaleLines(){
  const subtotal=saleLines.reduce((s,x)=>s+x.quantity*x.price,0);
  const discRaw=Number($('#saleDiscount').value);
  const discount=Number.isFinite(discRaw)&&discRaw>0?Math.min(discRaw,subtotal):0;
  $('#saleLines').innerHTML=saleLines.map((x,i)=>
    `<div class="line-row"><span>${esc(x.name)} × ${x.quantity}</span><b>${money(x.quantity*x.price)}</b><button type="button" class="ghost" onclick="removeSale(${i})">Remove</button></div>`
  ).join('');
  $('#saleTotal').textContent='Total: '+money(subtotal-discount);
}

window.removeSale=i=>{saleLines.splice(i,1);renderSaleLines()};
$('#saleDiscount').oninput=renderSaleLines;

$('#saleForm').onsubmit=async e=>{
  e.preventDefault();
  if(!saleLines.length)return notice('Add at least one item.',true);
  // Open blank tab synchronously so the popup blocker doesn't kill the receipt
  const receiptWin=window.open('','_blank');
  try{
    const d=await api('/sales',{method:'POST',body:JSON.stringify({
      customer:{name:$('#buyerName').value,phone:$('#buyerPhone').value,address:$('#buyerAddress').value},
      items:saleLines,
      discount:$('#saleDiscount').value
    })});
    saleLines=[];
    e.target.reset();
    await loadSaleOptions();
    if(receiptWin)receiptWin.location='/api/receipt/'+d.sale.id+'.pdf';
    else window.location='/api/receipt/'+d.sale.id+'.pdf';
    notice('Sale completed. Receipt opened in a new tab.');
  }catch(err){
    if(receiptWin)receiptWin.close();
    notice(err.message,true);
    await loadSaleOptions().catch(()=>{}); // refresh stock after failure
  }
};

/* ================= HISTORY / ANALYTICS / EXPENSES / SECURITY ================= */

async function history(){const from=$('#historyFrom').value,to=$('#historyTo').value;const d=await api('/sales?from='+from+'&to='+to);$('#salesTable').innerHTML=table(d,[['Invoice',x=>esc(x.invoice_no)],['Date',x=>new Date(x.created_at).toLocaleString()],['Buyer',x=>esc(x.customer_name)],['Phone',x=>esc(x.phone)],['Total',x=>money(x.total)],['Receipt',x=>`<a href="/api/receipt/${x.id}.pdf" target="_blank">PDF</a>`]])}
$('#loadHistory').onclick=()=>history().catch(e=>notice(e.message,true));$('#downloadReport').onclick=()=>window.open('/api/reports/sales.pdf?from='+$('#historyFrom').value+'&to='+$('#historyTo').value,'_blank');
async function analytics(){const from=$('#analyticsFrom').value,to=$('#analyticsTo').value||new Date().toISOString().slice(0,10);const d=await api('/analytics?from='+from+'&to='+to);$('#aRevenue').textContent=money(d.summary.revenue);$('#aProfit').textContent=money(d.summary.gross_profit);$('#aExpenses').textContent=money(d.expenses);$('#aNet').textContent=money(d.net_after_expenses);if(analyticsChart)analyticsChart.destroy();analyticsChart=new Chart($('#analyticsChart'),{type:'bar',data:{labels:d.daily.map(x=>new Date(x.day).toLocaleDateString()),datasets:[{label:'Revenue',data:d.daily.map(x=>x.revenue),backgroundColor:'#52dfbd'}]},options:{plugins:{legend:{labels:{color:'#cbd8e8'}}},scales:{x:{ticks:{color:'#91a2b8'}},y:{ticks:{color:'#91a2b8'}}}}});$('#topMedicines').innerHTML='<h3>Top medicines</h3>'+table(d.top,[['Medicine',x=>esc(x.name)],['Quantity sold',x=>x.quantity],['Revenue',x=>money(x.revenue)]])}
$('#loadAnalytics').onclick=()=>analytics().catch(e=>notice(e.message,true));
async function expenses(){const d=await api('/expenses');$('#expenseTable').innerHTML=table(d,[['Date',x=>new Date(x.expense_date).toLocaleDateString()],['Title',x=>esc(x.title)],['Category',x=>esc(x.category)],['Amount',x=>money(x.amount)],['Notes',x=>esc(x.notes||'—')]])}
$('#expenseForm').onsubmit=async e=>{e.preventDefault();await api('/expenses',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();await expenses();notice('Expense saved.')};
async function auditLogs(){const d=await api('/audit-logs');$('#auditTable').innerHTML=table(d,[['Time',x=>new Date(x.created_at).toLocaleString()],['Admin',x=>esc(x.username||'—')],['Action',x=>esc(x.action)],['Entity',x=>esc(x.entity_type||'—')],['Details',x=>esc(JSON.stringify(x.details))]])}
$('#passwordForm').onsubmit=async e=>{e.preventDefault();await api('/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});e.target.reset();notice('Password updated.')};
$('#backupHelp').onclick=async()=>{const d=await api('/backup/instructions');$('#backupText').textContent='BACKUP:\n'+d.commands.backup+'\n\nRESTORE (will replace database contents):\n'+d.commands.restore;$('#backupText').classList.toggle('hidden')};
$('#loginForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});boot(d.admin)}catch(err){$('#loginError').textContent=err.message}};
async function boot(admin){$('#loginView').classList.add('hidden');$('#appView').classList.remove('hidden');$('#adminName').textContent=admin.username;showPage('dashboard')}
$('#logoutBtn').onclick=async()=>{await api('/logout',{method:'POST'});location.reload()};
$$('#nav button').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$('#menuBtn').onclick=()=>$('.sidebar').classList.toggle('open');
(async()=>{try{const d=await api('/me');if(d.admin)boot(d.admin)}catch{}})();
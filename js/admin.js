(function(){
  const session = (()=>{try{return JSON.parse(localStorage.getItem('safralink_admin_session')||'null')}catch(_){return null}})();
  if (!session || session.admin !== true) { location.replace('admin-login.html'); return; }

  const DEMO_PRODUCTS = [
    {id:1,name:'Tomate',type:'Hortaliça',qty:'120 kg',price:'R$ 6,50/kg',location:'Itapetininga - SP',emoji:'🍅',seller:'Sítio Boa Terra',sellerEmail:'demo1@safralink.com'},
    {id:2,name:'Milho verde',type:'Cereal',qty:'300 kg',price:'R$ 4,20/kg',location:'Tatuí - SP',emoji:'🌽',seller:'Produtor João',sellerEmail:'demo2@safralink.com'},
    {id:3,name:'Alface',type:'Hortaliça',qty:'80 un.',price:'R$ 2,50/un.',location:'Itapetininga - SP',emoji:'🥬',seller:'Horta da Ana',sellerEmail:'demo3@safralink.com'},
    {id:4,name:'Abóbora',type:'Legume',qty:'180 kg',price:'R$ 3,80/kg',location:'Capão Bonito - SP',emoji:'🎃',seller:'Sítio Verde',sellerEmail:'demo4@safralink.com'},
    {id:5,name:'Mandioca',type:'Raiz',qty:'250 kg',price:'R$ 3,20/kg',location:'Itapetininga - SP',emoji:'🥔',seller:'Família Souza',sellerEmail:'demo5@safralink.com'},
    {id:6,name:'Morango',type:'Fruta',qty:'60 kg',price:'R$ 14,00/kg',location:'São Miguel Arcanjo - SP',emoji:'🍓',seller:'Chácara do Vale',sellerEmail:'demo6@safralink.com'}
  ];

  const defs = [
    {key:'users',label:'Usuários',storage:'safralink_users'},
    {key:'products',label:'Produtos',storage:'safralink_products',seed:DEMO_PRODUCTS},
    {key:'harvests',label:'Colheitas',storage:'safralink_harvests'},
    {key:'orders',label:'Pedidos',storage:'safralink_orders'},
    {key:'transports',label:'Transportes',storage:'safralink_transports'},
    {key:'leftovers',label:'Sobras',storage:'safralink_leftovers'},
  ];

  const esc = v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const FIELD_LABELS = {
    id:'Identificação', name:'Nome', email:'E-mail', password:'Senha', seller:'Vendedor', buyer:'Comprador',
    sellerEmail:'E-mail do vendedor', buyerEmail:'E-mail do comprador', sellerName:'Nome do vendedor', buyerName:'Nome do comprador',
    type:'Tipo', category:'Categoria', description:'Descrição', photoData:'Foto', image:'Imagem', emoji:'Ícone',
    qty:'Quantidade', quantity:'Quantidade', quantityValue:'Quantidade solicitada', availableQuantity:'Quantidade disponível',
    unit:'Unidade', quantityUnit:'Unidade da quantidade', price:'Preço', location:'Localização', address:'Endereço',
    city:'Cidade', state:'Estado', cep:'CEP', phone:'Telefone', document:'Documento', documentType:'Tipo de documento',
    birth:'Data de nascimento', openingDate:'Data de abertura', farmName:'Nome da propriedade', productionType:'Tipo de produção',
    activityDescription:'Descrição da atividade', documentPhoto:'Documento', terms:'Termos aceitos',
    product:'Produto', productId:'Identificação do produto', productName:'Nome do produto', minimumOrder:'Pedido mínimo',
    date:'Data', createdAt:'Data de criação', updatedAt:'Data de atualização', status:'Situação', deliveryMethod:'Forma de entrega',
    total:'Total', totalValue:'Valor total', orderId:'Identificação do pedido', transportId:'Identificação do transporte',
    origin:'Origem', destination:'Destino', plate:'Placa', vehicle:'Veículo', driver:'Motorista', harvest:'Colheita',
    harvestId:'Identificação da colheita', notes:'Observações', note:'Observação',
    sellerId:'Identificação do vendedor', buyerId:'Identificação do comprador', userId:'Identificação do usuário',
    role:'Perfil', sellerEmail:'E-mail do vendedor', buyerEmail:'E-mail do comprador'
  };
  const labelKey = key => FIELD_LABELS[key] || String(key).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
  function read(def){
    try{ const raw=localStorage.getItem(def.storage); if(raw!==null){const x=JSON.parse(raw); return Array.isArray(x)?x:[];} }catch(_){}
    return def.seed ? def.seed.slice() : [];
  }
  function write(def,list){
    localStorage.setItem(def.storage,JSON.stringify(list));
    if (typeof window.syncStorageKeyWithSupabase === 'function') {
      window.syncStorageKeyWithSupabase(def.storage, list);
    }
    // Se o administrador alterou um usuário que está logado neste navegador,
    // a sessão daquele usuário também é atualizada imediatamente.
    if (def.key === 'users') {
      try {
        const session = JSON.parse(localStorage.getItem('safralink_user') || 'null');
        if (session) {
          const current = list.find(u =>
            String(u.email || '').toLowerCase() === String(session.email || '').toLowerCase() ||
            (u.id != null && session.id != null && String(u.id) === String(session.id))
          );
          if (current) localStorage.setItem('safralink_user', JSON.stringify({...session, ...current}));
        }
      } catch (_) {}
    }
  }
  function translateValue(key,v){
    if (v === true) return 'Sim';
    if (v === false) return 'Não';
    const text=String(v??'');
    const k=String(key||'').toLowerCase();
    const maps={
      seller:{'true':'Sim','false':'Não'},
      buyer:{'true':'Sim','false':'Não'},
      role:{seller:'Produtor rural','produtor rural':'Produtor rural',buyer:'Comprador',comprador:'Comprador',admin:'Administrador',user:'Usuário'},
      documenttype:{cpf:'CPF',cnpj:'CNPJ'},
      status:{requested:'Solicitado',scheduled:'Agendado',enroute:'A caminho',delivered:'Entregue'},
      deliverymethod:{pickup:'Retirada','seller delivery':'Entrega pelo vendedor'}
    };
    const map=maps[k];
    if(map && Object.prototype.hasOwnProperty.call(map,text.toLowerCase())) return map[text.toLowerCase()];
    if (v && typeof v==='object') return JSON.stringify(v, (nestedKey, value) => {
      if (value === true) return 'Sim';
      if (value === false) return 'Não';
      return value;
    });
    return text;
  }
  function labelValue(v){ return translateValue('',v); }
  function short(v,key){ const s=translateValue(key,v); return s.length>90?s.slice(0,87)+'…':s; }
  function fieldsFor(obj){
    const entries=Object.entries(obj||{});
    return entries.filter(([k])=>k!=='__proto__');
  }
  function renderStats(){
    const el=document.getElementById('admin-stats');
    el.innerHTML=defs.map(d=>`<div class="admin-stat"><span>${d.label}</span><strong>${read(d).length}</strong></div>`).join('');
  }
  function renderTabs(){
    document.getElementById('admin-tabs').innerHTML=defs.map((d,i)=>`<button class="admin-tab ${i===0?'active':''}" data-tab="${d.key}">${d.label}</button>`).join('');
    document.querySelectorAll('.admin-tab').forEach(btn=>btn.onclick=()=>activate(btn.dataset.tab));
  }
  function activate(key){
    document.querySelectorAll('.admin-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===key));
    defs.forEach(d=>document.getElementById('panel-'+d.key)?.classList.toggle('active',d.key===key));
  }
  function renderPanels(){
    const host=document.getElementById('admin-panels'); host.innerHTML='';
    defs.forEach(d=>{
      const section=document.createElement('section'); section.className='admin-panel'; section.id='panel-'+d.key;
      section.innerHTML=`<div class="card" style="margin-bottom:14px"><h2>${d.label}</h2><p class="admin-note">Edite ou exclua registros diretamente. Alterações aqui refletem na plataforma.</p></div><div class="admin-table-wrap"><table class="admin-table"><thead></thead><tbody></tbody></table></div>`;
      host.appendChild(section); renderTable(d);
    });
  }
  function renderTable(def){
    const section=document.getElementById('panel-'+def.key); if(!section)return;
    const data=read(def), table=section.querySelector('table'), thead=table.querySelector('thead'), tbody=table.querySelector('tbody');
    const keys=[...new Set(data.flatMap(item=>Object.keys(item||{})))].slice(0,8);
    if(!data.length){thead.innerHTML='';tbody.innerHTML=`<tr><td class="admin-empty">Nenhum registro encontrado.</td></tr>`;return;}
    thead.innerHTML='<tr>'+keys.map(k=>`<th>${esc(labelKey(k))}</th>`).join('')+'<th>Ações</th></tr>';
    tbody.innerHTML=data.map((item,index)=>`<tr>${keys.map(k=>`<td>${esc(short(item[k],k))}</td>`).join('')}<td><div class="admin-actions"><button class="btn btn-soft" data-edit="${index}">Editar</button><button class="btn admin-danger" data-delete="${index}">Excluir</button></div></td></tr>`).join('');
    tbody.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>openEditor(def,Number(b.dataset.edit)));
    tbody.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>removeItem(def,Number(b.dataset.delete)));
  }
  function removeItem(def,index){
    const list=read(def); if(!list[index])return;
    const title=list[index].name||list[index].email||list[index].product||list[index].id||'este registro';
    if(!confirm(`Excluir ${title}? Esta ação não pode ser desfeita.`))return;
    list.splice(index,1); write(def,list); refresh();
  }
  function openEditor(def,index){
    const list=read(def), original=list[index]; if(!original)return;
    const modal=document.createElement('div');
    modal.innerHTML=`<div class="admin-editor-backdrop"></div><div class="admin-editor"><h2>Editar ${esc(def.key==='users'?'usuário':def.key==='products'?'produto':def.key==='harvests'?'colheita':def.key==='orders'?'pedido':def.key==='transports'?'transporte':'sobra')}</h2><div class="admin-fields"></div><div class="admin-editor-actions"><button class="btn btn-soft" data-cancel>Cancelar</button><button class="btn btn-primary" data-save>Salvar alterações</button></div></div>`;
    document.body.appendChild(modal);
    const fields=modal.querySelector('.admin-fields');
    fieldsFor(original).forEach(([key,value])=>{
      const wrap=document.createElement('div'); wrap.className=String(value).length>120?'full':'';
      const label=document.createElement('label'); label.className='field';
      label.innerHTML=`<span>${esc(labelKey(key))}</span>`;
      let input;
      if (typeof value === 'boolean') {
        input=document.createElement('select');
        input.className='select';
        input.innerHTML='<option value=\"true\">Sim</option><option value=\"false\">Não</option>';
        input.value=String(value);
        input.dataset.boolean='true';
      } else if (key === 'role' && ['seller','buyer','produtor rural','comprador','admin','user'].includes(String(value).toLowerCase())) {
        input=document.createElement('select');
        input.className='select';
        const normRole = ['seller','produtor rural'].includes(String(value).toLowerCase()) ? 'produtor rural' : ['buyer','comprador'].includes(String(value).toLowerCase()) ? 'comprador' : String(value).toLowerCase();
        input.innerHTML='<option value="comprador">Comprador</option><option value="produtor rural">Produtor rural</option><option value="user">Usuário</option><option value="admin">Administrador</option>';
        input.value=normRole;
        input.dataset.enum='true';
      } else {
        input=(typeof value==='object'||String(value).length>120)?document.createElement('textarea'):document.createElement('input');
        input.value=translateValue(key,value);
      }
      input.dataset.key=key; input.style.width='100%'; input.className += ' input';
      label.appendChild(input); wrap.appendChild(label); fields.appendChild(wrap);
    });
    const close=()=>modal.remove(); modal.querySelector('[data-cancel]').onclick=close; modal.querySelector('.admin-editor-backdrop').onclick=close;
    modal.querySelector('[data-save]').onclick=()=>{
      const updated={...original}; let bad=false;
      modal.querySelectorAll('[data-key]').forEach(input=>{ const key=input.dataset.key; const old=original[key]; let value=input.value; if(input.dataset.boolean==='true'){ value=input.value==='true'; } else if(old&&typeof old==='object'){try{value=JSON.parse(value)}catch(_){bad=true;}} updated[key]=value; });
      if(bad){alert('Existe um campo em formato JSON inválido. Corrija antes de salvar.');return;}
      if (def.key === 'users') {
        const newEmail = String(updated.email || '').trim().toLowerCase();
        if (!newEmail) { alert('O e-mail do usuário é obrigatório.'); return; }
        const duplicated = list.some((u,i) => i !== index && String(u.email || '').trim().toLowerCase() === newEmail);
        if (duplicated) { alert('Já existe outro usuário com este e-mail.'); return; }
        updated.email = newEmail;
        if (updated.seller !== original.seller) {
          updated.role = updated.seller ? 'produtor rural' : 'comprador';
        } else if (updated.role !== original.role) {
          updated.seller = ['seller', 'produtor rural', 'vendedor'].includes(String(updated.role || '').toLowerCase());
          updated.admin = String(updated.role || '').toLowerCase() === 'admin';
        }
      }
      list[index]=updated; write(def,list);
      // Mantém referências dos registros ligados ao usuário quando o e-mail mudou.
      if (def.key === 'users' && String(original.email || '').toLowerCase() !== String(updated.email || '').toLowerCase()) {
        const oldEmail = String(original.email || '').toLowerCase();
        const newEmail = String(updated.email || '').toLowerCase();
        ['safralink_products','safralink_orders','safralink_transports','safralink_harvests','safralink_leftovers'].forEach(storage => {
          try {
            const arr = JSON.parse(localStorage.getItem(storage) || '[]');
            if (!Array.isArray(arr)) return;
            const replaceKeys = ['sellerEmail','buyerEmail','email','userEmail'];
            arr.forEach(obj => { if (obj && typeof obj === 'object') replaceKeys.forEach(k => { if (String(obj[k] || '').toLowerCase() === oldEmail) obj[k] = newEmail; }); });
            localStorage.setItem(storage, JSON.stringify(arr));
            if (typeof window.syncStorageKeyWithSupabase === 'function') {
              window.syncStorageKeyWithSupabase(storage, arr);
            }
          } catch (_) {}
        });
      }
      close(); refresh();
    };
  }
  function refresh(){renderStats();renderPanels();renderTabs();activate(document.querySelector('.admin-tab.active')?.dataset.tab||'users');}
  document.getElementById('admin-logout').onclick=()=>{localStorage.removeItem('safralink_admin_session');location.href='index.html';};
  window.addEventListener('safralink:synced', refresh);
  refresh();
})();

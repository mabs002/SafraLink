/* =========================================================
   SAFRALINK
   JavaScript principal do sistema
   ========================================================= */

// =====================================================
// CONFIGURAÇÃO DO SUPABASE
// =====================================================

// URL do projeto Supabase
// Substitua pelo endereço do seu projeto.
const SUPABASE_URL = "https://tngetuphoormtqubcmyy.supabase.co";


// Chave pública do projeto
// Utilize somente a chave pública destinada ao cliente.
// NÃO coloque aqui a Service Role Key.
const SUPABASE_ANON_KEY = "sb_publishable_J2OZod_UhX_9h5V0rDd05w_Ut4scr1E";


// Cria a conexão com o Supabase
const supabaseClient =
  typeof supabase !== "undefined" &&
  SUPABASE_URL &&
  SUPABASE_URL !== "COLE_AQUI_SUA_URL" &&
  /^https?:\/\//i.test(SUPABASE_URL) &&
  SUPABASE_ANON_KEY &&
  SUPABASE_ANON_KEY !== "COLE_AQUI_SUA_CHAVE_PUBLICA"
    ? supabase.createClient(
        SUPABASE_URL,
        SUPABASE_ANON_KEY
      )
    : null;

window.supabaseClient = supabaseClient;


/* =========================================================
   INTEGRAÇÃO E SINCRONIZAÇÃO COM SUPABASE (POSTGRESQL)
   ========================================================= */

let isApplyingRemoteSync = false;
let hasRemoteSynced = false;
const pendingSupabaseOps = [];
const dbSnapshots = {};

function isSellerUser(u) {
  if (!u || u.admin === true) return false;
  const r = String(u.role || u.perfil || u.tipo || '').trim().toLowerCase();
  if (r === 'admin' || r === 'administrador') return false;
  return !!(
    u.seller === true ||
    u.vendedor === true ||
    r === 'seller' ||
    r === 'produtor rural' ||
    r === 'vendedor' ||
    r === 'produtor'
  );
}
window.isSellerUser = isSellerUser;

function compressImageDataUrl(dataUrl, maxDim = 400, quality = 0.82) {
  return new Promise(resolve => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      resolve(dataUrl || '');
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.width || maxDim;
        let h = img.height || maxDim;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
          else { w = Math.round((w * maxDim) / h); h = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (_) {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}
window.compressImageDataUrl = compressImageDataUrl;

function safeSetLocalStorage(key, value) {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  try {
    localStorage.setItem(key, serialized);
    return true;
  } catch (_) {
    // Se o localStorage atingiu o limite de 5 MB (comum ao compartilhar domínio no GitHub Pages),
    // liberamos fotos duplicadas na sessão e chaves antigas para garantir que nada quebre.
    try {
      const rawUser = localStorage.getItem('safralink_user');
      if (rawUser && key !== 'safralink_user') {
        const parsedUser = JSON.parse(rawUser);
        if (parsedUser && parsedUser.photoData && parsedUser.photoData.length > 2000) {
          const slimUser = { ...parsedUser };
          delete slimUser.photoData;
          localStorage.setItem('safralink_user', JSON.stringify(slimUser));
        }
      }
      const rawInterests = localStorage.getItem('safralink_product_interests');
      if (rawInterests && key !== 'safralink_product_interests') {
        const parsedInterests = JSON.parse(rawInterests);
        if (Array.isArray(parsedInterests)) {
          const slimInterests = parsedInterests.map(i => ({ ...i, photoData: '' }));
          localStorage.setItem('safralink_product_interests', JSON.stringify(slimInterests));
        }
      }
      localStorage.setItem(key, serialized);
      return true;
    } catch (__) {
      try {
        if (key === 'safralink_user' && typeof value === 'object' && value) {
          const slim = { ...value };
          delete slim.photoData;
          localStorage.setItem(key, JSON.stringify(slim));
          return true;
        }
        if (Array.isArray(value)) {
          const slimList = value.map(item => (item && typeof item === 'object' && item.photoData ? { ...item, photoData: '' } : item));
          localStorage.setItem(key, JSON.stringify(slimList));
          return true;
        }
      } catch (___) {}
      return false;
    }
  }
}
window.safeSetLocalStorage = safeSetLocalStorage;

function trackSupabaseOp(promise) {
  if (!promise || typeof promise.then !== 'function') return promise;
  const nativePromise = Promise.resolve(promise);
  pendingSupabaseOps.push(nativePromise);
  nativePromise.finally(() => {
    const idx = pendingSupabaseOps.indexOf(nativePromise);
    if (idx >= 0) pendingSupabaseOps.splice(idx, 1);
  });
  return nativePromise;
}

window.waitForSupabaseSync = function () {
  return Promise.allSettled(pendingSupabaseOps.slice());
};

function validDbId(id) {
  const num = Number(id);
  return Number.isInteger(num) && num > 0 && num < 1000000000000 ? num : null;
}

function userIdByEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean) return null;
  const u = getUsers().find(item => String(item.email || '').trim().toLowerCase() === clean);
  return u ? validDbId(u.id) : null;
}
window.userIdByEmail = userIdByEmail;

function fromDbUser(row) {
  const perfilRaw = String(row.perfil || '').trim().toLowerCase();
  const isAdmin = row.admin === true || perfilRaw === 'admin' || perfilRaw === 'administrador';
  const isSeller = !isAdmin && (
    row.vendedor === true ||
    perfilRaw === 'seller' ||
    perfilRaw === 'produtor rural' ||
    perfilRaw === 'vendedor' ||
    perfilRaw === 'produtor'
  );
  return {
    id: row.id,
    name: row.nome || 'Usuário',
    email: String(row.email || '').toLowerCase(),
    password: row.senha || '',
    seller: isSeller,
    admin: isAdmin,
    role: isAdmin ? 'admin' : isSeller ? 'produtor rural' : 'comprador',
    farm: row.propriedade || '',
    city: row.municipio || '',
    sellerDocumentType: row.tipo_documento || '',
    documentType: row.tipo_documento || '',
    sellerDocument: row.documento || '',
    document: row.documento || '',
    sellerBirthDate: row.data_nascimento || '',
    birth: row.data_nascimento || '',
    sellerPhone: row.telefone || '',
    phone: row.telefone || '',
    sellerCep: row.cep || '',
    cep: row.cep || '',
    sellerAddress: row.endereco || '',
    address: row.endereco || '',
    sellerProduction: row.tipo_producao || '',
    productionType: row.tipo_producao || '',
    sellerDescription: row.descricao_atividade || '',
    activityDescription: row.descricao_atividade || '',
    sellerDocumentFileName: row.arquivo_documento || '',
    photoData: row.foto_perfil || '',
    sellerRegistrationComplete: isSeller
  };
}

function toDbUser(u) {
  const roleRaw = String(u.role || u.perfil || '').trim().toLowerCase();
  const isAdmin = u.admin === true || roleRaw === 'admin' || roleRaw === 'administrador';
  const isSeller = !isAdmin && (
    u.seller === true ||
    roleRaw === 'seller' ||
    roleRaw === 'produtor rural' ||
    roleRaw === 'vendedor' ||
    roleRaw === 'produtor'
  );
  return {
    nome: u.name || u.nome || 'Usuário',
    email: String(u.email || '').trim().toLowerCase(),
    senha: u.password || u.senha || '123456',
    vendedor: isSeller,
    admin: isAdmin,
    perfil: isAdmin ? 'admin' : isSeller ? 'produtor rural' : 'comprador',
    propriedade: u.farm || u.farmName || '',
    municipio: u.city || '',
    tipo_documento: u.sellerDocumentType || u.documentType || '',
    documento: u.sellerDocument || u.document || '',
    data_nascimento: u.sellerBirthDate || u.birth || '',
    telefone: u.sellerPhone || u.phone || '',
    cep: u.sellerCep || u.cep || '',
    endereco: u.sellerAddress || u.address || '',
    tipo_producao: u.sellerProduction || u.productionType || '',
    descricao_atividade: u.sellerDescription || u.activityDescription || '',
    arquivo_documento: u.sellerDocumentFileName || '',
    foto_perfil: u.photoData || ''
  };
}

function fromDbProduct(row) {
  return {
    id: row.id,
    name: row.nome || '',
    type: row.tipo || 'Hortaliça',
    qty: row.quantidade || '',
    price: row.preco || '',
    location: row.localizacao || '',
    emoji: row.emoji || '🌱',
    description: row.descricao || '',
    unit: row.unidade || '',
    minOrder: row.pedido_minimo || '',
    photoData: row.foto || '',
    disponivel: row.disponivel !== false,
    seller: row.vendedor_nome || 'Produtor',
    sellerEmail: String(row.vendedor_email || '').toLowerCase(),
    reviews: Array.isArray(row.avaliacoes) ? row.avaliacoes : []
  };
}

function toDbProduct(p) {
  return {
    usuario_id: userIdByEmail(p.sellerEmail),
    nome: p.name || '',
    tipo: p.type || 'Hortaliça',
    quantidade: p.qty || '',
    preco: p.price || '',
    localizacao: p.location || '',
    emoji: p.emoji || '🌱',
    descricao: p.description || '',
    unidade: p.unit || '',
    pedido_minimo: p.minOrder || '',
    foto: p.photoData || '',
    disponivel: p.disponivel !== false,
    vendedor_nome: p.seller || 'Produtor',
    vendedor_email: String(p.sellerEmail || '').toLowerCase(),
    avaliacoes: Array.isArray(p.reviews) ? p.reviews : []
  };
}

function fromDbHarvest(row) {
  return {
    id: row.id,
    product: row.produto || '',
    quantity: row.quantidade || '',
    start: row.data_inicio ? String(row.data_inicio).slice(0, 10) : '',
    end: row.data_fim ? String(row.data_fim).slice(0, 10) : '',
    status: row.status || 'Prevista',
    notes: row.observacoes || '',
    seller: row.vendedor_nome || 'Produtor',
    sellerEmail: String(row.vendedor_email || '').toLowerCase()
  };
}

function toDbHarvest(h) {
  return {
    usuario_id: userIdByEmail(h.sellerEmail),
    produto: h.product || '',
    quantidade: h.quantity || '',
    data_inicio: h.start || new Date().toISOString().slice(0, 10),
    data_fim: h.end || h.start || new Date().toISOString().slice(0, 10),
    status: h.status || 'Prevista',
    observacoes: h.notes || '',
    vendedor_nome: h.seller || 'Produtor',
    vendedor_email: String(h.sellerEmail || '').toLowerCase()
  };
}

function fromDbOrder(row) {
  return {
    id: row.id,
    productId: row.produto_id,
    product: row.produto_nome || '',
    quantity: row.quantidade || '',
    quantityValue: row.quantidade_valor != null ? Number(row.quantidade_valor) : 0,
    quantityUnit: row.quantidade_unidade || '',
    availableQuantity: row.quantidade_disponivel || '',
    buyer: row.comprador_nome || 'Comprador',
    buyerEmail: String(row.comprador_email || '').toLowerCase(),
    seller: row.vendedor_nome || 'Produtor',
    sellerEmail: String(row.vendedor_email || '').toLowerCase(),
    date: row.data_pedido || '',
    status: row.status || 'Negociação',
    deliveryMethod: row.forma_entrega || 'A combinar'
  };
}

function toDbOrder(o) {
  return {
    produto_id: validDbId(o.productId),
    comprador_id: userIdByEmail(o.buyerEmail),
    vendedor_id: userIdByEmail(o.sellerEmail),
    produto_nome: o.product || '',
    quantidade: o.quantity || '',
    quantidade_valor: o.quantityValue != null ? Number(o.quantityValue) : null,
    quantidade_unidade: o.quantityUnit || '',
    quantidade_disponivel: o.availableQuantity || '',
    comprador_nome: o.buyer || 'Comprador',
    comprador_email: String(o.buyerEmail || '').toLowerCase(),
    vendedor_nome: o.seller || 'Produtor',
    vendedor_email: String(o.sellerEmail || '').toLowerCase(),
    data_pedido: o.date || new Date().toLocaleDateString('pt-BR'),
    status: o.status || 'Negociação',
    forma_entrega: o.deliveryMethod || 'A combinar'
  };
}

function fromDbTransport(row) {
  return {
    id: row.id,
    plate: row.placa || '',
    product: row.produto || '',
    origin: row.origem || '',
    destination: row.destino || '',
    quantity: row.quantidade || '',
    status: row.status || 'Solicitado',
    sellerEmail: String(row.vendedor_email || '').toLowerCase()
  };
}

function toDbTransport(t) {
  return {
    usuario_id: userIdByEmail(t.sellerEmail),
    placa: t.plate || '',
    produto: t.product || '',
    origem: t.origin || '',
    destino: t.destination || '',
    quantidade: t.quantity || '',
    status: t.status || 'Solicitado',
    vendedor_email: String(t.sellerEmail || '').toLowerCase()
  };
}

function fromDbLeftover(row) {
  return {
    id: row.id,
    product: row.produto || '',
    quantity: row.quantidade || '',
    destination: row.destino || 'Doação',
    date: row.data_registro || '',
    sellerEmail: String(row.vendedor_email || '').toLowerCase()
  };
}

function toDbLeftover(l) {
  return {
    usuario_id: userIdByEmail(l.sellerEmail),
    produto: l.product || '',
    quantidade: l.quantity || '',
    destino: l.destination || 'Doação',
    data_registro: l.date || '',
    vendedor_email: String(l.sellerEmail || '').toLowerCase()
  };
}

function fromDbInterest(row) {
  return {
    id: row.id,
    productId: row.produto_id,
    buyerEmail: String(row.comprador_email || '').toLowerCase(),
    name: row.nome || 'Produto',
    type: row.tipo || 'Produto',
    price: row.preco || '',
    qty: row.quantidade || '',
    unit: row.unidade || '',
    seller: row.vendedor_nome || 'Produtor',
    sellerEmail: String(row.vendedor_email || '').toLowerCase(),
    location: row.localizacao || '',
    photoData: row.foto || '',
    createdAt: row.criado_em || new Date().toISOString()
  };
}

function toDbInterest(i) {
  return {
    produto_id: validDbId(i.productId),
    usuario_id: userIdByEmail(i.buyerEmail),
    comprador_email: String(i.buyerEmail || '').toLowerCase(),
    nome: i.name || 'Produto',
    tipo: i.type || 'Produto',
    preco: i.price || '',
    quantidade: i.qty || '',
    unidade: i.unit || '',
    vendedor_nome: i.seller || 'Produtor',
    vendedor_email: String(i.sellerEmail || '').toLowerCase(),
    localizacao: i.location || '',
    foto: i.photoData || ''
  };
}

const STORAGE_TO_SUPABASE = {
  safralink_users: { table: 'usuarios', toDb: toDbUser, fromDb: fromDbUser, keyField: 'email' },
  safralink_products: { table: 'produtos', toDb: toDbProduct, fromDb: fromDbProduct },
  safralink_harvests: { table: 'colheitas', toDb: toDbHarvest, fromDb: fromDbHarvest },
  safralink_orders: { table: 'pedidos', toDb: toDbOrder, fromDb: fromDbOrder },
  safralink_transports: { table: 'transportes', toDb: toDbTransport, fromDb: fromDbTransport },
  safralink_leftovers: { table: 'sobras', toDb: toDbLeftover, fromDb: fromDbLeftover },
  safralink_product_interests: { table: 'interesses', toDb: toDbInterest, fromDb: fromDbInterest }
};

function readRawStorageList(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

Object.keys(STORAGE_TO_SUPABASE).forEach(key => {
  dbSnapshots[key] = readRawStorageList(key);
});

function syncStorageKeyWithSupabase(storageKey, nextList) {
  const cfg = STORAGE_TO_SUPABASE[storageKey];
  const prevList = Array.isArray(dbSnapshots[storageKey]) ? dbSnapshots[storageKey] : [];
  const currentList = Array.isArray(nextList) ? nextList.map(item => ({ ...item })) : [];
  dbSnapshots[storageKey] = currentList;

  if (!supabaseClient || isApplyingRemoteSync || !cfg) return;

  const { table, toDb, keyField } = cfg;
  const matchItem = (list, target) => {
    if (validDbId(target.id)) {
      const byId = list.find(x => String(x.id) === String(target.id));
      if (byId) return byId;
    }
    if (keyField && target[keyField]) {
      return list.find(x => String(x[keyField] || '').toLowerCase() === String(target[keyField] || '').toLowerCase());
    }
    return list.find(x => x.id != null && target.id != null && String(x.id) === String(target.id));
  };

  // 1. Exclusões
  prevList.forEach(oldItem => {
    if (!matchItem(currentList, oldItem)) {
      if (validDbId(oldItem.id)) {
        trackSupabaseOp(supabaseClient.from(table).delete().eq('id', Number(oldItem.id)));
      } else if (keyField && oldItem[keyField]) {
        trackSupabaseOp(supabaseClient.from(table).delete().eq(keyField, String(oldItem[keyField]).toLowerCase()));
      }
    }
  });

  // 2. Inserções e Atualizações
  currentList.forEach(item => {
    const prevItem = matchItem(prevList, item);
    if (!prevItem || (!validDbId(item.id) && !validDbId(prevItem.id))) {
      if (table === 'usuarios') {
        trackSupabaseOp(
          supabaseClient
            .from('usuarios')
            .upsert(toDb(item), { onConflict: 'email' })
            .select()
            .single()
            .then(({ data }) => {
              if (data && data.id) {
                item.id = data.id;
                safeSetLocalStorage(storageKey, currentList);
              }
            })
        );
      } else {
        trackSupabaseOp(
          supabaseClient
            .from(table)
            .insert(toDb(item))
            .select()
            .single()
            .then(({ data }) => {
              if (data && data.id) {
                item.id = data.id;
                safeSetLocalStorage(storageKey, currentList);
              }
            })
        );
      }
    } else if (JSON.stringify(prevItem) !== JSON.stringify(item)) {
      if (table === 'usuarios' && item.email) {
        trackSupabaseOp(
          supabaseClient
            .from('usuarios')
            .upsert(toDb(item), { onConflict: 'email' })
            .select()
            .single()
            .then(({ data }) => {
              if (data && data.id) {
                item.id = data.id;
                safeSetLocalStorage(storageKey, currentList);
              }
            })
        );
      } else if (validDbId(item.id)) {
        trackSupabaseOp(supabaseClient.from(table).update(toDb(item)).eq('id', Number(item.id)).then(() => {}));
      }
    }
  });
}
window.syncStorageKeyWithSupabase = syncStorageKeyWithSupabase;

async function syncFromSupabase() {
  if (!supabaseClient) return;
  try {
    const [
      usersRes,
      productsRes,
      harvestsRes,
      ordersRes,
      transportsRes,
      leftoversRes,
      interestsRes,
      messagesRes
    ] = await Promise.all([
      supabaseClient.from('usuarios').select('*').order('id', { ascending: true }),
      supabaseClient.from('produtos').select('*').order('id', { ascending: false }),
      supabaseClient.from('colheitas').select('*').order('id', { ascending: false }),
      supabaseClient.from('pedidos').select('*').order('id', { ascending: false }),
      supabaseClient.from('transportes').select('*').order('id', { ascending: false }),
      supabaseClient.from('sobras').select('*').order('id', { ascending: false }),
      supabaseClient.from('interesses').select('*').order('id', { ascending: false }),
      supabaseClient.from('mensagens').select('*').order('criado_em', { ascending: true })
    ]);

    isApplyingRemoteSync = true;
    hasRemoteSynced = true;

    if (!usersRes.error && Array.isArray(usersRes.data)) {
      // Migra automaticamente registros no banco que ainda estejam com 'buyer' ou 'seller' para português
      usersRes.data.forEach(row => {
        const p = String(row.perfil || '').trim().toLowerCase();
        if (p === 'buyer' || p === 'seller') {
          const novoPerfil = (row.vendedor === true || p === 'seller') ? 'produtor rural' : 'comprador';
          row.perfil = novoPerfil;
          if (validDbId(row.id)) {
            supabaseClient.from('usuarios').update({ perfil: novoPerfil }).eq('id', Number(row.id)).then(() => {});
          }
        }
        // Otimiza fotos de perfil antigas muito pesadas no banco para não estourar o localStorage
        if (row.foto_perfil && row.foto_perfil.length > 80000 && validDbId(row.id)) {
          compressImageDataUrl(row.foto_perfil, 360, 0.8).then(compressed => {
            if (compressed && compressed.length < row.foto_perfil.length) {
              supabaseClient.from('usuarios').update({ foto_perfil: compressed }).eq('id', Number(row.id)).then(() => {});
            }
          });
        }
      });

      const mappedUsers = usersRes.data.map(fromDbUser);
      dbSnapshots.safralink_users = mappedUsers.map(u => ({ ...u }));
      safeSetLocalStorage('safralink_users', mappedUsers);

      const session = JSON.parse(localStorage.getItem('safralink_user') || 'null');
      if (session && session.email) {
        const freshUser = mappedUsers.find(u => u.email === String(session.email).trim().toLowerCase());
        if (freshUser) {
          if (isSellerUser(session) && !freshUser.seller) {
            const upgraded = {
              ...freshUser,
              ...session,
              photoData: session.photoData || freshUser.photoData || '',
              seller: true,
              role: 'produtor rural'
            };
            safeSetLocalStorage('safralink_user', upgraded);
            const idx = mappedUsers.findIndex(u => u.email === freshUser.email);
            if (idx >= 0) {
              mappedUsers[idx] = upgraded;
              dbSnapshots.safralink_users = mappedUsers.map(u => ({ ...u }));
              safeSetLocalStorage('safralink_users', mappedUsers);
            }
            trackSupabaseOp(
              supabaseClient
                .from('usuarios')
                .upsert(toDbUser(upgraded), { onConflict: 'email' })
                .select()
                .single()
            );
          } else {
            const mergedSession = {
              ...session,
              ...freshUser,
              seller: isSellerUser(freshUser),
              role: freshUser.admin ? 'admin' : isSellerUser(freshUser) ? 'produtor rural' : 'comprador',
              photoData: freshUser.photoData || session.photoData || ''
            };
            safeSetLocalStorage('safralink_user', mergedSession);
          }
        }
      }
    }

    if (!productsRes.error && Array.isArray(productsRes.data)) {
      const mappedProducts = productsRes.data.map(fromDbProduct);
      dbSnapshots.safralink_products = mappedProducts.map(p => ({ ...p }));
      safeSetLocalStorage('safralink_products', mappedProducts);
    }

    if (!harvestsRes.error && Array.isArray(harvestsRes.data)) {
      const mappedHarvests = harvestsRes.data.map(fromDbHarvest);
      dbSnapshots.safralink_harvests = mappedHarvests.map(h => ({ ...h }));
      safeSetLocalStorage('safralink_harvests', mappedHarvests);
    }

    if (!ordersRes.error && Array.isArray(ordersRes.data)) {
      const mappedOrders = ordersRes.data.map(fromDbOrder);
      dbSnapshots.safralink_orders = mappedOrders.map(o => ({ ...o }));
      safeSetLocalStorage('safralink_orders', mappedOrders);
    }

    if (!transportsRes.error && Array.isArray(transportsRes.data)) {
      const mappedTransports = transportsRes.data.map(fromDbTransport);
      dbSnapshots.safralink_transports = mappedTransports.map(t => ({ ...t }));
      safeSetLocalStorage('safralink_transports', mappedTransports);
    }

    if (!leftoversRes.error && Array.isArray(leftoversRes.data)) {
      const mappedLeftovers = leftoversRes.data.map(fromDbLeftover);
      dbSnapshots.safralink_leftovers = mappedLeftovers.map(l => ({ ...l }));
      safeSetLocalStorage('safralink_leftovers', mappedLeftovers);
    }

    if (!interestsRes.error && Array.isArray(interestsRes.data)) {
      const mappedInterests = interestsRes.data.map(fromDbInterest);
      dbSnapshots.safralink_product_interests = mappedInterests.map(i => ({ ...i }));
      safeSetLocalStorage('safralink_product_interests', mappedInterests);
    }

    if (!messagesRes.error && Array.isArray(messagesRes.data)) {
      applyRemoteMessages(messagesRes.data);
    }

    isApplyingRemoteSync = false;

    const isAdminOrChat =
      document.body.classList.contains('admin-page') ||
      document.body.classList.contains('admin-auth-page') ||
      document.body.dataset.page === 'chat';

    if (!isAdminOrChat) {
      setupShell();
      if (document.querySelector('#product-list')) {
        if (document.body.dataset.page === 'inicio') {
          renderInicioDashboard();
        } else {
          renderProducts();
        }
      }
      renderOrders();
      renderHarvests();
      renderTransports();
      renderLeftovers();
      renderInterestDrawer();
    }

    window.dispatchEvent(new CustomEvent('safralink:synced'));
  } catch (err) {
    isApplyingRemoteSync = false;
    console.error('Erro ao sincronizar com o Supabase:', err);
  }
}
window.syncFromSupabase = syncFromSupabase;

function applyRemoteMessages(rows) {
  let existingChats = {};
  try { existingChats = JSON.parse(localStorage.getItem('safralink_chats') || '{}') || {}; } catch (_) { existingChats = {}; }
  const rebuiltChats = {};

  // Mantém conversas abertas que ainda não possuem mensagens
  Object.entries(existingChats).forEach(([key, chat]) => {
    if (chat && Array.isArray(chat.participants) && chat.participants.length === 2) {
      rebuiltChats[key] = {
        participants: chat.participants.map(e => String(e || '').toLowerCase().trim()),
        messages: [],
        unread: {},
        createdAt: chat.createdAt || Date.now(),
        updatedAt: chat.updatedAt || Date.now()
      };
    }
  });

  (Array.isArray(rows) ? rows : []).forEach(row => {
    const sender = String(row.remetente_email || '').toLowerCase().trim();
    const receiver = String(row.destinatario_email || '').toLowerCase().trim();
    if (!sender || !receiver) return;
    const key = row.conversa_chave || [sender, receiver].sort().join('::');
    const ts = row.criado_em ? new Date(row.criado_em).getTime() : Date.now();
    if (!rebuiltChats[key]) {
      rebuiltChats[key] = {
        participants: [sender, receiver].sort(),
        messages: [],
        unread: {},
        createdAt: ts,
        updatedAt: ts
      };
    }
    rebuiltChats[key].messages.push({
      id: 'msg_' + row.id,
      dbId: row.id,
      sender,
      receiver,
      text: row.texto || '',
      createdAt: ts
    });
    rebuiltChats[key].updatedAt = Math.max(rebuiltChats[key].updatedAt || 0, ts);
    if (!row.lida) {
      rebuiltChats[key].unread[receiver] = (rebuiltChats[key].unread[receiver] || 0) + 1;
    }
  });

  // Cria uma assinatura das mensagens e status de leitura para detectar se houve mudança real
  const buildSignature = (chatsObj) => Object.keys(chatsObj || {}).sort().map(k => {
    const c = chatsObj[k] || {};
    const msgs = Array.isArray(c.messages) ? c.messages.map(m => `${m.dbId || m.id}:${m.text}`).join('|') : '';
    const unread = JSON.stringify(c.unread || {});
    return `${k}#${msgs}#${unread}`;
  }).join(';;');

  const changed = buildSignature(existingChats) !== buildSignature(rebuiltChats);
  try { localStorage.setItem('safralink_chats', JSON.stringify(rebuiltChats)); } catch (_) {}
  return changed;
}

let isSyncingMessagesOnly = false;
async function syncChatMessagesOnly() {
  if (!supabaseClient || isSyncingMessagesOnly) return;
  isSyncingMessagesOnly = true;
  try {
    const { data, error } = await supabaseClient
      .from('mensagens')
      .select('*')
      .order('criado_em', { ascending: true });
    if (!error && Array.isArray(data)) {
      // Se existir mensagem de algum usuário ainda não presente em safralink_users, sincroniza usuários também
      const knownEmails = new Set(getUsers().map(u => String(u.email || '').toLowerCase().trim()));
      const hasUnknownUser = data.some(r => {
        const s = String(r.remetente_email || '').toLowerCase().trim();
        const d = String(r.destinatario_email || '').toLowerCase().trim();
        return (s && !knownEmails.has(s)) || (d && !knownEmails.has(d));
      });
      if (hasUnknownUser) {
        const usersRes = await supabaseClient.from('usuarios').select('*').order('id', { ascending: true });
        if (!usersRes.error && Array.isArray(usersRes.data)) {
          const mappedUsers = usersRes.data.map(fromDbUser);
          dbSnapshots.safralink_users = mappedUsers.map(u => ({ ...u }));
          try { localStorage.setItem('safralink_users', JSON.stringify(mappedUsers)); } catch (_) {}
        }
      }
      const changed = applyRemoteMessages(data);
      if (changed) {
        window.dispatchEvent(new CustomEvent('safralink:synced'));
      }
    }
  } catch (_) {
  } finally {
    isSyncingMessagesOnly = false;
  }
}
window.syncChatMessagesOnly = syncChatMessagesOnly;

if (supabaseClient) {
  try {
    supabaseClient
      .channel('safralink-mensagens-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mensagens' },
        () => { syncChatMessagesOnly(); }
      )
      .subscribe();
  } catch (_) {}

  setInterval(() => {
    if (document.visibilityState !== 'hidden') {
      syncChatMessagesOnly();
    }
  }, 2000);
}


/* =========================================================
   PRODUTOS DE EXEMPLO
   ========================================================= */

const demoProducts = [

  {
    id: 1,
    name: 'Tomate',
    type: 'Hortaliça',
    qty: '120 kg',
    price: 'R$ 6,50/kg',
    location: 'Itapetininga - SP',
    emoji: '🍅',
    seller: 'Sítio Boa Terra',
    sellerEmail: 'demo1@safralink.com'
  },

  {
    id: 2,
    name: 'Milho verde',
    type: 'Cereal',
    qty: '300 kg',
    price: 'R$ 4,20/kg',
    location: 'Tatuí - SP',
    emoji: '🌽',
    seller: 'Produtor João',
    sellerEmail: 'demo2@safralink.com'
  },

  {
    id: 3,
    name: 'Alface',
    type: 'Hortaliça',
    qty: '80 un.',
    price: 'R$ 2,50/un.',
    location: 'Itapetininga - SP',
    emoji: '🥬',
    seller: 'Horta da Ana',
    sellerEmail: 'demo3@safralink.com'
  },

  {
    id: 4,
    name: 'Abóbora',
    type: 'Legume',
    qty: '180 kg',
    price: 'R$ 3,80/kg',
    location: 'Capão Bonito - SP',
    emoji: '🎃',
    seller: 'Sítio Verde',
    sellerEmail: 'demo4@safralink.com'
  },

  {
    id: 5,
    name: 'Mandioca',
    type: 'Raiz',
    qty: '250 kg',
    price: 'R$ 3,20/kg',
    location: 'Itapetininga - SP',
    emoji: '🥔',
    seller: 'Família Souza',
    sellerEmail: 'demo5@safralink.com'
  },

  {
    id: 6,
    name: 'Morango',
    type: 'Fruta',
    qty: '60 kg',
    price: 'R$ 14,00/kg',
    location: 'São Miguel Arcanjo - SP',
    emoji: '🍓',
    seller: 'Chácara do Vale',
    sellerEmail: 'demo6@safralink.com'
  }

];


/* =========================================================
   USUÁRIO E CONTAS
   ========================================================= */


/*
   Recupera o usuário atualmente logado.
*/
function getUser() {
  try {
    const session = JSON.parse(localStorage.getItem('safralink_user') || 'null');
    if (!session) return null;
    const users = getUsers();
    const sessionEmail = String(session.email || '').trim().toLowerCase();
    const current = users.find(item => {
      const itemEmail = String(item.email || '').trim().toLowerCase();
      if (sessionEmail && itemEmail) {
        return itemEmail === sessionEmail;
      }
      return !sessionEmail && !itemEmail && item.id != null && session.id != null && String(item.id) === String(session.id);
    });
    if (!current) {
      const isSeller = isSellerUser(session);
      return {
        ...session,
        seller: isSeller,
        role: session.admin ? 'admin' : isSeller ? 'produtor rural' : 'comprador'
      };
    }
    const isSeller = isSellerUser(current) || isSellerUser(session);
    const merged = {
      ...session,
      ...current,
      seller: isSeller,
      role: (current.admin || session.admin) ? 'admin' : isSeller ? 'produtor rural' : 'comprador'
    };
    if (!merged.photoData) {
      merged.photoData = current.photoData || session.photoData || '';
    }
    return merged;
  } catch (error) { return null; }
}


/*
   Recupera as contas cadastradas.
*/
function getUsers() {

  try {

    if (hasRemoteSynced && Array.isArray(dbSnapshots.safralink_users) && dbSnapshots.safralink_users.length) {
      return dbSnapshots.safralink_users.map(u => ({ ...u }));
    }

    const saved =
      localStorage.getItem('safralink_users');

    if (saved) {
      const list = JSON.parse(saved);
      if (Array.isArray(list) && list.length) {
        if (Array.isArray(dbSnapshots.safralink_users) && dbSnapshots.safralink_users.length) {
          const byEmail = {};
          dbSnapshots.safralink_users.forEach(u => {
            byEmail[String(u.email || '').trim().toLowerCase()] = u;
          });
          return list.map(u => {
            const snap = byEmail[String(u.email || '').trim().toLowerCase()];
            return snap ? { ...u, ...snap, photoData: snap.photoData || u.photoData || '' } : u;
          });
        }
        return list;
      }
    }

    if (Array.isArray(dbSnapshots.safralink_users) && dbSnapshots.safralink_users.length) {
      return dbSnapshots.safralink_users.map(u => ({ ...u }));
    }

    return [];

  } catch (error) {

    return Array.isArray(dbSnapshots.safralink_users)
      ? dbSnapshots.safralink_users.map(u => ({ ...u }))
      : [];

  }

}


/*
   Salva as contas cadastradas.
   Mantém o cadastro persistido no navegador.
*/
function saveUsers(users) {

  const clean = Array.isArray(users) ? users : [];
  syncStorageKeyWithSupabase('safralink_users', clean);
  safeSetLocalStorage('safralink_users', clean);

}


/*
   Salva a sessão do comprador/vendedor.
*/
function saveUser(user) {

  if (user && typeof user === 'object') {
    const isSeller = isSellerUser(user);
    user.seller = isSeller;
    user.role = user.admin ? 'admin' : isSeller ? 'produtor rural' : 'comprador';
  }
  safeSetLocalStorage('safralink_user', user);
  if (supabaseClient && !isApplyingRemoteSync && user && user.email) {
    trackSupabaseOp(
      supabaseClient
        .from('usuarios')
        .upsert(toDbUser(user), { onConflict: 'email' })
        .select()
        .single()
    );
  }

}


/*
   Faz logout.

   Remove somente a sessão atual.
   A conta continua cadastrada.
*/
function logout() {

  localStorage.removeItem(
    'safralink_user'
  );
  location.href = 'index.html';

}


/*
   Cria as iniciais do nome.
*/
function initials(name = 'Usuário') {

  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();

}


/* =========================================================
   CONTROLE DE ACESSO
   ========================================================= */


/*
   Verifica se existe usuário logado.
*/
function requireUser() {

  if (!getUser()) {

    location.href = 'index.html';

    return false;

  }

  return true;

}


/*
   Verifica se o usuário é vendedor.
*/
function requireSeller() {

  const user = getUser();


  if (!user || !isSellerUser(user)) {

    location.href = 'inicio.html';

    return false;

  }


  return true;

}


/* =========================================================
   MENU / ÁREA DO USUÁRIO
   ========================================================= */

function setupShell() {

  const user = getUser();
  const isSeller = isSellerUser(user);


  /*
     Localiza a sidebar.
  */
  const sidebar =
    document.querySelector('.sidebar');


  /*
     Garante que todos os itens do menu (incluindo Sobras, Chat e Meu perfil)
     estejam sempre presentes na barra lateral em todas as páginas.
  */
  const nav = document.querySelector('.sidebar .nav');
  if (nav && user) {
    if (!nav.querySelector('a[href="sobras.html"]')) {
      const chatLink = nav.querySelector('a[href="chat.html"]');
      const sobrasHtml = `<a href="sobras.html" data-page="sobras" data-seller-only>
        <span class="nav-icon">♻</span>
        <span>Sobras</span>
      </a>`;
      if (chatLink) {
        chatLink.insertAdjacentHTML('beforebegin', sobrasHtml);
      } else {
        nav.insertAdjacentHTML('beforeend', sobrasHtml);
      }
    }
    if (!nav.querySelector('a[href="chat.html"]')) {
      const perfilLink = nav.querySelector('a[href="perfil.html"]');
      const chatHtml = `<a href="chat.html" data-page="chat">
        <span class="nav-icon chat-nav-icon">💬<span class="chat-notification-dot" aria-label="Nova mensagem" hidden></span></span>
        <span>Chat</span>
      </a>`;
      if (perfilLink) {
        perfilLink.insertAdjacentHTML('beforebegin', chatHtml);
      } else {
        nav.insertAdjacentHTML('beforeend', chatHtml);
      }
    }
    if (!nav.querySelector('a[href="perfil.html"]')) {
      nav.insertAdjacentHTML(
        'beforeend',
        `<a href="perfil.html" data-page="perfil">
          <span class="nav-icon">👤</span>
          <span>Meu perfil</span>
        </a>`
      );
    }
  }


  /*
     Se estivermos em uma página interna
     e houver usuário logado, garantimos
     que a área do usuário exista antes de preencher
     nome, função e foto/iniciais.
  */
  if (sidebar && user) {

    let userArea =
      sidebar.querySelector('.sidebar-bottom');


    /*
       Se a página não possuir essa área,
       criamos.
    */
    if (!userArea) {

      userArea =
        document.createElement('div');

      userArea.className =
        'sidebar-bottom';

      sidebar.appendChild(userArea);

    }


    /*
       Se não existir o usuário visualmente,
       criamos a área.
    */
    if (!userArea.querySelector('.user-mini')) {

      userArea.insertAdjacentHTML(
        'afterbegin',
        `

          <div class="user-mini">

            <div class="avatar ${user.photoData ? 'has-photo' : ''}" data-initials>${user.photoData ? `<img src="${user.photoData}" alt="Foto de perfil" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">` : initials(user.name || 'Usuário')}</div>

            <div>

              <b data-user-name>
                ${user.name || 'Usuário'}
              </b>

              <small data-user-role>
                ${
                  isSeller
                    ? 'Produtor rural'
                    : 'Comprador'
                }
              </small>

            </div>

          </div>

        `
      );

    } else {
      const miniAvatar = userArea.querySelector('.user-mini .avatar');
      if (miniAvatar && !miniAvatar.hasAttribute('data-initials')) {
        miniAvatar.setAttribute('data-initials', '');
      }
    }


    /*
       Garante que o botão "Sair" exista
       em TODAS as páginas.
    */
    if (!userArea.querySelector('[data-logout]')) {

      const logoutButton =
        document.createElement('button');

      logoutButton.type =
        'button';

      logoutButton.className =
        'btn btn-soft';

      logoutButton.dataset.logout =
        'true';

      logoutButton.style.cssText =
        'width:100%;margin-top:12px';

      logoutButton.textContent =
        'Sair';

      userArea.appendChild(
        logoutButton
      );

    }


    /*
       Ativa o logout.
    */
    userArea
      .querySelectorAll('[data-logout]')
      .forEach(button => {

        button.onclick =
          logout;

      });

  }


  /*
     Nome do usuário.
  */
  document
    .querySelectorAll('[data-user-name]')
    .forEach(element => {

      element.textContent =
        user?.name || 'Usuário';

    });


  /*
     Tipo da conta.
  */
  document
    .querySelectorAll('[data-user-role]')
    .forEach(element => {

      element.textContent =
        isSeller
          ? 'Produtor rural'
          : 'Comprador';

    });


  /*
     Foto de perfil ou iniciais do usuário.
  */
  document
    .querySelectorAll('[data-initials]')
    .forEach(element => {

      const pendingPhoto = element.dataset?.pending;
      const photo = pendingPhoto || user?.photoData || '';

      if (photo) {
        element.innerHTML =
          `<img src="${photo}" alt="Foto de perfil" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">`;
        element.classList.add('has-photo');
      } else {
        element.textContent =
          initials(user?.name || 'Usuário');
        element.classList.remove('has-photo');
      }

    });


  /*
     Mostra ou esconde funções exclusivas
     do vendedor.
  */
  document
    .querySelectorAll('[data-seller-only]')
    .forEach(element => {

      element.style.display =
        isSeller
          ? ''
          : 'none';

    });


  /*
     Mostra "Quero vender" somente
     para compradores.
  */
  document
    .querySelectorAll('[data-buyer-only]')
    .forEach(element => {

      element.style.display =
        isSeller
          ? 'none'
          : '';

    });


  /*
     Marca o item correto do menu como ativo.
  */
  const page =
    document.body.dataset.page;


  document
    .querySelectorAll('.nav a')
    .forEach(link => {
      const hrefPage = String(link.getAttribute('href') || '').replace(/\.html.*$/i, '');
      const linkPage = link.dataset.page || hrefPage;
      if (page && linkPage) {
        link.classList.toggle('active', linkPage === page);
      }
    });

}


/* =========================================================
   MENSAGEM TOAST
   ========================================================= */

function toast(message) {

  let element =
    document.querySelector('.toast');


  /*
     Se ainda não existir, criamos.
  */
  if (!element) {

    element =
      document.createElement('div');

    element.className =
      'toast';

    document.body.appendChild(
      element
    );

  }


  element.textContent =
    message;


  /*
     Estilo da mensagem.
  */
  element.style.cssText = `

    position: fixed;
    right: 25px;
    bottom: 25px;

    background: #21452d;
    color: #fff;

    padding: 13px 17px;

    border-radius: 12px;

    box-shadow:
      0 8px 25px rgba(0,0,0,.15);

    z-index: 99999;

    font-size: 13px;
    font-weight: 700;

  `;


  /*
     Remove depois de alguns segundos.
  */
  setTimeout(
    () => {

      if (element) {
        element.remove();
      }

    },
    2600
  );

}


/* =========================================================
   DATAS
   ========================================================= */


/*
   Converte:

   2026-08-30

   para:

   30/08/2026
*/
function formatDate(date) {

  if (!date) {
    return '';
  }


  /*
     Se já estiver no formato brasileiro,
     não mexemos.
  */
  if (
    /^\d{2}\/\d{2}\/\d{4}$/.test(
      String(date)
    )
  ) {

    return String(date);

  }


  /*
     Converte o formato do input type="date".
  */
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      String(date)
    )
  ) {

    const parts =
      String(date).split('-');

    return (
      `${parts[2]}/${parts[1]}/${parts[0]}`
    );

  }


  return String(date);

}


/*
   Transforma uma data em um número.

   É usado para ordenar:
   mais recente primeiro.
*/
function dateValue(date) {

  if (!date) {
    return 0;
  }


  /*
     AAAA-MM-DD
  */
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(
      String(date)
    )
  ) {

    return new Date(
      `${date}T00:00:00`
    ).getTime();

  }


  /*
     DD/MM/AAAA
  */
  if (
    /^\d{2}\/\d{2}\/\d{4}$/.test(
      String(date)
    )
  ) {

    const [
      day,
      month,
      year
    ] =
      String(date).split('/');


    return new Date(
      `${year}-${month}-${day}T00:00:00`
    ).getTime();

  }


  const value =
    new Date(date).getTime();


  return Number.isNaN(value)
    ? 0
    : value;

}


/* =========================================================
   FORMATAÇÃO DO PERÍODO DA COLHEITA
   ========================================================= */

function parseLocalDate(value) {

  if (!value) {
    return null;
  }

  const text =
    String(value).trim();

  /*
     Data de input type="date":
     AAAA-MM-DD
  */
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(text)
  ) {

    const [year, month, day] =
      text.split('-').map(Number);

    return new Date(
      year,
      month - 1,
      day
    );

  }

  /*
     Data brasileira:
     DD/MM/AAAA
  */
  if (
    /^\d{2}\/\d{2}\/\d{4}$/.test(text)
  ) {

    const [day, month, year] =
      text.split('/').map(Number);

    return new Date(
      year,
      month - 1,
      day
    );

  }

  const date =
    new Date(text);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;

}


function formatHarvestPeriod(start, end) {

  const startDate =
    parseLocalDate(start);

  const endDate =
    parseLocalDate(end);

  if (!startDate || !endDate) {
    return '';
  }

  const months = [
    'jan.',
    'fev.',
    'mar.',
    'abr.',
    'mai.',
    'jun.',
    'jul.',
    'ago.',
    'set.',
    'out.',
    'nov.',
    'dez.'
  ];

  const startDay =
    startDate.getDate();

  const endDay =
    endDate.getDate();

  const startMonth =
    months[startDate.getMonth()];

  const endMonth =
    months[endDate.getMonth()];

  if (
    startDate.getMonth() ===
      endDate.getMonth() &&
    startDate.getFullYear() ===
      endDate.getFullYear()
  ) {

    /*
       Espaço proposital antes e depois do hífen:
       15 - 30 ago.
    */
    return (
      `${startDay} - ${endDay} ${startMonth}`
    );

  }

  return (
    `${startDay} ${startMonth} - ` +
    `${String(endDay).padStart(2, '0')} ${endMonth}`
  );

}


/* =========================================================
   PRODUTOS
   ========================================================= */


/*
   Recupera produtos.
*/
function products() {

  try {

    if (hasRemoteSynced && Array.isArray(dbSnapshots.safralink_products)) {
      return dbSnapshots.safralink_products.map(p => ({ ...p }));
    }

    const saved =
      localStorage.getItem(
        'safralink_products'
      );


    /*
       Se houver produtos cadastrados,
       usamos eles.
    */
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) return parsed;
    }

    if (Array.isArray(dbSnapshots.safralink_products) && dbSnapshots.safralink_products.length) {
      return dbSnapshots.safralink_products.map(p => ({ ...p }));
    }

    /*
       Caso ainda não exista nenhum,
       mostramos os produtos de exemplo.
    */
    return demoProducts;

  } catch (error) {

    return Array.isArray(dbSnapshots.safralink_products) && dbSnapshots.safralink_products.length
      ? dbSnapshots.safralink_products.map(p => ({ ...p }))
      : demoProducts;

  }

}


/*
   Salva produtos.
*/
function saveProducts(list) {

  syncStorageKeyWithSupabase('safralink_products', list);
  safeSetLocalStorage('safralink_products', list);

}


/*
   Mostra:

   COMPRADOR
   → produtos de todos os vendedores.

   VENDEDOR
   → somente seus próprios produtos.
*/
function getVisibleProducts() {

  const user =
    getUser();

  const allProducts =
    products();


  /*
     Comprador vê tudo.
  */
  if (!user?.seller) {

    return allProducts;

  }


  /*
     Vendedor vê somente produtos
     associados ao seu e-mail.
  */
  return allProducts.filter(
    product =>
      product.sellerEmail &&
      product.sellerEmail === user.email
  );

}


/*
   Renderiza os produtos na tela.
*/
function escapeHtml(value = '') {

  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

}

function productSellerProfile(product) {

  const users = getUsers();

  const account = users.find(
    user =>
      String(user.email || '').toLowerCase() ===
      String(product.sellerEmail || '').toLowerCase()
  );

  const demo = {
    'demo1@safralink.com': {name:'Sítio Boa Terra', city:'Itapetininga - SP', production:'Hortaliças e produtos frescos'},
    'demo2@safralink.com': {name:'Produtor João', city:'Tatuí - SP', production:'Milho e cereais'},
    'demo3@safralink.com': {name:'Horta da Ana', city:'Itapetininga - SP', production:'Hortaliças'},
    'demo4@safralink.com': {name:'Sítio Verde', city:'Capão Bonito - SP', production:'Legumes'},
    'demo5@safralink.com': {name:'Família Souza', city:'Itapetininga - SP', production:'Raízes e hortaliças'},
    'demo6@safralink.com': {name:'Chácara do Vale', city:'São Miguel Arcanjo - SP', production:'Frutas'}
  };

  return {
    name: account?.farm || account?.name || product.seller || demo[product.sellerEmail]?.name || 'Produtor',
    contactName: account?.name || '',
    city: account?.city || product.location || demo[product.sellerEmail]?.city || '',
    production: account?.sellerProduction || account?.production || demo[product.sellerEmail]?.production || '',
    description: account?.sellerDescription || account?.description || '',
    phone: account?.phone || account?.whatsapp || '',
    email: account?.email || product.sellerEmail || ''
  };

}

function productReviews(product) {

  if (Array.isArray(product.reviews) && product.reviews.length) {
    return product.reviews;
  }

  const demo = {
    1:[{author:'Mariana',rating:5,text:'Produto muito fresco e bem selecionado.'}],
    2:[{author:'Carlos',rating:4,text:'Boa qualidade e entrega conforme combinado.'}],
    3:[{author:'Juliana',rating:5,text:'Alface fresca e muito bem embalada.'}],
    4:[{author:'Paulo',rating:5,text:'Ótima qualidade e bom atendimento.'}],
    5:[{author:'Renata',rating:4,text:'Produto de boa qualidade.'}],
    6:[{author:'Fernanda',rating:5,text:'Morango muito bonito e saboroso.'}]
  };

  return demo[product.id] || [];

}

function productRating(product) {

  const reviews = productReviews(product);
  if (!reviews.length) return {average:0,count:0};
  const average = reviews.reduce((sum, item) => sum + Number(item.rating || 0), 0) / reviews.length;
  return {average, count:reviews.length};

}

function stars(value) {

  const rounded = Math.round(Number(value) || 0);
  return '★★★★★'.split('').map((star, index) => index < rounded ? star : '☆').join('');

}

function openProductDetails(productId) {

  const modal = document.querySelector('#product-detail-modal');
  const content = document.querySelector('#product-detail-content');
  if (!modal || !content) return;

  const product = products().find(item => String(item.id) === String(productId));
  if (!product) return;

  const seller = productSellerProfile(product);
  const rating = productRating(product);
  const reviews = productReviews(product);
  const currentUser = getUser();
  const image = product.photoData
    ? `<img src="${product.photoData}" alt="${escapeHtml(product.name || 'Produto')}">`
    : `<span>${escapeHtml(product.emoji || '🌱')}</span>`;

  const productUnit = product.unit || '';
  const availableRaw = String(product.qty || '').trim();
  const availableMatch = availableRaw.match(/[0-9]+(?:[.,][0-9]+)?/);
  const availableNumber = availableMatch ? Number(availableMatch[0].replace(/\./g, '').replace(',', '.')) : null;
  const minimumRaw = String(product.minOrder || '').trim();
  const minimumMatch = minimumRaw.match(/[0-9]+(?:[.,][0-9]+)?/);
  const minimumNumber = minimumMatch ? Number(minimumMatch[0].replace(/\./g, '').replace(',', '.')) : null;

  content.innerHTML = `
    <div class="product-detail-grid">
      <div>
        <div class="product-detail-main-photo">${image}</div>
        <div class="product-detail-section">
          <h4>Sobre o produto</h4>
          <p>${escapeHtml(product.description || 'O vendedor ainda não adicionou uma descrição detalhada.')}</p>
          <div class="meta">
            <span>📦 Disponível: ${escapeHtml(product.qty || 'Não informado')}</span>
            <span>📍 ${escapeHtml(product.location || 'Não informado')}</span>
          </div>
          ${product.unit ? `<p><strong>Unidade:</strong> ${escapeHtml(product.unit)}</p>` : ''}
          ${product.minOrder ? `<p><strong>Pedido mínimo:</strong> ${escapeHtml(product.minOrder)}</p>` : ''}
        </div>
      </div>

      <div>
        <span class="tag">${escapeHtml(product.type || 'Produto')}</span>
        <h2 id="product-detail-title" class="product-detail-title">${escapeHtml(product.name || 'Produto')}</h2>
        <div class="product-detail-price">${escapeHtml(product.price || 'Preço a combinar')}</div>
        <div class="product-rating"><span class="product-stars">${stars(rating.average)}</span><strong>${rating.average ? rating.average.toFixed(1) : 'Novo'}</strong><span>${rating.count} avaliação(ões)</span></div>

        <div class="product-detail-section">
          <h4>Quem vende</h4>
          <div class="product-detail-seller">
            <div class="product-detail-avatar">${escapeHtml(initials(seller.name))}</div>
            <div>
              <strong>${escapeHtml(seller.name)}</strong>
              ${seller.city ? `<div class="hint">📍 ${escapeHtml(seller.city)}</div>` : ''}
              ${seller.production ? `<div class="hint">🌱 ${escapeHtml(seller.production)}</div>` : ''}
            </div>
          </div>
          ${seller.description ? `<p>${escapeHtml(seller.description)}</p>` : ''}
          ${seller.phone ? `<p><strong>Contato:</strong> ${escapeHtml(seller.phone)}</p>` : ''}
        </div>

        <div class="product-detail-section">
          <h4>Avaliações</h4>
          ${reviews.length ? reviews.map(review => `
            <div class="product-review">
              <strong>${escapeHtml(review.author || 'Usuário')} <span class="product-stars">${stars(review.rating)}</span></strong>
              <div>${escapeHtml(review.text || '')}</div>
            </div>`).join('') : '<p class="hint">Este produto ainda não recebeu avaliações.</p>'}
        </div>

        ${!currentUser?.seller ? `
        <div class="product-request-box">
          <div class="product-request-heading">
            <div>
              <span class="product-request-kicker">Seu pedido</span>
              <h4>Quanto você quer comprar?</h4>
              <p>Escolha a quantidade desejada. O estoque informado acima continua sendo a quantidade total disponível.</p>
            </div>
            <div class="product-request-stock">
              <span>Disponível</span>
              <strong>${escapeHtml(product.qty || '—')}</strong>
            </div>
          </div>
          <div class="product-request-grid">
            <div class="product-request-field">
              <label for="requested-quantity">Quantidade desejada</label>
              <div class="product-request-quantity">
                <button type="button" class="quantity-step" data-step="-1" aria-label="Diminuir quantidade">−</button>
                <input type="number" id="requested-quantity" min="${minimumNumber && minimumNumber > 0 ? minimumNumber : 0.01}" ${availableNumber !== null ? `max="${availableNumber}"` : ''} step="any" placeholder="0">
                <button type="button" class="quantity-step" data-step="1" aria-label="Aumentar quantidade">+</button>
                ${productUnit ? `<span>${escapeHtml(productUnit)}</span>` : ''}
              </div>
              <div class="product-request-hint">${product.minOrder ? `Mínimo: <strong>${escapeHtml(product.minOrder)}</strong>` : 'Informe a quantidade que deseja solicitar.'}</div>
            </div>
            <div class="product-request-field">
              <label>Meio de entrega</label>
              <div class="delivery-options">
                <button type="button" class="delivery-option selected" data-value="A combinar"><span>🤝</span><b>A combinar</b></button>
                <button type="button" class="delivery-option" data-value="Retirada no local"><span>📍</span><b>Retirada no local</b></button>
                <button type="button" class="delivery-option" data-value="Entrega pelo produtor"><span>🚜</span><b>Entrega pelo produtor</b></button>
                <button type="button" class="delivery-option" data-value="Transportadora"><span>🚚</span><b>Transportadora</b></button>
              </div>
              <input type="hidden" id="requested-delivery" value="A combinar">
            </div>
          </div>
          <div class="product-detail-actions">
            <button class="btn btn-primary detail-interest" data-id="${product.id}">Enviar pedido</button>
            <a class="btn btn-soft" href="chat.html">Falar com vendedor</a>
          </div>
        </div>` : ''}
      </div>
    </div>`;

  modal.hidden = false;
  document.body.style.overflow = 'hidden';

  const quantityInput = content.querySelector('#requested-quantity');
  content.querySelectorAll('.quantity-step').forEach(button => {
    button.onclick = () => {
      const step = Number(button.dataset.step || 0);
      const current = Number(quantityInput?.value || 0);
      const fallback = minimumNumber && minimumNumber > 0 ? minimumNumber : 1;
      const next = current > 0 ? current + step : fallback;
      if (quantityInput) quantityInput.value = String(Math.max(0, Number(next.toFixed(3))));
    };
  });
  content.querySelectorAll('.delivery-option').forEach(option => {
    option.onclick = () => {
      content.querySelectorAll('.delivery-option').forEach(item => item.classList.remove('selected'));
      option.classList.add('selected');
      const delivery = content.querySelector('#requested-delivery');
      if (delivery) delivery.value = option.dataset.value || 'A combinar';
    };
  });

  const interest = content.querySelector('.detail-interest');
  if (interest) {
    interest.onclick = () => {
      const quantityInput = content.querySelector('#requested-quantity');
      const deliveryInput = content.querySelector('#requested-delivery');
      const requested = Number(quantityInput?.value || 0);

      if (!requested || requested <= 0) {
        toast('Informe a quantidade que você deseja comprar.');
        quantityInput?.focus();
        return;
      }

      if (minimumNumber !== null && requested < minimumNumber) {
        toast(`A quantidade mínima para este produto é ${product.minOrder}.`);
        quantityInput?.focus();
        return;
      }

      if (availableNumber !== null && requested > availableNumber) {
        toast(`A quantidade disponível é ${product.qty}.`);
        quantityInput?.focus();
        return;
      }

      interest.disabled = true;
      const currentOrders = orders();
      const quantityText = `${requested.toLocaleString('pt-BR', {maximumFractionDigits: 3})}${productUnit ? ` ${productUnit}` : ''}`;
      currentOrders.unshift({
        id: Date.now(),
        productId: product.id,
        product: product.name,
        quantity: quantityText,
        quantityValue: requested,
        quantityUnit: productUnit,
        availableQuantity: product.qty,
        buyer: currentUser?.name || 'Comprador',
        buyerEmail: currentUser?.email || '',
        seller: product.seller || 'Produtor',
        sellerEmail: product.sellerEmail || '',
        date: new Date().toLocaleDateString('pt-BR'),
        status: 'Negociação',
        deliveryMethod: deliveryInput?.value || 'A combinar'
      });
      saveOrders(currentOrders);
      toast('Pedido registrado com a quantidade desejada!');
      setTimeout(() => closeProductDetails(), 350);
    };
  }

}

function closeProductDetails() {
  const modal = document.querySelector('#product-detail-modal');
  if (modal) modal.hidden = true;
  document.body.style.overflow = '';
}


function getProductInterests(){
  const user = getUser();
  if (!user || user.seller) return [];
  try {
    const list = JSON.parse(localStorage.getItem('safralink_product_interests') || '[]');
    return Array.isArray(list) ? list.filter(item =>
      String(item.buyerEmail || '').toLowerCase() === String(user.email || '').toLowerCase()
    ) : [];
  } catch (_) { return []; }
}

function renderInterestDrawer(){
  const listEl = document.querySelector('#interest-drawer-list');
  const countEl = document.querySelector('#interest-drawer-count');
  if (!listEl) return;
  const interests = getProductInterests();
  if (countEl) countEl.textContent = interests.length;

  if (!interests.length) {
    listEl.innerHTML = '<div class="interest-empty"><div>♡</div><strong>Nenhum interesse ainda</strong><span>Clique em “Tenho interesse” nos produtos que você quer acompanhar.</span></div>';
    return;
  }

  listEl.innerHTML = interests.map(item => `
    <article class="interest-item">
      <div class="interest-item-photo">
        ${item.photoData ? `<img src="${item.photoData}" alt="${escapeHtml(item.name)}">` : '<span>🌱</span>'}
      </div>
      <div class="interest-item-body">
        <strong>${escapeHtml(item.name)}</strong>
        <span>${escapeHtml(item.seller || 'Produtor')}</span>
        <b>${escapeHtml(item.price || 'Preço a combinar')}</b>
      </div>
      <button type="button" class="interest-remove" data-interest-id="${item.id}" aria-label="Remover interesse">×</button>
    </article>
  `).join('');

  listEl.querySelectorAll('.interest-remove').forEach(button => {
    button.onclick = () => {
      const id = String(button.dataset.interestId);
      let all = [];
      try { all = JSON.parse(localStorage.getItem('safralink_product_interests') || '[]'); } catch (_) { all = []; }
      all = Array.isArray(all) ? all.filter(item => String(item.id) !== id) : [];
      safeSetLocalStorage('safralink_product_interests', JSON.stringify(all));
      syncStorageKeyWithSupabase('safralink_product_interests', all);
      renderInterestDrawer();
      toast('Interesse removido.');
    };
  });
}

function openInterestDrawer(){
  const drawer = document.querySelector('#interest-drawer');
  if (!drawer) return;
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
}

function closeInterestDrawer(){
  const drawer = document.querySelector('#interest-drawer');
  if (!drawer) return;
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
}

function renderProducts(
  list = getVisibleProducts(),
  target = '#product-list'
) {

  const container =
    document.querySelector(target);


  if (!container) {
    return;
  }


  const user =
    getUser();


  /*
     Nenhum produto encontrado.
  */
  if (!list.length) {

    container.innerHTML = `

      <div class="card">

        <p class="hint">

          ${
            user?.seller
              ? 'Você ainda não possui produtos cadastrados.'
              : 'Nenhum produto encontrado.'
          }

        </p>

      </div>

    `;

    return;

  }


  /*
     Cria os cards.
  */
  container.innerHTML =
    list.map(product => {

      const isOwner =
        user?.seller &&
        product.sellerEmail ===
          user.email;


      return `

        <article class="card product-card">


          <div class="product-photo ${product.photoData ? 'has-image' : ''}">

            ${product.photoData
              ? `<img src="${product.photoData}" alt="${product.name || 'Produto'}">`
              : (product.emoji || '🌱')}

          </div>


          <div class="product-body">


            <div class="tag">

              ${product.type}

            </div>


            <h3>

              ${product.name}

            </h3>


            <div class="meta">


              <span>

                📦 ${product.qty}

              </span>


              <span>

                📍 ${product.location}

              </span>


            </div>


            <div class="price">

              ${product.price}

            </div>


            <p
              class="hint"
              style="margin:7px 0 14px"
            >

              Por ${
                product.seller ||
                'Produtor'
              }

            </p>


            <div class="product-actions">

              <button
                class="btn btn-outline product-details"
                data-id="${product.id}"
              >
                Ver detalhes
              </button>


              ${
                !user?.seller
                  ? `

                    <button
                      class="btn btn-soft interest"
                      data-id="${product.id}"
                    >

                      Tenho interesse

                    </button>

                  `
                  : ''
              }


              ${
                isOwner
                  ? `

                    <a
                      class="btn btn-soft"
                      href="cadastro-produto.html?id=${product.id}"
                    >

                      Editar

                    </a>


                    <button
                      class="btn btn-danger delete-product"
                      data-id="${product.id}"
                    >

                      Excluir

                    </button>

                  `
                  : ''
              }


            </div>


          </div>


        </article>

      `;

    }).join('');


  /*
     Botão "Ver detalhes".
  */
  container
    .querySelectorAll('.product-details')
    .forEach(button => {
      button.onclick = () => openProductDetails(button.dataset.id);
    });


  /*
     Botão "Tenho interesse".
     Interesse é apenas uma lista particular do comprador;
     não cria pedido e não abre os detalhes.
  */
  container
    .querySelectorAll('.interest')
    .forEach(button => {
      button.onclick = () => {
        const product = products().find(item => String(item.id) === String(button.dataset.id));
        const user = getUser();
        if (!product || !user || user.seller) return;

        const key = 'safralink_product_interests';
        let list = [];
        try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (_) { list = []; }
        if (!Array.isArray(list)) list = [];

        const already = list.some(item =>
          String(item.productId) === String(product.id) &&
          String(item.buyerEmail || '').toLowerCase() === String(user.email || '').toLowerCase()
        );

        if (already) {
          toast('Este produto já está na sua lista de interesses.');
          openInterestDrawer();
          return;
        }

        list.unshift({
          id: Date.now(),
          productId: product.id,
          buyerEmail: user.email || '',
          name: product.name || 'Produto',
          type: product.type || 'Produto',
          price: product.price || '',
          qty: product.qty || '',
          unit: product.unit || '',
          seller: product.seller || 'Produtor',
          sellerEmail: product.sellerEmail || '',
          location: product.location || '',
          photoData: product.photoData || '',
          createdAt: new Date().toISOString()
        });
        safeSetLocalStorage(key, JSON.stringify(list));
        syncStorageKeyWithSupabase(key, list);
        renderInterestDrawer();
        toast('Produto adicionado à sua lista de interesses.');
      };
    });

  renderInterestDrawer();

  /*
     Botões de exclusão.
  */
  container
    .querySelectorAll('.delete-product')
    .forEach(button => {

      button.onclick = () => {

        const currentUser =
          getUser();


        const product =
          products().find(
            item =>
              String(item.id) ===
              String(button.dataset.id)
          );


        /*
           Segurança:
           vendedor só pode apagar
           seu próprio produto.
        */
        if (
          !currentUser?.seller ||
          !product ||
          product.sellerEmail !==
            currentUser.email
        ) {

          toast(
            'Você só pode excluir seus próprios produtos.'
          );

          return;

        }


        if (
          !confirm(
            `Excluir o produto "${product.name}"?`
          )
        ) {

          return;

        }


        const updated =
          products().filter(
            item =>
              String(item.id) !==
              String(product.id)
          );


        saveProducts(
          updated
        );


        renderProducts(
          getVisibleProducts(),
          target
        );


        toast(
          'Produto excluído com sucesso!'
        );

      };

    });

}


/* =========================================================
   PEDIDOS
   ========================================================= */

function orders() {

  try {

    if (hasRemoteSynced && Array.isArray(dbSnapshots.safralink_orders)) {
      return dbSnapshots.safralink_orders.map(o => ({ ...o }));
    }

    const parsed = JSON.parse(
      localStorage.getItem(
        'safralink_orders'
      ) || '[]'
    );
    return Array.isArray(parsed) ? parsed : [];

  } catch (error) {

    return Array.isArray(dbSnapshots.safralink_orders)
      ? dbSnapshots.safralink_orders.map(o => ({ ...o }))
      : [];

  }

}


/*
   Salva pedidos.
*/
function saveOrders(items) {

  syncStorageKeyWithSupabase('safralink_orders', items);
  safeSetLocalStorage('safralink_orders', items);

}


/*
   Exibe pedidos do vendedor.
*/
function renderOrders() {

  const list = document.querySelector('#orders-list');
  if (!list) return;

  const user = getUser();
  if (!user) return;

  list.innerHTML = '';

  const isSeller = !!user.seller;
  const visibleOrders = orders().filter(order =>
    isSeller
      ? order.sellerEmail && order.sellerEmail === user.email
      : order.buyerEmail && order.buyerEmail === user.email
  );

  if (!visibleOrders.length) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="6" class="hint" style="text-align:center;padding:28px">${isSeller ? 'Nenhum pedido recebido ainda.' : 'Você ainda não fez nenhum pedido.'}</td>`;
    list.appendChild(row);
    return;
  }

  visibleOrders.forEach(order => {
    const row = document.createElement('tr');
    const status = order.status || 'Negociação';
    const statusClass = status === 'Confirmado' ? 'green' : status === 'Finalizado' ? 'gray' : 'yellow';

    if (isSeller) {
      row.innerHTML = `
        <td><b>${escapeHtml(order.product || 'Pedido')}</b><br><span class="hint">Pedido #SL${String(order.id).slice(-4)}</span></td>
        <td>${escapeHtml(order.quantity || '-')}</td>
        <td>${escapeHtml(order.buyer || '-')} → ${escapeHtml(order.seller || '-')}</td>
        <td>${escapeHtml(order.date || '-')}</td>
        <td><span class="status ${statusClass}">${escapeHtml(status)}</span></td>
        <td><a class="btn btn-soft" href="pedido-detalhes.html?id=${encodeURIComponent(order.id)}">Ver detalhes</a></td>`;
    } else {
      row.innerHTML = `
        <td><b>${escapeHtml(order.product || 'Pedido')}</b><br><span class="hint">Pedido #SL${String(order.id).slice(-4)}</span></td>
        <td>${escapeHtml(order.quantity || '-')}</td>
        <td>${escapeHtml(order.buyer || '-')} → ${escapeHtml(order.seller || '-')}</td>
        <td>${escapeHtml(order.date || '-')}</td>
        <td><span class="status ${statusClass}">${escapeHtml(status)}</span></td>
        <td><button type="button" class="btn btn-soft edit-order" data-id="${escapeHtml(order.id)}">Editar pedido</button></td>`;
    }
    list.appendChild(row);
  });

  if (!isSeller) {
    list.querySelectorAll('.edit-order').forEach(button => {
      button.onclick = () => openOrderEdit(button.dataset.id);
    });
  }
}

function openOrderEdit(orderId) {
  const user = getUser();
  const order = orders().find(item => String(item.id) === String(orderId) && item.buyerEmail === user?.email);
  if (!order) return;

  const quantityValue = Number(order.quantityValue || String(order.quantity || '').match(/[0-9]+(?:[.,][0-9]+)?/)?.[0]?.replace(',', '.') || 0);
  const currentDelivery = order.deliveryMethod || 'A combinar';
  const modal = document.createElement('div');
  modal.className = 'order-edit-modal';
  modal.innerHTML = `
    <div class="order-edit-backdrop"></div>
    <div class="order-edit-dialog" role="dialog" aria-modal="true" aria-label="Editar pedido">
      <button type="button" class="order-edit-close" aria-label="Fechar">×</button>
      <span class="product-request-kicker">Editar pedido</span>
      <h2>${escapeHtml(order.product || 'Pedido')}</h2>
      <p class="hint">Altere somente o que você precisa e salve novamente.</p>
      <label class="order-edit-label">Quantidade desejada</label>
      <div class="product-request-quantity order-edit-quantity">
        <button type="button" class="quantity-step edit-step" data-step="-1">−</button>
        <input type="number" id="edit-order-quantity" min="0.01" step="any" value="${escapeHtml(quantityValue)}">
        <button type="button" class="quantity-step edit-step" data-step="1">+</button>
        <span>${escapeHtml(order.quantityUnit || '')}</span>
      </div>
      <label class="order-edit-label">Meio de entrega</label>
      <div class="delivery-options edit-delivery-options">
        ${['A combinar','Retirada no local','Entrega pelo produtor','Transportadora'].map(value => `<button type="button" class="delivery-option ${currentDelivery === value ? 'selected' : ''}" data-value="${escapeHtml(value)}"><b>${escapeHtml(value)}</b></button>`).join('')}
      </div>
      <input type="hidden" id="edit-order-delivery" value="${escapeHtml(currentDelivery)}">
      <div class="order-edit-actions"><button type="button" class="btn btn-soft order-edit-cancel">Cancelar</button><button type="button" class="btn btn-primary order-edit-save">Salvar alterações</button></div>
    </div>`;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';

  const close = () => { modal.remove(); document.body.style.overflow = ''; };
  modal.querySelector('.order-edit-close').onclick = close;
  modal.querySelector('.order-edit-cancel').onclick = close;
  modal.querySelector('.order-edit-backdrop').onclick = close;

  const input = modal.querySelector('#edit-order-quantity');
  modal.querySelectorAll('.edit-step').forEach(button => button.onclick = () => {
    const current = Number(input.value || 0);
    input.value = String(Math.max(0.01, Number((current + Number(button.dataset.step || 0)).toFixed(3))));
  });
  modal.querySelectorAll('.delivery-option').forEach(option => option.onclick = () => {
    modal.querySelectorAll('.delivery-option').forEach(item => item.classList.remove('selected'));
    option.classList.add('selected');
    modal.querySelector('#edit-order-delivery').value = option.dataset.value;
  });

  modal.querySelector('.order-edit-save').onclick = () => {
    const requested = Number(input.value || 0);
    if (!requested || requested <= 0) { toast('Informe uma quantidade válida.'); return; }
    const all = orders();
    const index = all.findIndex(item => String(item.id) === String(order.id) && item.buyerEmail === user.email);
    if (index < 0) return;
    const unit = all[index].quantityUnit || '';
    all[index].quantityValue = requested;
    all[index].quantity = `${requested.toLocaleString('pt-BR', {maximumFractionDigits: 3})}${unit ? ` ${unit}` : ''}`;
    all[index].deliveryMethod = modal.querySelector('#edit-order-delivery').value || 'A combinar';
    saveOrders(all);
    close();
    renderOrders();
    toast('Pedido atualizado com sucesso!');
  };
}


/* =========================================================
   COLHEITAS
   ========================================================= */


/*
   Recupera previsões.
*/
function harvests() {

  try {

    if (hasRemoteSynced && Array.isArray(dbSnapshots.safralink_harvests)) {
      return dbSnapshots.safralink_harvests.map(h => ({ ...h }));
    }

    const parsed = JSON.parse(
      localStorage.getItem(
        'safralink_harvests'
      ) || '[]'
    );
    return Array.isArray(parsed) ? parsed : [];

  } catch (error) {

    return Array.isArray(dbSnapshots.safralink_harvests)
      ? dbSnapshots.safralink_harvests.map(h => ({ ...h }))
      : [];

  }

}


/*
   Salva previsões.
*/
function saveHarvests(items) {

  syncStorageKeyWithSupabase('safralink_harvests', items);
  safeSetLocalStorage('safralink_harvests', items);

}


/*
   Define quais previsões aparecem.

   Comprador:
   → todas.

   Vendedor:
   → somente as próprias.
*/
function getVisibleHarvests() {

  const user =
    getUser();

  const all =
    harvests();

  /*
     Vendedor:
     somente previsões pertencentes à conta.
  */
  if (user?.seller) {

    return all.filter(
      item =>
        item.sellerEmail ===
        user.email
    );

  }

  /*
     Comprador:
     todas as previsões cadastradas.
  */
  return all;

}


/*
   Exibe previsões.
*/
function renderHarvests(
  list = getVisibleHarvests()
) {

  const table =
    document.querySelector(
      '#harvest-list'
    );

  if (!table) {
    return;
  }

  const user =
    getUser();

  /*
     Exemplos são fixos do sistema.
     Eles pertencem à vitrine do comprador e
     NÃO pertencem a nenhum vendedor logado.
  */
  const examples =
    table.querySelectorAll(
      '[data-example-harvest]'
    );

  const hasDatabaseHarvests =
    !!supabaseClient &&
    harvests().length > 0;

  examples.forEach(row => {

    row.style.display =
      user?.seller || hasDatabaseHarvests
        ? 'none'
        : '';

  });

  /*
     Remove somente as linhas dinâmicas.
     Os exemplos permanecem na tela do comprador.
  */
  table
    .querySelectorAll(
      '[data-dynamic-harvest]'
    )
    .forEach(
      row => row.remove()
    );

  const filteredList =
    Array.isArray(list)
      ? list
      : [];

  filteredList.forEach(item => {

    const row =
      document.createElement('tr');

    row.dataset.dynamicHarvest =
      'true';

    row.innerHTML = `

      <td>
        🌱 ${item.product || ''}
      </td>

      <td>
        ${item.seller || ''}
      </td>

      <td>
        ${item.quantity || ''}
      </td>

      <td>
        ${formatHarvestPeriod(
          item.start,
          item.end
        )}
      </td>

      <td>

        <span class="status ${
          item.status === 'Concluída'
            ? 'green'
            : item.status === 'Cancelada'
              ? 'red'
              : item.status === 'Em andamento'
                ? 'yellow'
                : 'green'
        }">

          ${item.status || 'Prevista'}

        </span>

      </td>

      ${
        user?.seller
          ? `

            <td>

              <button
                class="btn btn-soft edit-harvest"
                data-id="${item.id}"
                type="button"
              >
                Editar
              </button>

              <button
                class="btn btn-danger delete-harvest"
                data-id="${item.id}"
                type="button"
              >
                Excluir
              </button>

            </td>

          `
          : ''
      }

    `;

    table.appendChild(row);

  });

  /*
     Se o vendedor não tiver nenhuma previsão própria,
     mostra a mensagem sem apagar os exemplos do comprador.
  */
  if (
    user?.seller &&
    !filteredList.length
  ) {

    const row =
      document.createElement('tr');

    row.dataset.dynamicHarvest =
      'true';

    row.innerHTML = `
      <td
        colspan="6"
        class="hint"
      >
        Nenhuma previsão encontrada.
      </td>
    `;

    table.appendChild(row);

  }

  /*
     Botões de edição.
  */
  table
    .querySelectorAll('.edit-harvest')
    .forEach(button => {

      button.onclick = () => {

        const item =
          harvests().find(
            harvest =>
              String(harvest.id) ===
              String(button.dataset.id)
          );

        if (!item) {
          return;
        }

        const currentUser =
          getUser();

        if (
          !currentUser?.seller ||
          item.sellerEmail !==
            currentUser.email
        ) {

          toast(
            'Você só pode editar suas próprias previsões.'
          );

          return;

        }

        const form =
          document.querySelector(
            '#harvest-form'
          );

        if (!form) {
          return;
        }

        /*
           IMPORTANTE:
           inclui o SELECT do status.
           Antes o select era ignorado e os índices
           ficavam deslocados.
        */
        const fields =
          form.querySelectorAll(
            'input, select, textarea'
          );

        fields[0].value =
          item.product || '';

        fields[1].value =
          item.quantity || '';

        fields[2].value =
          item.start || '';

        fields[3].value =
          item.end || '';

        fields[4].value =
          item.status || 'Prevista';

        fields[5].value =
          item.notes || '';

        /*
           Guarda o ID real do registro.
           Ao salvar, ele será substituído, não duplicado.
        */
        form.dataset.editingId =
          String(item.id);

        form.scrollIntoView({
          behavior: 'smooth'
        });

        const submit =
          form.querySelector(
            'button[type="submit"]'
          );

        if (submit) {

          submit.textContent =
            'Salvar alterações';

        }

      };

    });

  /*
     Botões de exclusão.
  */
  table
    .querySelectorAll('.delete-harvest')
    .forEach(button => {

      button.onclick = () => {

        const currentUser =
          getUser();

        const item =
          harvests().find(
            harvest =>
              String(harvest.id) ===
              String(button.dataset.id)
          );

        if (
          !currentUser?.seller ||
          !item ||
          item.sellerEmail !==
            currentUser.email
        ) {

          toast(
            'Você só pode excluir suas próprias previsões.'
          );

          return;

        }

        if (
          !confirm(
            'Excluir esta previsão de colheita?'
          )
        ) {
          return;
        }

        const updated =
          harvests().filter(
            harvest =>
              String(harvest.id) !==
              String(item.id)
          );

        saveHarvests(
          updated
        );

        renderHarvests(
          getVisibleHarvests()
        );

        toast(
          'Previsão excluída com sucesso!'
        );

      };

    });

}


/* =========================================================
   TRANSPORTES
   ========================================================= */


/*
   Recupera transportes.
*/
function transports() {

  try {

    if (hasRemoteSynced && Array.isArray(dbSnapshots.safralink_transports)) {
      return dbSnapshots.safralink_transports.map(t => ({ ...t }));
    }

    const parsed = JSON.parse(
      localStorage.getItem(
        'safralink_transports'
      ) || '[]'
    );
    return Array.isArray(parsed) ? parsed : [];

  } catch (error) {

    return Array.isArray(dbSnapshots.safralink_transports)
      ? dbSnapshots.safralink_transports.map(t => ({ ...t }))
      : [];

  }

}


/*
   Salva transportes.
*/
function saveTransports(items) {

  syncStorageKeyWithSupabase('safralink_transports', items);
  safeSetLocalStorage('safralink_transports', items);

}


/*
   Exibe transportes do vendedor.
*/
function renderTransports() {
  const list = document.querySelector('#transport-list');
  if (!list) return;
  const user = getUser();
  list.innerHTML = '';
  const visible = transports().filter(item => !item.sellerEmail || item.sellerEmail === user?.email);
  if (!visible.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="6">Nenhum transporte cadastrado.</td>';
    list.appendChild(row);
    return;
  }
  visible.forEach(item => {
    const row = document.createElement('tr');
    const transportStatusClass = item.status === 'Agendado' ? 'green' : item.status === 'A caminho' ? 'red' : item.status === 'Entregue' ? 'gray' : 'yellow';
    row.innerHTML = `<td>${item.plate || item.order || '-'}</td><td>${item.origin || '-'}</td><td>${item.destination || '-'}</td><td>${item.quantity || '-'}</td><td><span class="status ${transportStatusClass}">${item.status || 'Solicitado'}</span></td><td><button class="btn btn-soft edit-transport" type="button" data-id="${item.id}">Editar</button></td>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.edit-transport').forEach(button => {
    button.addEventListener('click', () => {
      const item = transports().find(t => String(t.id) === String(button.dataset.id));
      if (!item || !user?.seller || (item.sellerEmail && item.sellerEmail !== user.email)) { toast('Você só pode editar seus próprios transportes.'); return; }
      const form = document.querySelector('#transport-form');
      const fields = form?.querySelectorAll('input, select');
      if (!form || !fields || fields.length < 6) return;
      fields[0].value=item.plate||''; fields[1].value=item.product||''; fields[2].value=item.origin||''; fields[3].value=item.destination||''; fields[4].value=item.quantity||''; fields[5].value=item.status||'Solicitado';
      form.dataset.editingId=item.id;
      const submit=document.querySelector('#transport-submit'), cancel=document.querySelector('#transport-cancel-edit');
      if(submit) submit.textContent='Salvar alterações'; if(cancel) cancel.hidden=false;
      form.scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
}



/* =========================================================
   SOBRAS
   ========================================================= */


/*
   Recupera sobras.
*/
function leftovers() {

  const user =
    getUser();

  /*
     Cada conta possui suas próprias sobras.
     Uma conta nova começa com uma lista vazia.
  */
  if (!user?.email) {
    return [];
  }

  const myEmail = String(user.email || '').trim().toLowerCase();

  try {

    let all = [];
    if (hasRemoteSynced && Array.isArray(dbSnapshots.safralink_leftovers)) {
      all = dbSnapshots.safralink_leftovers.map(l => ({ ...l }));
    } else {
      all = JSON.parse(localStorage.getItem('safralink_leftovers') || '[]');
      if ((!Array.isArray(all) || !all.length) && Array.isArray(dbSnapshots.safralink_leftovers)) {
        all = dbSnapshots.safralink_leftovers.map(l => ({ ...l }));
      }
    }

    return (Array.isArray(all) ? all : []).filter(
      item =>
        String(item.sellerEmail || '').trim().toLowerCase() === myEmail
    );

  } catch (error) {

    return Array.isArray(dbSnapshots.safralink_leftovers)
      ? dbSnapshots.safralink_leftovers.filter(
          item => String(item.sellerEmail || '').trim().toLowerCase() === myEmail
        )
      : [];

  }

}


/*
   Salva somente as sobras do usuário atual.
*/
function saveLeftovers(items) {

  const user =
    getUser();

  if (!user?.email) {
    return;
  }

  const myEmail = String(user.email || '').trim().toLowerCase();
  let all = [];

  try {

    if (hasRemoteSynced && Array.isArray(dbSnapshots.safralink_leftovers)) {
      all = dbSnapshots.safralink_leftovers.map(l => ({ ...l }));
    } else {
      all = JSON.parse(localStorage.getItem('safralink_leftovers') || '[]');
      if (!Array.isArray(all)) all = [];
    }

  } catch (error) {

    all = [];

  }

  /*
     Preserva as sobras de outras contas.
  */
  all =
    all.filter(
      item =>
        String(item.sellerEmail || '').trim().toLowerCase() !== myEmail
    );

  /*
     Salva as sobras da conta atual.
  */
  all.push(
    ...items.map(item => ({
      ...item,
      sellerEmail: myEmail
    }))
  );

  syncStorageKeyWithSupabase('safralink_leftovers', all);
  safeSetLocalStorage('safralink_leftovers', all);

}


/*
   Converte:

   "15 kg" → 15
   "7,5 kg" → 7.5
*/
function quantityNumber(value) {

  if (
    typeof value ===
    'number'
  ) {

    return value;

  }


  const match =
    String(value || '')
      .replace(',', '.')
      .match(
        /-?\d+(?:\.\d+)?/
      );


  return match
    ? Number(match[0])
    : 0;

}


/*
   Formata números para português.
*/
function formatQuantity(value) {

  if (
    Number.isInteger(value)
  ) {

    return String(value);

  }


  return value
    .toFixed(2)
    .replace(
      /0+$/,
      ''
    )
    .replace(
      /\.$/,
      ''
    )
    .replace(
      '.',
      ','
    );

}


/*
   Atualiza os três cards:

   - Total de sobras
   - Doações
   - Descartes
*/
function updateLeftoverStats(items) {

  const total =
    items.reduce(
      (sum, item) =>
        sum +
        quantityNumber(
          item.quantity
        ),
      0
    );


  const donations =
    items
      .filter(
        item =>
          item.destination ===
          'Doação'
      )
      .reduce(
        (sum, item) =>
          sum +
          quantityNumber(
            item.quantity
          ),
        0
      );


  const disposals =
    items
      .filter(
        item =>
          item.destination ===
          'Descarte'
      )
      .reduce(
        (sum, item) =>
          sum +
          quantityNumber(
            item.quantity
          ),
        0
      );


  /*
     Localiza os três números
     dos cards.
  */
  const cards =
    document.querySelectorAll(
      '.stat-card .stat-number'
    );


  if (cards[0]) {

    cards[0].textContent =
      `${formatQuantity(total)} kg`;

  }


  if (cards[1]) {

    cards[1].textContent =
      `${formatQuantity(donations)} kg`;

  }


  if (cards[2]) {

    cards[2].textContent =
      `${formatQuantity(disposals)} kg`;

  }

}


/*
   Exibe as sobras.

   IMPORTANTE:
   a ordenação é feita pela DATA,
   e não pela ordem de cadastro.
*/
function renderLeftovers() {

  const list =
    document.querySelector(
      '#leftover-list'
    );

  if (!list) {
    return;
  }

  /*
     Limpa toda a tabela antes de renderizar.
     Isso remove também as três linhas de exemplo
     que estavam escritas diretamente no HTML.
  */
  list.innerHTML = '';

  /*
     Recupera somente as sobras da conta logada.
  */
  const items =
    leftovers().slice();

  /*
     Mais recente primeiro.
  */
  items.sort(
    (a, b) =>
      dateValue(b.date) -
      dateValue(a.date)
  );

  items.forEach(item => {

    const row =
      document.createElement('tr');

    row.dataset.dynamicLeftover =
      'true';

    let statusClass =
      'gray';

    if (
      item.destination ===
      'Doação'
    ) {
      statusClass =
        'green';
    }

    if (
      item.destination ===
      'Descarte'
    ) {
      statusClass =
        'red';
    }

    row.innerHTML = `

      <td>
        ${item.product}
      </td>

      <td>
        ${item.quantity}
      </td>

      <td>

        <span
          class="status ${statusClass}"
        >

          ${item.destination}

        </span>

      </td>

      <td>
        ${formatDate(item.date)}
      </td>

    `;

    list.appendChild(
      row
    );

  });

  /*
     Atualiza os três cards usando somente
     os registros reais da conta.
  */
  updateLeftoverStats(
    items
  );

}


/* =========================================================
   REMOÇÃO DO PRODUTO DE TESTE
   ========================================================= */


/*
   Produto mostrado na imagem enviada:

   Tipo:
   Hortaliça

   Produto:
   e

   Quantidade:
   1

   Localização:
   a

   Produtor:
   d

   A função abaixo remove SOMENTE esse registro.
*/
function removeTestProduct() {

  const saved =
    localStorage.getItem(
      'safralink_products'
    );


  /*
     Se não existir uma lista salva,
     não fazemos nada.
  */
  if (!saved) {
    return;
  }


  try {

    const list =
      JSON.parse(saved);


    const filtered =
      list.filter(product => {

        const isTestProduct =

          String(
            product.name || ''
          )
            .trim()
            .toLowerCase() === 'e'


          &&

          String(
            product.type || ''
          )
            .trim()
            .toLowerCase() ===
            'hortaliça'


          &&

          String(
            product.qty || ''
          )
            .trim() === '1'


          &&

          String(
            product.location || ''
          )
            .trim()
            .toLowerCase() === 'a'


          &&

          String(
            product.seller || ''
          )
            .trim()
            .toLowerCase() === 'd';


        /*
           Se for exatamente o produto
           de teste, removemos.
        */
        return !isTestProduct;

      });


    /*
       Só salva novamente se alguma coisa
       realmente tiver sido removida.
    */
    if (
      filtered.length !==
      list.length
    ) {

      saveProducts(
        filtered
      );

    }

  } catch (error) {

    /*
       Se houver algum problema nos dados,
       não interrompemos o site.
    */

  }

}


/* =========================================================
   LIMPEZA DOS PEDIDOS ANTIGOS DE TESTE
   ========================================================= */

/*
   Remove os pedidos antigos criados durante os testes.
   A chave V3 garante que esta limpeza aconteça uma vez
   nesta versão do projeto.
*/
function clearOldTestOrdersV3() {

  const cleanupKey =
    'safralink_orders_cleaned_v3';

  if (
    localStorage.getItem(cleanupKey) ===
    'true'
  ) {
    return;
  }

  localStorage.removeItem(
    'safralink_orders'
  );

  localStorage.setItem(
    cleanupKey,
    'true'
  );

}

/* Limpa todos os pedidos existentes uma única vez para iniciar os testes sem dados antigos. */
function clearAllOrdersOnceV4() {
  const cleanupKey = 'safralink_orders_cleaned_v4';
  if (localStorage.getItem(cleanupKey) === 'true') return;
  localStorage.removeItem('safralink_orders');
  localStorage.setItem(cleanupKey, 'true');
}


/* =========================================================
   TELA INICIAL
   ========================================================= */

function renderInicioDashboard() {

  const user =
    getUser();

  const isSeller =
    !!user?.seller;

  const allProducts =
    products();

  const visibleProducts =
    isSeller
      ? allProducts.filter(
          product =>
            product.sellerEmail ===
            user.email
        )
      : allProducts;

  const visibleHarvests =
    getVisibleHarvests();

  const visibleOrders =
    isSeller
      ? orders().filter(
          item =>
            item.sellerEmail ===
            user.email
        )
      : [];

  /*
     Vendedor não precisa do banner
     "Encontre produtos da região".
  */
  const hero =
    document.querySelector(
      '.hero'
    );

  if (
    hero &&
    isSeller
  ) {

    hero.style.display =
      'none';

  }

  /*
     Cards da tela inicial.
  */
  const statCards =
    document.querySelectorAll(
      '.grid-4 .stat-card'
    );

  /*
     Produtos.
  */
  if (statCards[0]) {

    const number =
      statCards[0].querySelector(
        '.stat-number'
      );

    if (number) {

      number.textContent =
        visibleProducts.length;

    }

  }

  /*
     Colheitas.

     Tanto comprador quanto vendedor recebem
     a quantidade correspondente à sua visão.
  */
  if (statCards[1]) {

    const number =
      statCards[1].querySelector(
        '.stat-number'
      );

    if (number) {

      /*
         Existem 3 previsões de exemplo do sistema.
         Elas aparecem para compradores mesmo quando
         a tela inicial não está na página de colheitas.
      */
      const hasDatabaseHarvests =
        !!supabaseClient &&
        visibleHarvests.length > 0;

      const exampleCount =
        isSeller || hasDatabaseHarvests
          ? 0
          : 3;

      number.textContent =
        visibleHarvests.length +
        exampleCount;

    }

  }

  /*
     Pedidos do vendedor.
  */
  if (
    isSeller &&
    statCards[2]
  ) {

    const number =
      statCards[2].querySelector(
        '.stat-number'
      );

    if (number) {

      number.textContent =
        visibleOrders.length;

    }

  }

  /*
     SOMENTE esta informação foi corrigida:
     "Kg destinados" agora representa o total
     de sobras reais do vendedor logado.
  */
  if (
    isSeller &&
    statCards[3]
  ) {

    const number =
      statCards[3].querySelector(
        '.stat-number'
      );

    if (number) {

      const totalLeftovers =
        leftovers().reduce(
          (sum, item) =>
            sum +
            quantityNumber(
              item.quantity
            ),
          0
        );

      number.textContent =
        formatQuantity(
          totalLeftovers
        );

    }

  }

  /*
     Produtos em destaque:
     no máximo 3 para qualquer usuário.
  */
  let featured =
    visibleProducts.slice();

  if (isSeller) {

    const counts = {};

    orders().forEach(order => {

      if (
        order.sellerEmail ===
        user.email
      ) {

        counts[order.productId] =
          (counts[order.productId] || 0) + 1;

      }

    });

    featured.sort(
      (a, b) =>
        (counts[b.id] || 0) -
        (counts[a.id] || 0)
    );

  }

  featured =
    featured.slice(0, 3);

  renderProducts(
    featured,
    '#product-list'
  );

}


/* =========================================================
   INICIALIZAÇÃO DO SITE
   ========================================================= */

document.addEventListener('click', event => {
  if (event.target.matches('[data-close-product-modal]')) {
    closeProductDetails();
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeProductDetails();
});


document.addEventListener(
  'DOMContentLoaded',
  () => {

    if (
      document.body.classList.contains('admin-page') ||
      document.body.classList.contains('admin-auth-page') ||
      document.body.dataset.page === 'chat'
    ) {
      if (supabaseClient) syncFromSupabase();
      return;
    }

    if (supabaseClient) {
      syncFromSupabase();
    }


    /* =====================================================
       PÁGINAS PRIVADAS
       ===================================================== */

    if (
      document.body.dataset.private ===
      'true'
    ) {

      if (
        !requireUser()
      ) {

        return;

      }

    }


    /* =====================================================
       PÁGINAS EXCLUSIVAS DO VENDEDOR
       ===================================================== */

    const page =
      document.body.dataset.page;


    const sellerPages = [

      'transporte',
      'sobras',
      'cadastro-produto'

    ];


    if (
      sellerPages.includes(page)
    ) {

      if (
        !requireSeller()
      ) {

        return;

      }

    }


    /*
       Antes de qualquer coisa,
       migramos a conta antiga para
       a nova estrutura de contas.
    */


    /*
       Configura menu e usuário.
    */
    setupShell();


    /* =====================================================
       REMOVER PRODUTO DE TESTE
       ===================================================== */

    removeTestProduct();

    /*
       Limpa os pedidos antigos de teste uma única vez.
    */
    if (!supabaseClient) {
      clearOldTestOrdersV3();
      clearAllOrdersOnceV4();
    }


    /* =====================================================
       TRANSPORTE
       ===================================================== */


    /*
       Remove o botão "Solicitar transporte".

       Não precisamos alterar o HTML imediatamente,
       pois o JavaScript também consegue removê-lo.
    */
    document
      .querySelectorAll(
        'button, a, input[type="button"], input[type="submit"]'
      )
      .forEach(element => {

        const text =
          (
            element.textContent ||
            element.value ||
            ''
          )
            .trim()
            .toLowerCase();

        if (
          text.includes(
            'solicitar transporte'
          )
        ) {
          element.remove();
        }

      });


    /*
       Troca "Pedido relacionado"
       por "Placa do veículo".

       Isso também funciona caso o HTML ainda
       esteja com a versão antiga.
    */
    const transportFormForLabels =
      document.querySelector(
        '#transport-form'
      );


    if (
      transportFormForLabels
    ) {

      const firstLabel =
        transportFormForLabels
          .querySelector(
            '.field label'
          );


      const firstInput =
        transportFormForLabels
          .querySelector(
            '.field input'
          );


      if (firstLabel) {

        firstLabel.textContent =
          'Placa do veículo';

      }


      if (firstInput) {

        firstInput.placeholder =
          'Ex.: ABC-1D23';

      }

    }


    /* =====================================================
       PRODUTOS
       ===================================================== */

    if (
      document.querySelector(
        '#product-list'
      )
    ) {

      if (page === 'inicio') {
        renderInicioDashboard();
      } else {
        renderProducts();
      }

    }


    /*
       Busca de produtos.
    */
    const productSearch =
      document.querySelector(
        '#product-search'
      );


    if (productSearch) {

      productSearch.addEventListener(
        'input',
        () => {

          const query =
            productSearch.value
              .toLowerCase()
              .trim();


          let visible =
            getVisibleProducts();


          /*
             Filtra por:

             - produto
             - tipo
             - localização
             - produtor
          */
          if (query) {

            visible =
              visible.filter(
                product => {

                  return (

                    product.name +

                    ' ' +

                    product.type +

                    ' ' +

                    product.location +

                    ' ' +

                    product.seller

                  )
                    .toLowerCase()
                    .includes(query);

                }
              );

          }


          renderProducts(
            visible
          );

        }
      );

    }


    /*
       Filtro de tipo de produto.
    */
    const productType =
      document.querySelector(
        '#product-type-filter'
      );


    if (productType) {

      productType.addEventListener(
        'change',
        () => {

          const query =
            productSearch?.value
              .toLowerCase()
              .trim() || '';


          let visible =
            getVisibleProducts();


          /*
             Filtra pelo tipo.
          */
          if (
            productType.value
          ) {

            visible =
              visible.filter(
                product =>
                  product.type ===
                  productType.value
              );

          }


          /*
             Mantém também a pesquisa
             digitada pelo usuário.
          */
          if (query) {

            visible =
              visible.filter(
                product => (

                  product.name +
                  ' ' +
                  product.type +
                  ' ' +
                  product.location +
                  ' ' +
                  product.seller

                )
                  .toLowerCase()
                  .includes(query)

              );

          }


          renderProducts(
            visible
          );

        }
      );

    }


    /* =====================================================
       LOGIN
       ===================================================== */

    const login =
      document.querySelector(
        '#login-form'
      );


    if (login) {

      login.onsubmit =
        async event => {

          event.preventDefault();


          /*
             E-mail digitado.
          */
          const emailInput =
            document.querySelector(
              '#login-email'
            );


          /*
             Senha digitada.
          */
          const passwordInput =
            login.querySelector(
              'input[type="password"]'
            );


          const email =
            emailInput?.value
              .trim()
              .toLowerCase() || '';


          const password =
            passwordInput?.value || '';


          /*
             Acesso administrativo pelo mesmo index.
             O ADM possui sessão própria e não entra
             como comprador ou vendedor.
          */
          const adminAccounts = [
            { email: 'admin@safralink.com', password: 'admin123', name: 'Administradora' },
            { email: 'admin2@safralink.com', password: 'admin456', name: 'Administradora 2' }
          ];

          const adminAccount =
            adminAccounts.find(
              admin =>
                admin.email === email &&
                admin.password === password
            );

          if (adminAccount) {

            localStorage.setItem(
              'safralink_admin_session',
              JSON.stringify({
                admin: true,
                role: 'admin',
                email: adminAccount.email,
                name: adminAccount.name
              })
            );

            localStorage.removeItem('safralink_user');

            location.href = 'admin.html';

            return;

          }


          /*
             Se o Supabase estiver configurado, busca a conta
             diretamente no banco de dados caso ainda não esteja em cache.
          */
          if (supabaseClient) {
            try {
              const { data: dbRow } = await supabaseClient
                .from('usuarios')
                .select('*')
                .ilike('email', email)
                .maybeSingle();

              if (dbRow) {
                const mapped = fromDbUser(dbRow);
                if (mapped.admin) {
                  if (mapped.password && mapped.password !== password) {
                    toast('Senha incorreta.');
                    return;
                  }
                  localStorage.setItem(
                    'safralink_admin_session',
                    JSON.stringify({
                      admin: true,
                      role: 'admin',
                      email: mapped.email,
                      name: mapped.name
                    })
                  );
                  localStorage.removeItem('safralink_user');
                  location.href = 'admin.html';
                  return;
                }
                const currentUsers = getUsers();
                const idx = currentUsers.findIndex(u => String(u.email || '').toLowerCase() === email);
                if (idx >= 0) currentUsers[idx] = mapped;
                else currentUsers.push(mapped);
                isApplyingRemoteSync = true;
                localStorage.setItem('safralink_users', JSON.stringify(currentUsers));
                dbSnapshots.safralink_users = currentUsers.map(u => ({ ...u }));
                isApplyingRemoteSync = false;
              }
            } catch (_) {}
          }


          /*
             Recupera contas cadastradas.
          */
          const users =
            getUsers();


          /*
             Procura o e-mail.
          */
          const account =
            users.find(
              user =>
                String(
                  user.email
                )
                  .toLowerCase() ===
                email
            );


          /*
             Conta não encontrada.
          */
          if (!account) {

            toast(
              'Conta não encontrada. Crie seu cadastro primeiro.'
            );

            return;

          }


          /*
             Se a conta possuir senha,
             verificamos a senha.

             Contas antigas da versão anterior
             podem não ter senha salva. Nesse caso
             deixamos o login funcionar para não
             quebrar a conta existente.
          */
          if (
            account.password &&
            account.password !==
              password
          ) {

            toast(
              'Senha incorreta.'
            );

            return;

          }


          /*
             Recupera exatamente o perfil salvo:

             comprador → seller: false
             vendedor → seller: true
          */
          saveUser(
            account
          );


          /*
             Vai para a página inicial.
          */
          location.href =
            'inicio.html';

        };

    }


    /* =====================================================
       CADASTRO
       ===================================================== */

    const signup =
      document.querySelector(
        '#signup-form'
      );


    if (signup) {

      signup.onsubmit =
        event => {

          event.preventDefault();


          const name =
            document.querySelector(
              '#signup-name'
            ).value
              .trim();


          const email =
            document.querySelector(
              '#signup-email'
            ).value
              .trim()
              .toLowerCase();


          const password =
            signup
              .querySelector(
                'input[type="password"]'
              )
              ?.value || '';


          /*
             Verifica se já existe
             uma conta com esse e-mail.
          */
          const users =
            getUsers();


          const alreadyExists =
            users.some(
              user =>
                String(
                  user.email
                )
                  .toLowerCase() ===
                email
            );


          if (
            alreadyExists
          ) {

            toast(
              'Este e-mail já está cadastrado. Faça login.'
            );

            return;

          }


          /*
             Toda conta nova começa
             como compradora.

             Se depois quiser vender,
             pode usar "Quero vender".
          */
          const user = {

            name:
              name,

            email:
              email,

            password:
              password,

            seller:
              false,

            role:
              'comprador',

            farm:
              '',

            city:
              ''

          };


          /*
             Salva a conta.
          */
          users.push(
            user
          );

          saveUsers(
            users
          );


          /*
             E inicia a sessão.
          */
          saveUser(
            user
          );


          toast(
            'Cadastro realizado!'
          );


          (window.waitForSupabaseSync ? window.waitForSupabaseSync() : Promise.resolve()).finally(() => {
            setTimeout(
              () => {

                location.href =
                  'inicio.html';

              },
              500
            );
          });

        };

    }


    /* =====================================================
       TORNAR-SE VENDEDOR
       ===================================================== */

    const sellerForm =
      document.querySelector(
        '#seller-form'
      );


    if (sellerForm) {

      /*
         Preenche os dados que já pertencem à conta do comprador,
         sem mudar a página atual. Os novos dados ficam para o
         comprador completar neste mesmo formulário.
      */
      const sellerAccount = getUser() || {};

      const setSellerField = (selector, value) => {
        const field = document.querySelector(selector);
        if (field && value != null && String(value) !== '') {
          field.value = String(value);
        }
      };

      setSellerField('#seller-account-name', sellerAccount.name || sellerAccount.nome || '');
      setSellerField('#seller-account-email', sellerAccount.email || '');
      setSellerField('#seller-city', sellerAccount.city || '');
      setSellerField('#seller-name', sellerAccount.farm || '');
      setSellerField('#seller-document-type', sellerAccount.sellerDocumentType || '');
      setSellerField('#seller-document', sellerAccount.sellerDocument || '');
      setSellerField('#seller-birth', sellerAccount.sellerBirthDate || '');
      setSellerField('#seller-phone', sellerAccount.sellerPhone || '');
      setSellerField('#seller-cep', sellerAccount.sellerCep || '');
      setSellerField('#seller-address', sellerAccount.sellerAddress || '');
      setSellerField('#seller-production', sellerAccount.sellerProduction || '');
      setSellerField('#seller-description', sellerAccount.sellerDescription || '');

      sellerForm.onsubmit =
        event => {

          event.preventDefault();


          const user =
            getUser() || {};


          /*
             Transforma a conta em vendedor e salva
             os mesmos dados solicitados no cadastro
             direto de vendedor.
          */
          const value = id =>
            document.querySelector(id)?.value?.trim() || '';

          user.seller = true;
          user.role = 'produtor rural';
          user.name = value('#seller-account-name') || user.name || '';
          user.farm = value('#seller-name');
          user.city = value('#seller-city');
          user.sellerDocumentType = value('#seller-document-type');
          user.documentType = user.sellerDocumentType;
          user.sellerDocument = value('#seller-document');
          user.document = user.sellerDocument;
          user.sellerBirthDate = value('#seller-birth');
          user.birth = user.sellerBirthDate;
          user.sellerPhone = value('#seller-phone');
          user.phone = user.sellerPhone;
          user.sellerCep = value('#seller-cep');
          user.cep = user.sellerCep;
          user.sellerAddress = value('#seller-address');
          user.address = user.sellerAddress;
          user.sellerProduction = value('#seller-production');
          user.productionType = user.sellerProduction;
          user.sellerDescription = value('#seller-description');
          user.activityDescription = user.sellerDescription;
          user.sellerDocumentFileName =
            document.querySelector('#seller-document-photo')?.files?.[0]?.name ||
            user.sellerDocumentFileName || '';
          user.sellerRegistrationComplete = true;

          /*
             Atualiza também o cadastro salvo na lista de usuários,
             mantendo a mesma conta e sem criar um novo usuário.
          */
          const users = getUsers();
          const index = users.findIndex(item =>
            String(item.email || '').toLowerCase() ===
            String(user.email || '').toLowerCase()
          );

          if (index >= 0) {
            users[index] = { ...users[index], ...user, seller: true, role: 'produtor rural' };
          } else {
            users.push({ ...user, seller: true, role: 'produtor rural' });
          }
          saveUsers(users);

          saveUser(user);


          toast(
            'Cadastro de vendedor concluído!'
          );


          (window.waitForSupabaseSync ? window.waitForSupabaseSync() : Promise.resolve()).finally(() => {
            setTimeout(
              () => {

                location.href =
                  'inicio.html';

              },
              500
            );
          });

        };

    }


    /* =====================================================
       CADASTRO DIRETO DE VENDEDOR
       ===================================================== */

    const sellerSignupForm =
      document.querySelector('#seller-signup-form');

    if (sellerSignupForm) {

      sellerSignupForm.onsubmit = event => {

        event.preventDefault();

        const value = id =>
          document.querySelector(id)?.value?.trim() || '';

        const name = value('#seller-signup-name');
        const email = value('#seller-signup-email').toLowerCase();
        const password = document.querySelector('#seller-signup-password')?.value || '';
        const documentType = value('#seller-document-type');
        const documentNumber = value('#seller-document');
        const birthDate = value('#seller-birth');
        const phone = value('#seller-phone');
        const cep = value('#seller-cep');
        const address = value('#seller-address');
        const city = value('#seller-city');
        const farm = value('#seller-farm');
        const production = value('#seller-production');
        const description = value('#seller-description');
        const documentPhoto = document.querySelector('#seller-document-photo')?.files?.[0];

        const users = getUsers();

        if (users.some(user => String(user.email || '').toLowerCase() === email)) {
          toast('Este e-mail já está cadastrado. Faça login.');
          return;
        }

        const user = {
          name,
          email,
          password,
          seller: true,
          role: 'produtor rural',
          farm,
          city,
          sellerDocumentType: documentType,
          sellerDocument: documentNumber,
          sellerBirthDate: birthDate,
          sellerPhone: phone,
          sellerCep: cep,
          sellerAddress: address,
          sellerProduction: production,
          sellerDescription: description,
          sellerDocumentFileName: documentPhoto?.name || '',
          sellerRegistrationComplete: true
        };

        users.push(user);
        saveUsers(users);
        saveUser(user);

        toast('Conta de vendedor criada!');

        (window.waitForSupabaseSync ? window.waitForSupabaseSync() : Promise.resolve()).finally(() => {
          setTimeout(() => {
            location.href = 'inicio.html';
          }, 500);
        });
      };
    }


    /* =====================================================
       CADASTRO / EDIÇÃO DE PRODUTO
       ===================================================== */

    const productForm =
      document.querySelector(
        '#product-form'
      );

    function setProductPhotoPreview(dataUrl) {
      const preview = document.querySelector('#p-photo-preview');
      let removeBtn = document.querySelector('#p-photo-remove');
      if (!removeBtn && preview && preview.parentElement) {
        removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.id = 'p-photo-remove';
        removeBtn.className = 'btn btn-danger';
        removeBtn.style.marginTop = '10px';
        removeBtn.textContent = '🗑️ Excluir foto';
        preview.insertAdjacentElement('afterend', removeBtn);
      }
      if (dataUrl) {
        if (preview) {
          preview.hidden = false;
          preview.innerHTML = `<img src="${dataUrl}" alt="Foto do produto">`;
        }
        if (removeBtn) removeBtn.hidden = false;
      } else {
        if (preview) {
          preview.hidden = true;
          preview.innerHTML = '';
        }
        if (removeBtn) removeBtn.hidden = true;
      }
    }


    if (productForm) {

      const params =
        new URLSearchParams(
          location.search
        );


      const editId =
        params.get('id');


      /*
         Se existir ID, carregamos
         o produto para edição.
      */
      const populateEditingProduct = () => {
        if (!editId) return;
        const currentUser = getUser();
        const product =
          products().find(
            item =>
              String(item.id) ===
              String(editId)
          );

        if (
          product &&
          currentUser?.seller &&
          product.sellerEmail ===
            currentUser.email
        ) {
          if (!productForm.dataset.userEdited) {
            document.querySelector('#p-name').value = product.name;
            document.querySelector('#p-type').value = product.type;
            document.querySelector('#p-qty').value = product.qty;
            document.querySelector('#p-price').value = product.price;
            document.querySelector('#p-location').value = product.location;

            const descriptionField = document.querySelector('#p-description');
            const unitField = document.querySelector('#p-unit');
            const minOrderField = document.querySelector('#p-min-order');
            if (descriptionField) descriptionField.value = product.description || '';
            if (unitField) unitField.value = product.unit || '';
            if (minOrderField) minOrderField.value = product.minOrder || '';
          }

          if (productForm.dataset.photoRemoved !== 'true' && !productForm.dataset.photoData) {
            setProductPhotoPreview(product.photoData || '');
          }

          productForm.dataset.editingId =
            product.id;

          const submit =
            productForm.querySelector(
              'button[type="submit"]'
            );

          if (submit) {
            submit.textContent =
              'Salvar alterações';
          }
        }
      };

      if (editId) {
        productForm.addEventListener('input', () => {
          productForm.dataset.userEdited = 'true';
        }, { once: true });
        populateEditingProduct();
        window.addEventListener('safralink:synced', populateEditingProduct);
      }


      /*
         Salvar produto.
      */
      productForm.onsubmit =
        event => {

          event.preventDefault();


          const currentUser =
            getUser();


          /*
             Somente vendedor pode
             cadastrar produto.
          */
          if (
            !currentUser?.seller
          ) {

            toast(
              'Apenas vendedores podem cadastrar produtos.'
            );

            return;

          }


          const list =
            products();


          /*
             Dados preenchidos no formulário.
          */
          const data = {

            name:
              document.querySelector(
                '#p-name'
              ).value.trim(),

            type:
              document.querySelector(
                '#p-type'
              ).value,

            qty:
              document.querySelector(
                '#p-qty'
              ).value.trim(),

            price:
              document.querySelector(
                '#p-price'
              ).value.trim(),

            location:
              document.querySelector(
                '#p-location'
              ).value.trim(),

            description:
              document.querySelector('#p-description')?.value.trim() || '',

            unit:
              document.querySelector('#p-unit')?.value.trim() || '',

            minOrder:
              document.querySelector('#p-min-order')?.value.trim() || '',

            photoData:
              productForm.dataset.photoData || ''

          };


          const editingId =
            productForm.dataset.editingId;


          /*
             EDIÇÃO
          */
          if (
            editingId
          ) {

            const index =
              list.findIndex(
                product =>
                  String(
                    product.id
                  ) ===
                  String(
                    editingId
                  )
              );


            /*
               Confirma que o produto
               pertence ao vendedor.
            */
            if (
              index === -1 ||
              list[index].sellerEmail !==
                currentUser.email
            ) {

              toast(
                'Você só pode editar seus próprios produtos.'
              );

              return;

            }


            /*
               Atualiza mantendo os dados
               antigos que não foram alterados.
            */
            list[index] = {

              ...list[index],

              ...data,

              photoData:
                productForm.dataset.photoRemoved === 'true'
                  ? ''
                  : (data.photoData || list[index].photoData || ''),

              seller:
                currentUser.farm ||
                list[index].seller,

              sellerEmail:
                currentUser.email

            };


            saveProducts(
              list
            );


            toast(
              'Produto atualizado com sucesso!'
            );


            (window.waitForSupabaseSync ? window.waitForSupabaseSync() : Promise.resolve()).finally(() => {
              setTimeout(
                () => {

                  location.href =
                    'produtos.html';

                },
                500
              );
            });


            return;

          }


          /*
             NOVO PRODUTO
          */
          list.unshift({

            id:
              Date.now(),

            ...data,

            emoji:
              '🌱',

            seller:
              currentUser.farm ||
              'Meu produtor',

            sellerEmail:
              currentUser.email

          });


          saveProducts(
            list
          );


          toast(
            'Produto cadastrado com sucesso!'
          );


          productForm.reset();
          delete productForm.dataset.photoData;
          delete productForm.dataset.photoRemoved;
          setProductPhotoPreview('');

        };

    }


    const productPhotoInput = document.querySelector('#p-photo');
    if (productPhotoInput) {
      productPhotoInput.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || '');
          const form = document.querySelector('#product-form');
          if (form) {
            form.dataset.photoData = dataUrl;
            delete form.dataset.photoRemoved;
          }
          setProductPhotoPreview(dataUrl);
        };
        reader.readAsDataURL(file);
      });
    }

    const productPhotoRemoveBtn = document.querySelector('#p-photo-remove');
    if (productPhotoRemoveBtn) {
      productPhotoRemoveBtn.addEventListener('click', () => {
        const form = document.querySelector('#product-form');
        const fileInput = document.querySelector('#p-photo');
        if (fileInput) fileInput.value = '';
        if (form) {
          delete form.dataset.photoData;
          form.dataset.photoRemoved = 'true';
          const editingId = form.dataset.editingId;
          if (editingId) {
            const currentUser = getUser();
            const list = products();
            const idx = list.findIndex(p => String(p.id) === String(editingId));
            if (idx >= 0 && (!currentUser?.email || list[idx].sellerEmail === currentUser.email)) {
              list[idx] = { ...list[idx], photoData: '' };
              saveProducts(list);
            }
          }
        }
        setProductPhotoPreview('');
        toast('Foto do produto excluída!');
      });
    }


    /* =====================================================
       COLHEITAS
       ===================================================== */

    const harvestForm =
      document.querySelector(
        '#harvest-form'
      );


    if (harvestForm) {

      const filter =
        document.querySelector(
          '#harvest-search'
        );


      const dateFilter =
        document.querySelector(
          '#harvest-date'
        );


      /*
         IMPORTANTE:

         O comprador pode pesquisar.

         O vendedor NÃO precisa de pesquisa.
         Por isso escondemos toda a seção
         de filtros para o vendedor.
      */
      if (
        getUser()?.seller
      ) {

        const filterSection =
          filter?.closest(
            'section.card'
          );


        if (filterSection) {

          filterSection.style.display =
            'none';

        }

      }


      /*
         Função responsável pelos filtros
         do comprador.
      */
      function applyHarvestFilters() {

        const user =
          getUser();

        /*
           O vendedor não usa filtros.
           A lista dele é sempre somente a própria.
        */
        if (user?.seller) {

          renderHarvests(
            getVisibleHarvests()
          );

          return;

        }

        let list =
          getVisibleHarvests();

        const query =
          filter?.value
            .trim()
            .toLowerCase() || '';

        const selectedDate =
          dateFilter?.value || '';

        /*
           Pesquisa por produto ou produtor.
        */
        if (query) {

          list =
            list.filter(item => {

              const product =
                String(
                  item.product ||
                  item.name ||
                  ''
                ).toLowerCase();

              const producer =
                String(
                  item.seller ||
                  item.producer ||
                  item.sellerName ||
                  ''
                ).toLowerCase();

              return (
                product.includes(query) ||
                producer.includes(query)
              );

            });

        }

        /*
           Pesquisa por qualquer dia dentro do período.
        */
        if (selectedDate) {

          const wanted =
            parseLocalDate(
              selectedDate
            );

          if (wanted) {

            const wantedTime =
              wanted.getTime();

            list =
              list.filter(item => {

                const start =
                  parseLocalDate(
                    item.start
                  );

                const end =
                  parseLocalDate(
                    item.end ||
                    item.start
                  );

                if (
                  !start ||
                  !end
                ) {
                  return false;
                }

                const first =
                  Math.min(
                    start.getTime(),
                    end.getTime()
                  );

                const last =
                  Math.max(
                    start.getTime(),
                    end.getTime()
                  );

                return (
                  wantedTime >= first &&
                  wantedTime <= last
                );

              });

          }

        }

        /*
           Renderiza os registros cadastrados.
        */
        renderHarvests(
          list
        );

        /*
           Os 3 exemplos continuam visíveis para o comprador,
           mas também participam da pesquisa.
        */
        const exampleRows =
          document.querySelectorAll(
            '#harvest-list [data-example-harvest]'
          );

        exampleRows.forEach(row => {

          const text =
            row.textContent
              .trim()
              .toLowerCase();

          let visible =
            true;

          if (
            query &&
            !text.includes(query)
          ) {

            visible =
              false;

          }

          /*
             Para os exemplos, a pesquisa por data
             considera os períodos escritos no HTML.
          */
          if (
            selectedDate &&
            visible
          ) {

            const wanted =
              parseLocalDate(
                selectedDate
              );

            const period =
              text.match(
                /(\d{1,2})\s*-\s*(\d{1,2})\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)/
              );

            if (
              wanted &&
              period
            ) {

              const months = {
                jan: 0,
                fev: 1,
                mar: 2,
                abr: 3,
                mai: 4,
                jun: 5,
                jul: 6,
                ago: 7,
                set: 8,
                out: 9,
                nov: 10,
                dez: 11
              };

              const month =
                months[period[3]];

              const first =
                new Date(
                  wanted.getFullYear(),
                  month,
                  Number(period[1])
                );

              const last =
                new Date(
                  wanted.getFullYear(),
                  month,
                  Number(period[2])
                );

              visible =
                wanted >= first &&
                wanted <= last;

            }

          }

          row.style.display =
            visible
              ? ''
              : 'none';

        });

      }


      /*
         Ativa busca por texto.
      */
      if (filter) {

        filter.addEventListener(
          'input',
          applyHarvestFilters
        );

      }


      /*
         Ativa busca por data.
      */
      if (dateFilter) {

        dateFilter.addEventListener(
          'change',
          applyHarvestFilters
        );

      }


      /*
         Cadastro / edição de previsão.
      */
      harvestForm.onsubmit =
        event => {

          event.preventDefault();


          if (
            !requireSeller()
          ) {

            return;

          }


          const currentUser =
            getUser();


          const fields =
            harvestForm.querySelectorAll(
              'input, select, textarea'
            );


          const editingId =
            harvestForm.dataset.editingId;


          const list =
            harvests();


          /*
             Dados da previsão.
          */
          const data = {

            product:
              fields[0]?.value.trim() || '',

            quantity:
              fields[1]?.value.trim() || '',

            start:
              fields[2]?.value || '',

            end:
              fields[3]?.value || '',

            status:
              fields[4]?.value ||
              'Prevista',

            notes:
              fields[5]?.value.trim() || '',

            seller:
              currentUser.farm ||
              currentUser.name ||
              'Produtor',

            sellerEmail:
              currentUser.email

          };


          /*
             Impede salvar uma previsão sem período válido.
          */
          if (
            !data.product ||
            !data.quantity ||
            !data.start ||
            !data.end
          ) {

            toast(
              'Preencha produto, quantidade e as duas datas.'
            );

            return;

          }


          const startDate =
            parseLocalDate(
              data.start
            );

          const endDate =
            parseLocalDate(
              data.end
            );

          if (
            !startDate ||
            !endDate ||
            startDate.getTime() >
              endDate.getTime()
          ) {

            toast(
              'A data inicial deve ser anterior ou igual à data final.'
            );

            return;

          }


          /*
             EDIÇÃO
          */
          if (
            editingId
          ) {

            const index =
              list.findIndex(
                item =>
                  String(
                    item.id
                  ) ===
                  String(
                    editingId
                  )
              );


            /*
               Só pode editar a própria previsão.
            */
            if (
              index === -1 ||
              list[index].sellerEmail !==
                currentUser.email
            ) {

              toast(
                'Você só pode editar suas próprias previsões.'
              );

              return;

            }


            list[index] = {

              ...list[index],

              ...data

            };


            saveHarvests(
              list
            );


            delete harvestForm.dataset.editingId;


            harvestForm.reset();


            const submit =
              harvestForm.querySelector(
                'button[type="submit"]'
              );


            if (submit) {

              submit.textContent =
                'Salvar previsão';

            }


            renderHarvests(
              getVisibleHarvests()
            );


            toast(
              'Previsão atualizada com sucesso!'
            );


            return;

          }


          /*
             NOVA PREVISÃO
          */
          list.push({

            id:
              Date.now(),

            ...data

          });


          saveHarvests(
            list
          );


          harvestForm.reset();


          renderHarvests(
            getVisibleHarvests()
          );


          toast(
            'Previsão de colheita salva!'
          );

        };

    }


    /* =====================================================
       TRANSPORTE
       ===================================================== */

    const transportForm =
      document.querySelector(
        '#transport-form'
      );


    if (transportForm) {
      transportForm.onsubmit = event => {
        event.preventDefault();
        if (!requireSeller()) return;
        const user = getUser();
        const fields = transportForm.querySelectorAll('input, select');
        const data = { plate: fields[0].value.trim().toUpperCase(), product: fields[1].value.trim(), origin: fields[2].value.trim(), destination: fields[3].value.trim(), quantity: fields[4].value.trim(), status: fields[5].value };
        const list = transports();
        const editingId = transportForm.dataset.editingId;
        if (editingId) {
          const index=list.findIndex(item=>String(item.id)===String(editingId));
          if(index===-1 || list[index].sellerEmail!==user.email){ toast('Você só pode editar seus próprios transportes.'); return; }
          list[index]={...list[index],...data}; saveTransports(list);
          delete transportForm.dataset.editingId; transportForm.reset();
          const submit=document.querySelector('#transport-submit'), cancel=document.querySelector('#transport-cancel-edit');
          if(submit) submit.textContent='Salvar transporte'; if(cancel) cancel.hidden=true;
          renderTransports(); toast('Transporte atualizado!'); return;
        }
        list.unshift({id:Date.now(),...data,sellerEmail:user?.email||''});
        saveTransports(list); transportForm.reset(); renderTransports(); toast('Informação de transporte registrada!');
      };
      const cancel=document.querySelector('#transport-cancel-edit');
      if(cancel) cancel.addEventListener('click',()=>{ delete transportForm.dataset.editingId; transportForm.reset(); const submit=document.querySelector('#transport-submit'); if(submit) submit.textContent='Salvar transporte'; cancel.hidden=true; });
    }


    /* =====================================================
       SOBRAS
       ===================================================== */

    const leftoverForm =
      document.querySelector(
        '#leftover-form'
      );


    if (leftoverForm) {

      leftoverForm.onsubmit =
        event => {

          event.preventDefault();


          if (
            !requireSeller()
          ) {

            return;

          }


          const fields =
            leftoverForm.querySelectorAll(
              'input, select'
            );


          /*
             Criamos a sobra.

             A data é imediatamente convertida
             para DD/MM/AAAA.
          */
          const item = {

            id:
              Date.now(),

            product:
              fields[0].value
                .trim(),

            quantity:
              fields[1].value
                .trim(),

            destination:
              fields[2].value,

            date:
              formatDate(
                fields[3].value
              ),

            sellerEmail:
              getUser()?.email ||
              ''

          };


          const list =
            leftovers();


          list.push(
            item
          );


          saveLeftovers(
            list
          );


          leftoverForm.reset();


          /*
             Re-renderiza a tabela.

             Isso faz:
             - ordenar por data;
             - atualizar cards;
             - mostrar a nova sobra.
          */
          renderLeftovers();


          toast(
            'Sobra registrada!'
          );

        };

    }


    /* =====================================================
       PERFIL
       ===================================================== */
    const profileForm = document.querySelector('#profile-form');
    if (profileForm) {
      let user = getUser() || {};
      const fields = {
        name: document.querySelector('#profile-name'), email: document.querySelector('#profile-email'),
        password: document.querySelector('#profile-password'), passwordConfirm: document.querySelector('#profile-password-confirm'),
        phone: document.querySelector('#profile-phone'), document: document.querySelector('#profile-document'),
        documentType: document.querySelector('#profile-document-type'), birth: document.querySelector('#profile-birth'),
        cep: document.querySelector('#profile-cep'), address: document.querySelector('#profile-address'), city: document.querySelector('#profile-city'),
        farm: document.querySelector('#profile-farm'), production: document.querySelector('#profile-production'), description: document.querySelector('#profile-description'),
        photo: document.querySelector('#profile-photo-input'), photoPreview: document.querySelector('#profile-photo-preview'),
        documentPhoto: document.querySelector('#profile-document-photo'), documentName: document.querySelector('#profile-document-name'), sellerBox: document.querySelector('#seller-profile-fields')
      };
      const setVal=(el,val)=>{if(el) el.value=val??''};
      const fillProfileFields = (u) => {
        setVal(fields.name,u.name); setVal(fields.email,u.email); setVal(fields.phone,u.phone); setVal(fields.document,u.document);
        setVal(fields.documentType,u.documentType); setVal(fields.birth,u.birth); setVal(fields.cep,u.cep); setVal(fields.address,u.address); setVal(fields.city,u.city);
        setVal(fields.farm,u.farm); setVal(fields.production,u.sellerProduction || u.productionType); setVal(fields.description,u.sellerDescription || u.activityDescription);
        if (fields.sellerBox) fields.sellerBox.hidden=!u.seller;
        if (fields.photoPreview) {
          const activePhoto = fields.photoPreview.dataset.pending || u.photoData || '';
          fields.photoPreview.innerHTML = activePhoto ? `<img src="${activePhoto}" alt="Foto de perfil" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">` : escapeHtml(initials(u.name||'Usuário'));
          fields.photoPreview.classList.toggle('has-photo',!!activePhoto);
        }
      };
      fillProfileFields(user);

      window.addEventListener('safralink:synced', () => {
        const syncedUser = getUser();
        if (syncedUser) {
          user = syncedUser;
          fillProfileFields(user);
          setupShell();
        }
      });

      const compressProfileImage = (dataUrl) => new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          try {
            const maxDim = 400;
            let w = img.width || maxDim;
            let h = img.height || maxDim;
            if (w > maxDim || h > maxDim) {
              if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
              else { w = Math.round((w * maxDim) / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } catch (_) {
            resolve(dataUrl);
          }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      });

      if (fields.photo) fields.photo.onchange=()=>{
        const file=fields.photo.files?.[0]; if(!file)return;
        if(file.size>2*1024*1024){alert('A foto deve ter no máximo 2 MB.');fields.photo.value='';return;}
        const reader=new FileReader();
        reader.onload=async ()=>{
          const finalPhoto = await compressProfileImage(String(reader.result || ''));
          if (fields.photoPreview) {
            fields.photoPreview.innerHTML=`<img src="${finalPhoto}" alt="Foto de perfil" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">`;
            fields.photoPreview.classList.add('has-photo');
            fields.photoPreview.dataset.pending=finalPhoto;
          }
          const current = getUser() || user || {};
          const users = getUsers();
          const emailKey = String(current.email || '').toLowerCase();
          const idx = users.findIndex(u => String(u.email || '').toLowerCase() === emailKey || (u.id != null && current.id != null && String(u.id) === String(current.id)));
          const updatedPhotoUser = { ...(idx >= 0 ? users[idx] : {}), ...current, photoData: finalPhoto };
          if (idx >= 0) {
            users[idx] = updatedPhotoUser;
            saveUsers(users);
          }
          saveUser(updatedPhotoUser);
          user = updatedPhotoUser;
          setupShell();
        };
        reader.readAsDataURL(file);
      };
      if (fields.documentPhoto) fields.documentPhoto.onchange=()=>{ const f=fields.documentPhoto.files?.[0]; if(f&&fields.documentName) fields.documentName.textContent=f.name; };
      profileForm.onsubmit=event=>{
        event.preventDefault();
        user = getUser() || user || {};
        const newEmail=String(fields.email?.value||'').trim().toLowerCase();
        const newPassword=String(fields.password?.value||'');
        if(newPassword && newPassword!==String(fields.passwordConfirm?.value||'')){toast('As senhas não conferem.');return;}
        const users=getUsers(); const oldEmail=String(user.email||'').toLowerCase();
        const idx=users.findIndex(u=>String(u.email||'').toLowerCase()===oldEmail || (u.id!=null&&user.id!=null&&String(u.id)===String(user.id)));
        if(idx<0){toast('Conta não encontrada.');return;}
        if(newEmail!==oldEmail && users.some((u,i)=>i!==idx&&String(u.email||'').toLowerCase()===newEmail)){toast('Este e-mail já está em uso.');return;}
        const pendingPhoto=fields.photoPreview?.dataset.pending;
        const resolvedPhoto=pendingPhoto || user.photoData || users[idx].photoData || '';
        const updated={...users[idx], ...user,
          name:String(fields.name?.value||'').trim(), email:newEmail, phone:String(fields.phone?.value||'').trim(),
          document:String(fields.document?.value||'').trim(), documentType:fields.documentType?.value||'', birth:fields.birth?.value||'', cep:String(fields.cep?.value||'').trim(),
          address:String(fields.address?.value||'').trim(), city:String(fields.city?.value||'').trim(),
          photoData:resolvedPhoto
        };
        if(fields.sellerBox && user.seller){ updated.farm=String(fields.farm?.value||'').trim(); updated.sellerProduction=fields.production?.value||''; updated.productionType=fields.production?.value||''; updated.sellerDescription=String(fields.description?.value||'').trim(); updated.activityDescription=updated.sellerDescription; }
        if(newPassword) updated.password=newPassword;
        if(fields.photoPreview) delete fields.photoPreview.dataset.pending;
        users[idx]=updated; saveUsers(users); saveUser(updated); user=updated;
        setupShell();
        if(fields.password) fields.password.value=''; if(fields.passwordConfirm) fields.passwordConfirm.value='';
        toast('Perfil atualizado com sucesso!');
      };
    }

    /* =====================================================
       RENDERIZAÇÃO INICIAL
       ===================================================== */

    renderOrders();

    renderHarvests();

    renderTransports();

    renderLeftovers();

  }

);

/* =========================================================
   SAFRALINK — LISTA DE INTERESSES DO COMPRADOR
   ========================================================= */
(function initProductInterestDrawer(){
  function init(){
    const user = getUser();
    const drawer = document.querySelector('#interest-drawer');
    if (!user || !drawer) return;
    if (user.seller) {
      drawer.remove();
      return;
    }
    renderInterestDrawer();
    const toggle = document.querySelector('#interest-drawer-toggle');
    const close = document.querySelector('#interest-drawer-close');
    if (toggle) toggle.onclick = openInterestDrawer;
    if (close) close.onclick = closeInterestDrawer;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* =========================================================
   SAFRALINK — WIDGET DE MENSAGENS NA INÍCIO
   Visível apenas para compradores e somente quando houver
   mensagens novas.
   ========================================================= */
(function initBuyerMessageWidget(){
  function readJSON(key, fallback){
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }

  function render(){
    const widget = document.querySelector('#buyer-message-widget');
    if (!widget) return;

    const user = readJSON('safralink_user', null);
    const email = String(user && user.email || '').toLowerCase().trim();
    if (!email || user.admin) { widget.hidden = true; return; }

    const chats = readJSON('safralink_chats', {});
    const users = readJSON('safralink_users', []);
    const byEmail = {};
    (Array.isArray(users) ? users : []).forEach(u => { byEmail[String(u.email || '').toLowerCase().trim()] = u; });
    const demos = {
      'demo1@safralink.com':'Sítio Boa Terra','demo2@safralink.com':'Produtor João','demo3@safralink.com':'Horta da Ana',
      'demo4@safralink.com':'Sítio Verde','demo5@safralink.com':'Família Souza','demo6@safralink.com':'Chácara do Vale'
    };

    const items = Object.entries(chats || {}).map(([key, chat]) => {
      const participants = Array.isArray(chat && chat.participants) ? chat.participants.map(v => String(v).toLowerCase().trim()) : [];
      if (!participants.includes(email) || Number(chat && chat.unread && chat.unread[email] || 0) <= 0) return null;
      const other = participants.find(v => v !== email) || '';
      const contact = byEmail[other];
      const name = user.seller ? (contact?.name || contact?.farm || demos[other] || 'Comprador') : (contact?.farm || contact?.name || demos[other] || 'Vendedor');
      const messages = Array.isArray(chat.messages) ? chat.messages : [];
      const last = messages[messages.length - 1];
      return { key, other, name, unread: Number(chat.unread[email] || 0), text: last?.text || 'Nova mensagem', updatedAt: Number(chat.updatedAt || last?.createdAt || 0) };
    }).filter(Boolean).sort((a,b) => b.updatedAt - a.updatedAt);

    if (!items.length) { widget.hidden = true; return; }

    const total = items.reduce((sum, item) => sum + item.unread, 0);
    widget.hidden = false;
    widget.innerHTML = `
      <div class="buyer-message-widget-head">
        <div><span class="buyer-message-kicker">Chat</span><h3>Mensagens novas</h3><p>${total} ${total === 1 ? 'mensagem nova' : 'mensagens novas'} de ${user.seller ? 'compradores' : 'vendedores'}</p></div>
        <span class="buyer-message-badge">${total}</span>
      </div>
      <div class="buyer-message-list">
        ${items.slice(0,3).map(item => `
          <a class="buyer-message-item" href="chat.html?email=${encodeURIComponent(item.other)}">
            <span class="buyer-message-avatar">${escapeHtml(initials(item.name))}</span>
            <span class="buyer-message-copy"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.text)}</span></span>
            <span class="buyer-message-count">${item.unread}</span>
          </a>`).join('')}
      </div>
      <a class="btn btn-soft buyer-message-open" href="chat.html">Abrir chat →</a>`;
  }

  function init(){
    if (document.body.dataset.page !== 'inicio') return;
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  window.addEventListener('storage', event => {
    if (event.key === 'safralink_chats' || event.key === 'safralink_user') render();
  });
  window.addEventListener('safralink:synced', render);
})();

/* =========================================================
   SAFRALINK — NOTIFICAÇÃO DO CHAT
   Apenas lê as conversas salvas e mostra a bolinha quando
   existe mensagem não lida para o usuário atual.
   ========================================================= */
(function initChatNotification(){

  function getJSON(key, fallback){
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch (_) { return fallback; }
  }

  function updateChatDot(){
    const dots = document.querySelectorAll('.chat-notification-dot');
    if (!dots.length) return;

    const user = getJSON('safralink_user', null);
    const email = String(user && user.email || '').toLowerCase().trim();
    let hasUnread = false;

    if (email) {
      const chats = getJSON('safralink_chats', {});
      hasUnread = Object.values(chats || {}).some(chat =>
        Array.isArray(chat && chat.participants) &&
        chat.participants.map(v => String(v).toLowerCase().trim()).includes(email) &&
        Number(chat && chat.unread && chat.unread[email] || 0) > 0
      );
    }

    dots.forEach(dot => { dot.hidden = !hasUnread; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updateChatDot);
  } else {
    updateChatDot();
  }

  window.addEventListener('storage', event => {
    if (event.key === 'safralink_chats' || event.key === 'safralink_user') updateChatDot();
  });
  window.addEventListener('safralink:synced', updateChatDot);

})();

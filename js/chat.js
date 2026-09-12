/* =========================================================
   SAFRALINK — CHAT
   Alterações exclusivas do chat. Não depende de backend.
   As conversas e mensagens ficam salvas no navegador.
   ========================================================= */
(() => {
  'use strict';

  const USERS_KEY = 'safralink_users';
  const SESSION_KEY = 'safralink_user';
  const CHATS_KEY = 'safralink_chats';

  const demoContacts = [
    {email:'demo1@safralink.com',name:'Sítio Boa Terra',seller:true,role:'Vendedor / Produtor'},
    {email:'demo2@safralink.com',name:'Produtor João',seller:true,role:'Vendedor / Produtor'},
    {email:'demo3@safralink.com',name:'Horta da Ana',seller:true,role:'Vendedora / Produtora'},
    {email:'demo4@safralink.com',name:'Sítio Verde',seller:true,role:'Vendedor / Produtor'},
    {email:'demo5@safralink.com',name:'Família Souza',seller:true,role:'Vendedor / Produtor'},
    {email:'demo6@safralink.com',name:'Chácara do Vale',seller:true,role:'Vendedor / Produtor'}
  ];

  const $ = s => document.querySelector(s);
  const read = (key, fallback) => {
    try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value == null ? fallback : value; }
    catch (_) { return fallback; }
  };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  // Recupera a sessão e, se necessário, completa os dados usando o cadastro salvo.
  // Isso evita que o comprador apareça como "Usuário" depois do login.
  const currentUser = () => {
    const session = read(SESSION_KEY, null);
    if (!session) return null;

    const users = read(USERS_KEY, []);
    const sessionEmail = emailOf(session);
    const registered = Array.isArray(users)
      ? users.find(u => emailOf(u) === sessionEmail)
      : null;

    return registered ? { ...registered, ...session } : session;
  };
  const emailOf = u => String((u && u.email) || u || '').toLowerCase().trim();
  const nameOf = u => String((u && (u.name || u.nome || u.fullName || u.username)) || 'Usuário');
  const initials = name => String(name || 'Usuário').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'U';
  const roleOf = u => u && (u.seller === true || u.tipo === 'vendedor' || u.role === 'seller' || u.perfil === 'vendedor') ? 'Vendedor / Produtor' : 'Comprador';
  const chatId = (a,b) => [emailOf(a),emailOf(b)].sort().join('::');

  let activeEmail = null;

  function getContacts() {
    const me = currentUser();
    const myEmail = emailOf(me);
    const registered = read(USERS_KEY, []);
    const map = new Map();
    [...registered, ...demoContacts].forEach(c => {
      const e = emailOf(c);
      if (!e || e === myEmail || map.has(e)) return;
      map.set(e, {...c, name:nameOf(c), role:c.role || roleOf(c)});
    });
    return [...map.values()];
  }

  function getChats() {
    const raw = read(CHATS_KEY, {});
    const clean = {};
    const me = currentUser();
    const myEmail = emailOf(me);
    let changed = false;

    Object.entries(raw || {}).forEach(([key, chat]) => {
      if (!chat || !Array.isArray(chat.participants) || chat.participants.length !== 2) { changed = true; return; }
      const participants = chat.participants.map(emailOf);
      // Remove conversas antigas que tenham usuário vazio/placeholder.
      if (participants.some(e => !e || e === 'undefined' || e === 'null' || e === 'usuario' || e === 'usuário')) {
        changed = true;
        return;
      }
      if (myEmail && !participants.includes(myEmail)) return;
      chat.participants = participants;
      clean[key] = chat;
    });

    if (changed) write(CHATS_KEY, clean);
    return clean;
  }

  function ensureConversation(otherEmail) {
    const me = currentUser();
    const key = chatId(me, otherEmail);
    const data = getChats();
    if (!data[key]) {
      data[key] = {
        participants: [emailOf(me), emailOf(otherEmail)],
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      write(CHATS_KEY, data);
    }
    return data[key];
  }

  function contactByEmail(email) {
    const found = getContacts().find(c => emailOf(c) === emailOf(email));
    return found || null;
  }

  function setupUser() {
    const me = currentUser();
    if (!me) { window.location.href = 'index.html'; return false; }
    $('#sidebar-initials').textContent = initials(nameOf(me));
    $('#sidebar-name').textContent = nameOf(me);
    $('#sidebar-role').textContent = roleOf(me);
    return true;
  }

  function escapeHTML(value) {
    const div = document.createElement('div');
    div.textContent = String(value == null ? '' : value);
    return div.innerHTML;
  }

  function time(ts) {
    return new Date(ts).toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  }

  function day(ts) {
    const d = new Date(ts), now = new Date();
    return d.toDateString() === now.toDateString() ? time(ts) : d.toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit'});
  }

  function updateChatNotification() {
    const me = currentUser();
    const myEmail = emailOf(me);
    const dots = document.querySelectorAll('.chat-notification-dot');
    if (!dots.length) return;

    const data = getChats();
    const hasUnread = Object.values(data).some(chat =>
      Array.isArray(chat.participants) &&
      chat.participants.includes(myEmail) &&
      Number(chat.unread && chat.unread[myEmail] || 0) > 0
    );

    dots.forEach(dot => { dot.hidden = !hasUnread; });
  }

  function renderConversations() {
    const me = currentUser();
    const myEmail = emailOf(me);
    const search = String($('#chat-search').value || '').toLowerCase().trim();
    const data = getChats();

    const items = Object.keys(data)
      .filter(key => Array.isArray(data[key].participants) && data[key].participants.includes(myEmail))
      .map(key => {
        const chat = data[key];
        const other = chat.participants.find(e => e !== myEmail);
        return {key, chat, other, contact:contactByEmail(other), last:chat.messages && chat.messages.length ? chat.messages[chat.messages.length-1] : null};
      })
      .filter(item => item.contact && (!search || item.contact.name.toLowerCase().includes(search) || (item.last && item.last.text.toLowerCase().includes(search))))
      .sort((a,b) => (b.chat.updatedAt || b.chat.createdAt) - (a.chat.updatedAt || a.chat.createdAt));

    const total = Object.values(data).filter(c => Array.isArray(c.participants) && c.participants.includes(myEmail)).length;
    $('#conversation-count').textContent = total;
    updateChatNotification();

    if (!items.length) {
      $('#conversation-list').innerHTML = '<div class="chat-empty-conversations">Nenhuma conversa salva ainda.<br>Use <b>+ Novo produtor</b> para adicionar alguém.</div>';
      return;
    }

    $('#conversation-list').innerHTML = items.map(item => {
      const unread = item.chat.unread && item.chat.unread[myEmail] ? '<span class="unread-dot"></span>' : '';
      const preview = item.last ? (item.last.sender === myEmail ? 'Você: ' : '') + escapeHTML(item.last.text) : 'Conversa iniciada';
      return `<div class="conversation ${activeEmail === item.other ? 'active' : ''}" data-email="${escapeHTML(item.other)}">
        <div class="avatar">${escapeHTML(initials(item.contact.name))}</div>
        <div class="conversation-body">
          <div class="conversation-line"><strong>${escapeHTML(item.contact.name)}</strong><time>${item.last ? day(item.last.createdAt) : ''}</time></div>
          <span class="conversation-preview">${preview}</span>
        </div>${unread}
      </div>`;
    }).join('');

    $('#conversation-list').querySelectorAll('.conversation').forEach(el => {
      el.addEventListener('click', () => openConversation(el.dataset.email));
    });
  }

  function renderMessages() {
    const me = currentUser();
    const empty = $('#chat-empty');
    const active = $('#chat-active');

    if (!activeEmail) {
      empty.hidden = false;
      active.hidden = true;
      return;
    }

    const contact = contactByEmail(activeEmail);
    if (!contact) { activeEmail = null; renderConversations(); empty.hidden = false; active.hidden = true; return; }
    const chat = ensureConversation(activeEmail);
    const data = getChats();
    const key = chatId(me, activeEmail);

    if (data[key] && data[key].unread) {
      data[key].unread[emailOf(me)] = 0;
      write(CHATS_KEY, data);
      updateChatNotification();
    }

    empty.hidden = true;
    active.hidden = false;
    $('#contact-avatar').textContent = initials(contact.name);
    $('#contact-name').textContent = contact.name;
    $('#contact-role').textContent = contact.role || roleOf(contact);
    
    const messages = chat.messages || [];
    if (!messages.length) {
      $('#messages').innerHTML = '<div class="chat-empty-conversations">Conversa salva. Envie a primeira mensagem para começar.</div>';
      return;
    }

    $('#messages').innerHTML = messages.map(m => `
      <div class="message ${m.sender === emailOf(me) ? 'mine' : 'theirs'}">
        <div class="message-bubble">${escapeHTML(m.text)}<span class="message-meta">${time(m.createdAt)}</span></div>
      </div>`).join('');

    requestAnimationFrame(() => { $('#messages').scrollTop = $('#messages').scrollHeight; });
  }

  function openConversation(email) {
    activeEmail = emailOf(email);
    // O simples ato de adicionar/abrir o produtor cria a conversa e a mantém salva.
    ensureConversation(activeEmail);
    renderConversations();
    renderMessages();
    showConversationView();
    $('#message-input').focus();
  }

  function renderContacts() {
    const query = String($('#contact-search').value || '').toLowerCase().trim();
    const list = $('#contact-list');
    const contacts = getContacts().filter(c => c.name.toLowerCase().includes(query) || emailOf(c).includes(query));

    if (!contacts.length) {
      list.innerHTML = '<div class="chat-no-results">Nenhum produtor encontrado.</div>';
      return;
    }

    list.innerHTML = contacts.map(c => `
      <div class="contact" data-email="${escapeHTML(c.email)}">
        <div class="avatar">${escapeHTML(initials(c.name))}</div>
        <div class="contact-body"><strong>${escapeHTML(c.name)}</strong><span>${escapeHTML(c.role || roleOf(c))}</span></div>
      </div>`).join('');

    list.querySelectorAll('.contact').forEach(el => {
      el.addEventListener('click', () => {
        closeModal();
        openConversation(el.dataset.email);
      });
    });
  }

  function openModal() {
    $('#contact-modal').hidden = false;
    $('#contact-search').value = '';
    renderContacts();
    setTimeout(() => $('#contact-search').focus(), 0);
  }

  function closeModal() { $('#contact-modal').hidden = true; }

  function sendMessage(text) {
    const me = currentUser();
    const clean = String(text || '').trim();
    if (!me || !activeEmail || !clean) return false;

    const data = getChats();
    const key = chatId(me, activeEmail);
    if (!data[key]) ensureConversation(activeEmail);

    // Releitura após ensureConversation evita perder a conversa recém-criada.
    const fresh = getChats();
    const chat = fresh[key];
    if (!chat) return false;

    if (!Array.isArray(chat.messages)) chat.messages = [];
    chat.messages.push({
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2),
      sender: emailOf(me),
      receiver: activeEmail,
      text: clean,
      createdAt: Date.now()
    });
    chat.updatedAt = Date.now();
    chat.unread = chat.unread || {};
    chat.unread[activeEmail] = (chat.unread[activeEmail] || 0) + 1;

    fresh[key] = chat;
    write(CHATS_KEY, fresh);
    updateChatNotification();
    renderConversations();
    renderMessages();
    return true;
  }

  const chatLayout = $('.chat-layout');
  function showConversationView() { if (chatLayout) chatLayout.classList.add('chat-show-window'); }
  function showConversationList() { if (chatLayout) chatLayout.classList.remove('chat-show-window'); }

  $('#chat-back').addEventListener('click', () => {
    activeEmail = null;
    showConversationList();
    renderConversations();
  });

  $('#new-chat-btn').addEventListener('click', openModal);
  $('#empty-new-chat').addEventListener('click', openModal);
  $('#close-modal').addEventListener('click', closeModal);
  $('#contact-modal').addEventListener('click', e => { if (e.target.hasAttribute('data-close-modal')) closeModal(); });
  $('#contact-search').addEventListener('input', renderContacts);
  $('#chat-search').addEventListener('input', renderConversations);

  $('#message-form').addEventListener('submit', e => {
    e.preventDefault();
    const input = $('#message-input');
    if (sendMessage(input.value)) {
      input.value = '';
      input.focus();
    }
  });

  $('#message-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#message-form').requestSubmit();
    }
  });

  $('#logout-btn').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'index.html';
  });

  window.addEventListener('storage', e => {
    if (e.key === CHATS_KEY || e.key === USERS_KEY) {
      renderConversations();
      renderMessages();
      if (!$('#contact-modal').hidden) renderContacts();
    }
  });

  if (setupUser()) {
    renderConversations();
    renderMessages();

    const requestedEmail = new URLSearchParams(window.location.search).get('email');
    if (requestedEmail) {
      const requestedContact = contactByEmail(requestedEmail);
      if (requestedContact && emailOf(requestedContact) !== emailOf(currentUser())) {
        openConversation(requestedEmail);
      }
    }
  }
})();

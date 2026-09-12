(function () {
  'use strict';
  const ADMINS = [
    { email: 'admin@safralink.com', password: 'admin123', name: 'Administradora' },
    { email: 'admin2@safralink.com', password: 'admin456', name: 'Administradora 2' }
  ];
  function init() {
    const form = document.getElementById('admin-login-form');
    if (!form) return;
    const emailInput = document.getElementById('admin-email');
    const passwordInput = document.getElementById('admin-password');
    const error = document.getElementById('admin-login-error');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      event.stopPropagation();
      const email = String(emailInput.value || '').trim().toLowerCase();
      const password = String(passwordInput.value || '');
      const account = ADMINS.find(item => item.email === email && item.password === password);
      if (!account) {
        error.textContent = 'E-mail ou senha administrativa incorretos.';
        error.hidden = false;
        return;
      }
      try {
        localStorage.setItem('safralink_admin_session', JSON.stringify({ admin:true, role:'admin', email:account.email, name:account.name }));
        localStorage.removeItem('safralink_user');
        error.hidden = true;
        window.location.replace('admin.html');
      } catch (err) {
        error.textContent = 'Não foi possível iniciar a sessão neste navegador. Verifique o armazenamento local.';
        error.hidden = false;
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();

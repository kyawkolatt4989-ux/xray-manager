

'use strict';

const $ = (id) => document.getElementById(id);

let currentPage = 'dashboard';
let usersCache = [];

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error || `Request failed (${response.status})`);
  }

  return data;
}

function showMessage(element, message) {
  if (element) element.textContent = message || '';
}

function formatDate(value) {
  if (!value) return 'No expiry';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleDateString();
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? '-';
}

function showPage(page) {
  const pages = ['dashboard', 'users', 'inbounds', 'settings'];

  if (!pages.includes(page)) return;

  currentPage = page;

  pages.forEach(name => {
    const section = $(`${name}Page`);
    if (section) section.hidden = name !== page;
  });

  document.querySelectorAll('.nav').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
  });

  setText('pageTitle', page.charAt(0).toUpperCase() + page.slice(1));

  if (page === 'dashboard') loadDashboard();
  if (page === 'users') loadUsers();

  $('sidebar')?.classList.remove('open');
}

function setLoggedIn(loggedIn) {
  const loginPage = $('loginPage');
  const panel = $('panel');
  const sidebar = $('sidebar');

  if (loginPage) loginPage.hidden = loggedIn;
  if (panel) panel.hidden = !loggedIn;
  if (sidebar) sidebar.style.display = loggedIn ? '' : 'none';

  if (loggedIn) showPage('dashboard');
}

async function login(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = $('loginError');

  showMessage(error, '');

  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;

  if (!username || !password) {
    showMessage(error, 'Enter username and password.');
    return;
  }

  button.disabled = true;
  button.textContent = 'Signing in...';

  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    form.reset();
    setLoggedIn(true);
  } catch (err) {
    showMessage(error, err.message || 'Login failed.');
  } finally {
    button.disabled = false;
    button.textContent = 'Sign In';
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch (err) {
    console.error(err);
  }

  setLoggedIn(false);
  showMessage($('loginError'), '');
}

function unwrap(data) {
  return data?.data || data?.result || data || {};
}

async function loadDashboard() {
  try {
    const response = await api('/api/dashboard');
    const data = unwrap(response);

    const stats = data.stats || data;
    const system = data.system || data.server || {};

    setText('totalUsers', stats.totalUsers ?? stats.total ?? 0);
    setText('enabledUsers', stats.enabledUsers ?? stats.enabled ?? 0);
    setText('disabledUsers', stats.disabledUsers ?? stats.disabled ?? 0);

    setText('cpuCores', system.cpuCores ?? system.cpus ?? '-');
    setText('hostname', system.hostname ?? '-');
    setText('platform', system.platform ?? '-');
    setText('uptime', system.uptime ?? '-');
    setText('memory', system.memoryUsage ?? system.memory ?? '-');

    setText(
      'xrayStatus',
      data.xray?.status || data.xrayStatus || 'Not Connected'
    );

    setText(
      'xrayMessage',
      data.xray?.message ||
      data.message ||
      'Xray Core integration is not configured yet.'
    );
  } catch (err) {
    console.error('Dashboard:', err);
  }
}

function createCell(text) {
  const td = document.createElement('td');
  td.textContent = text ?? '-';
  return td;
}

function createActionButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  button.addEventListener('click', handler);
  return button;
}

function renderUsers(users) {
  const tbody = $('userRows');
  if (!tbody) return;

  tbody.replaceChildren();

  if (!users.length) {
    const row = document.createElement('tr');
    const cell = createCell('No users found.');
    cell.colSpan = 6;
    row.appendChild(cell);
    tbody.appendChild(row);
    return;
  }

  users.forEach(user => {
    const row = document.createElement('tr');

    row.appendChild(createCell(user.username));
    row.appendChild(createCell(String(user.protocol || '').toUpperCase()));
    row.appendChild(createCell(user.uuid || user.id || '-'));
    row.appendChild(createCell(formatDate(user.expiresAt)));

    const status = user.enabled === false ? 'Disabled' : 'Enabled';
    row.appendChild(createCell(status));

    const actions = document.createElement('td');

    actions.appendChild(
      createActionButton(
        user.enabled === false ? 'Enable' : 'Disable',
        'secondary',
        () => toggleUser(user)
      )
    );

    actions.appendChild(
      createActionButton(
        'Delete',
        'danger',
        () => deleteUser(user)
      )
    );

    actions.appendChild(
      createActionButton(
        'QR',
        'secondary',
        () => showQR(user)
      )
    );

    row.appendChild(actions);
    tbody.appendChild(row);
  });
}

async function loadUsers() {
  const tbody = $('userRows');
  if (tbody) tbody.textContent = 'Loading users...';

  try {
    const response = await api('/api/users');
    const data = unwrap(response);

    usersCache = Array.isArray(data)
      ? data
      : Array.isArray(data.users)
        ? data.users
        : [];

    renderUsers(usersCache);
  } catch (err) {
    console.error('Users:', err);

    if (tbody) {
      tbody.textContent = `Unable to load users: ${err.message}`;
    }
  }
}

async function createUser(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');

  const username = form.elements.username.value.trim();
  const protocol = form.elements.protocol.value;
  const trafficLimitGb = Number(form.elements.trafficLimitGb.value || 0);
  const expiresAt = form.elements.expiresAt.value || null;

  if (username.length < 3) {
    alert('Username must be at least 3 characters.');
    return;
  }

  if (!Number.isFinite(trafficLimitGb) || trafficLimitGb < 0) {
    alert('Invalid traffic limit.');
    return;
  }

  button.disabled = true;

  try {
    await api('/api/users', {
      method: 'POST',
      body: JSON.stringify({
        username,
        protocol,
        trafficLimitGb,
        expiresAt
      })
    });

    form.reset();
    $('createBox').hidden = true;

    await loadUsers();
    await loadDashboard();

    alert('User record created successfully.');
  } catch (err) {
    alert(err.message || 'Unable to create user.');
  } finally {
    button.disabled = false;
  }
}

async function toggleUser(user) {
  const nextState = user.enabled === false;

  if (!confirm(`${nextState ? 'Enable' : 'Disable'} ${user.username}?`)) {
    return;
  }

  try {
    await api(`/api/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: nextState })
    });

    await loadUsers();
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteUser(user) {
  if (!confirm(`Delete user "${user.username}"? This cannot be undone.`)) {
    return;
  }

  try {
    await api(`/api/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE'
    });

    await loadUsers();
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
}

async function showQR(user) {
  try {
    const response = await api(
      `/api/users/${encodeURIComponent(user.id)}/qr`
    );

    const data = unwrap(response);

    const value = data.qr || data.qrCode || data.data || JSON.stringify(data);

    alert(
      'QR endpoint response received.\n\n' +
      (typeof value === 'string' ? value : JSON.stringify(value))
    );
  } catch (err) {
    alert(`QR unavailable: ${err.message}`);
  }
}

function setupEvents() {
  $('loginForm')?.addEventListener('submit', login);
  $('logout')?.addEventListener('click', logout);

  $('menuBtn')?.addEventListener('click', () => {
    $('sidebar')?.classList.toggle('open');
  });

  document.querySelectorAll('.nav').forEach(button => {
    button.addEventListener('click', () => {
      showPage(button.dataset.page);
    });
  });

  $('refreshBtn')?.addEventListener('click', loadDashboard);
  $('reloadUsers')?.addEventListener('click', loadUsers);

  $('showCreate')?.addEventListener('click', () => {
    $('createBox').hidden = false;
  });

  $('cancelCreate')?.addEventListener('click', () => {
    $('createBox').hidden = true;
    $('userForm')?.reset();
  });

  $('userForm')?.addEventListener('submit', createUser);
}

async function checkLogin() {
  try {
    await api('/api/me');
    setLoggedIn(true);
  } catch {
    setLoggedIn(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  checkLogin();
});

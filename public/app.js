
'use strict';

const $ = id => document.getElementById(id);

let currentPage = 'dashboard';
let usersCache = [];

const TOKEN_KEY = 'xray_manager_token';

function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

async function api(url, options = {}) {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {})
  };

  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin'
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      setLoggedIn(false);
    }

    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }

  return data;
}

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = value ?? '-';
}

function formatUptime(seconds) {
  if (!Number.isFinite(Number(seconds))) return '-';

  const total = Math.floor(Number(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  return `${days}d ${hours}h ${minutes}m`;
}

function formatMemory(bytes) {
  if (!Number.isFinite(Number(bytes))) return '-';

  const gb = Number(bytes) / (1024 ** 3);
  return `${gb.toFixed(2)} GB`;
}

function formatDate(value) {
  if (!value) return 'No expiry';

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString();
}

function setLoggedIn(loggedIn) {
  $('loginPage').hidden = loggedIn;
  $('panel').hidden = !loggedIn;

  $('sidebar').style.display = loggedIn ? '' : 'none';

  if (loggedIn) {
    showPage('dashboard');
  }
}

function showPage(page) {
  const pages = ['dashboard', 'users', 'inbounds', 'settings'];

  if (!pages.includes(page)) return;

  currentPage = page;

  pages.forEach(name => {
    $(`${name}Page`).hidden = name !== page;
  });

  document.querySelectorAll('.nav').forEach(button => {
    button.classList.toggle('active', button.dataset.page === page);
  });

  setText('pageTitle', page.charAt(0).toUpperCase() + page.slice(1));

  if (page === 'dashboard') loadDashboard();
  if (page === 'users') loadUsers();

  $('sidebar').classList.remove('open');
}

async function login(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const error = $('loginError');

  error.textContent = '';

  const username = form.elements.username.value.trim();
  const password = form.elements.password.value;

  button.disabled = true;
  button.textContent = 'Signing in...';

  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    if (!data.token) throw new Error('Login token was not received.');

    sessionStorage.setItem(TOKEN_KEY, data.token);

    form.reset();
    setLoggedIn(true);
  } catch (err) {
    error.textContent = err.message;
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

  sessionStorage.removeItem(TOKEN_KEY);
  setLoggedIn(false);
}

async function checkLogin() {
  if (!getToken()) {
    setLoggedIn(false);
    return;
  }

  try {
    await api('/api/me');
    setLoggedIn(true);
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    setLoggedIn(false);
  }
}

async function loadDashboard() {
  try {
    const data = await api('/api/dashboard');

    const users = data.users || {};
    const system = data.system || {};
    const xray = data.xray || {};

    setText('totalUsers', users.total ?? 0);
    setText('enabledUsers', users.enabled ?? 0);
    setText('disabledUsers', users.disabled ?? 0);
    setText('cpuCores', system.cpuCores ?? '-');

    setText('hostname', system.hostname ?? '-');
    setText('platform', system.platform ?? '-');
    setText('uptime', formatUptime(system.uptime));

    const memoryUsed = 100 - (
      Number(system.memoryFree || 0) /
      Math.max(Number(system.memoryTotal || 1), 1) * 100
    );

    setText(
      'memory',
      `${Math.round(memoryUsed)}% (${formatMemory(system.memoryTotal)})`
    );

    setText(
      'xrayStatus',
      xray.connected ? 'Connected' : 'Not Connected'
    );

    setText(
      'xrayMessage',
      xray.message || 'Xray Core integration is not configured yet.'
    );

  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

function createCell(value) {
  const cell = document.createElement('td');
  cell.textContent = value ?? '-';
  return cell;
}

function createButton(label, className, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = className;
  button.addEventListener('click', handler);
  return button;
}

function renderUsers(users) {
  const tbody = $('userRows');
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
    row.appendChild(createCell(user.uuid));
    row.appendChild(createCell(formatDate(user.expires_at)));

    row.appendChild(
      createCell(user.enabled ? 'Enabled' : 'Disabled')
    );

    const actions = document.createElement('td');

    actions.appendChild(
      createButton(
        user.enabled ? 'Disable' : 'Enable',
        'secondary',
        () => toggleUser(user)
      )
    );

    actions.appendChild(
      createButton(
        'QR',
        'secondary',
        () => showQR(user)
      )
    );

    actions.appendChild(
      createButton(
        'Delete',
        'danger',
        () => deleteUser(user)
      )
    );

    row.appendChild(actions);
    tbody.appendChild(row);
  });
}

async function loadUsers() {
  const tbody = $('userRows');
  tbody.textContent = 'Loading users...';

  try {
    const data = await api('/api/users');

    usersCache = Array.isArray(data.users) ? data.users : [];
    renderUsers(usersCache);

  } catch (err) {
    tbody.textContent = `Unable to load users: ${err.message}`;
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
    alert('Username must contain at least 3 characters.');
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
    alert(err.message);
  } finally {
    button.disabled = false;
  }
}

async function toggleUser(user) {
  const enabled = !Boolean(user.enabled);

  if (!confirm(`${enabled ? 'Enable' : 'Disable'} ${user.username}?`)) {
    return;
  }

  try {
    await api(`/api/users/${user.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled })
    });

    await loadUsers();
    await loadDashboard();

  } catch (err) {
    alert(err.message);
  }
}

async function deleteUser(user) {
  if (!confirm(`Delete ${user.username}? This cannot be undone.`)) {
    return;
  }

  try {
    await api(`/api/users/${user.id}`, {
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
    const data = await api(`/api/users/${user.id}/qr`);

    if (!data.qr) throw new Error('QR image not received.');

    const popup = window.open('', '_blank');

    if (!popup) {
      alert('Please allow pop-ups to display the QR code.');
      return;
    }

    const image = popup.document.createElement('img');
    image.src = data.qr;
    image.alt = `QR code for ${user.username}`;
    image.style.cssText = 'max-width:90%;display:block;margin:30px auto;';

    popup.document.body.appendChild(image);
    popup.document.title = `QR - ${user.username}`;

  } catch (err) {
    alert(err.message);
  }
}

function setupEvents() {
  $('loginForm').addEventListener('submit', login);
  $('logout').addEventListener('click', logout);

  $('menuBtn').addEventListener('click', () => {
    $('sidebar').classList.toggle('open');
  });

  document.querySelectorAll('.nav').forEach(button => {
    button.addEventListener('click', () => {
      showPage(button.dataset.page);
    });
  });

  $('refreshBtn').addEventListener('click', loadDashboard);
  $('reloadUsers').addEventListener('click', loadUsers);

  $('showCreate').addEventListener('click', () => {
    $('createBox').hidden = false;
  });

  $('cancelCreate').addEventListener('click', () => {
    $('createBox').hidden = true;
    $('userForm').reset();
  });

  $('userForm').addEventListener('submit', createUser);
}

document.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  checkLogin();
});

// @ts-nocheck
/** ========== CONFIG HELPERS ========== */
function cfg() {
  return {
    BOT_ID: 'fd31675696792541f46d1b9f11', // your GroupMe bot ID
    SHEET_ID: '13hEHQVU_gkWjhy1iuGDks5mtCUVnnBVtYDMcygOBbO8', // your Google Sheet ID
    REQUESTS_TAB: 'Requests',
    ROSTER_TAB: 'Roster',
    TIMEZONE: 'America/Chicago',
    ADMIN_NAME: 'Cooper Porter' // only admin for /org
  };
}

function getSheet(name) {
  return SpreadsheetApp.openById(cfg().SHEET_ID).getSheetByName(name);
}

function postToGroupMe(text) {
  const url = 'https://api.groupme.com/v3/bots/post';
  const payload = { bot_id: cfg().BOT_ID, text };
  UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

function boxMsg(title, body) {
  return [
    '━━━━━━━━━━━━━━━━━━',
    title,
    '━━━━━━━━━━━━━━━━━━',
    body,
    '━━━━━━━━━━━━━━━━━━'
  ].join('\n');
}

/** ========== HEADER HELPERS ========== */
function readHeader_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h));
}
function normalize_(s) { return String(s).trim().toLowerCase().replace(/\s+/g, ' '); }
function findCol_(hdr, name, alts) {
  const target = normalize_(name);
  const map = new Map();
  hdr.forEach((h, i) => map.set(normalize_(h), i + 1));
  if (map.has(target)) return map.get(target);
  if (alts) {
    for (const a of alts) {
      const key = normalize_(a);
      if (map.has(key)) return map.get(key);
    }
  }
  return -1;
}

/** ========== WEBHOOK ========== */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return ContentService.createTextOutput('ok');
    let body;
    try { body = JSON.parse(e.postData.contents); }
    catch (err) { return ContentService.createTextOutput('ok'); }
    if (body.sender_type === 'bot') return ContentService.createTextOutput('ok');
    const username = (body.name || '').trim();
    const text = (body.text || '').trim();
    const userId = body.user_id || '';
    if (text && text.startsWith('/')) handleCommand(text, username.toLowerCase(), userId, username);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    postToGroupMe('❌ doPost failed: ' + err.message);
    return ContentService.createTextOutput('error');
  }
}

/** ========== COMMAND ROUTER ========== */
function handleCommand(text, handle, userId, displayName) {
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.slice(1).join(' ');
  switch (cmd) {
    case '/ping':     return postToGroupMe(boxMsg('PING', 'pong'));
    case '/help':     return cmdHelp();
    case '/join':     return cmdJoin(arg, handle, userId, displayName);
    case '/take':
    case '/claim':    return cmdTake(arg, displayName || handle);
    case '/done':     return cmdDone(arg);
    case '/status':   return cmdStatus(arg);
    case '/list':     return cmdList();
    case '/announce': return cmdAnnounce(arg);
    case '/org':      return cmdReorg(displayName);
    default:          return postToGroupMe(boxMsg('Unknown', 'Unknown command. Try /help'));
  }
}

/** ========== COMMANDS ========== */
function cmdHelp() {
  postToGroupMe(boxMsg('📖 COMMANDS', [
    '/join {First Last} → add yourself',
    '/take {Active}     → claim a request',
    '/done {Active}     → mark request done',
    '/status {Active}   → see status',
    '/list              → all requests',
    '/announce {Active} → announce latest',
    '/org               → organize sheet (admin only)'
  ].join('\n')));
}

function cmdJoin(fullName, handle, userId, displayName) {
  fullName = fullName || displayName || handle;
  const sh = getSheet(cfg().ROSTER_TAB);
  const values = sh.getDataRange().getValues();
  const header = values[0];
  const idIdx = header.indexOf('GroupMe User ID');
  const exists = values.slice(1).some(r => String(r[idIdx] || '') === String(userId));
  if (!exists) {
    sh.appendRow([fullName, userId, new Date()]);
    postToGroupMe(boxMsg('👋 NEW ROSTER ENTRY', `Welcome ***${fullName.toUpperCase()}***`));
  } else {
    postToGroupMe(boxMsg('ℹ️ INFO', `${fullName} already in roster.`));
  }
}

/** /take with pledge assignment */
function cmdTake(activeName, pledgeName) {
  if (!activeName) return postToGroupMe('Usage: /take {Active Name}');
  const sh = getSheet(cfg().REQUESTS_TAB);
  const data = sh.getDataRange().getValues();
  const hdr = readHeader_(sh);
  const activeIdx   = findCol_(hdr, 'Active Name');
  const statusIdx   = findCol_(hdr, 'Status');
  const reqPldgIdx  = findCol_(hdr, 'Required Pledges');
  const asnPldgIdx  = findCol_(hdr, 'Assigned Pledges');
  for (let r = 1; r < data.length; r++) {
    const active = String(data[r][activeIdx] || '').trim().toLowerCase();
    if (active === activeName.toLowerCase()) {
      let required = reqPldgIdx > 0 ? parseInt(data[r][reqPldgIdx] || 1, 10) : 1;
      let assigned = asnPldgIdx > 0 ? String(data[r][asnPldgIdx] || '').split(',').map(s => s.trim()).filter(Boolean) : [];
      if (assigned.includes(pledgeName)) {
        return postToGroupMe(boxMsg('ℹ️ INFO', `${pledgeName} already signed up for ${activeName}`));
      }
      assigned.push(pledgeName);
      sh.getRange(r + 1, asnPldgIdx + 1).setValue(assigned.join(', '));
      if (assigned.length < required) {
        sh.getRange(r + 1, statusIdx + 1).setValue('Pending');
        return postToGroupMe(boxMsg('📌 CLAIMED (PENDING)', `${pledgeName} joined request for ${activeName}\n(${assigned.length}/${required} pledges)`));
      } else {
        sh.getRange(r + 1, statusIdx + 1).setValue('In Progress');
        return postToGroupMe(boxMsg('✅ FULLY CLAIMED', `Request for ${activeName} now has ${assigned.length}/${required} pledges:\n${assigned.join(', ')}`));
      }
    }
  }
  postToGroupMe(boxMsg('⚠️ WARNING', `No request found for ${activeName}`));
}

function cmdDone(activeName) {
  if (!activeName) return postToGroupMe('Usage: /done {Active Name}');
  const sh = getSheet(cfg().REQUESTS_TAB);
  const data = sh.getDataRange().getValues();
  const hdr = readHeader_(sh);
  const activeIdx = findCol_(hdr, 'Active Name');
  const statusIdx = findCol_(hdr, 'Status');
  for (let r = 1; r < data.length; r++) {
    const isMatch = String(data[r][activeIdx] || '').trim().toLowerCase() === activeName.toLowerCase();
    if (isMatch && String(data[r][statusIdx] || '').trim() === 'In Progress') {
      sh.getRange(r + 1, statusIdx + 1).setValue('Done');
      return postToGroupMe(boxMsg('✅ COMPLETED', `Request for ${activeName} is Done 🎉`));
    }
  }
  postToGroupMe(boxMsg('⚠️ WARNING', `No active In Progress requests for ${activeName}`));
}

function cmdStatus(activeName) {
  if (!activeName) return postToGroupMe('Usage: /status {Active Name}');
  const sh = getSheet(cfg().REQUESTS_TAB);
  const data = sh.getDataRange().getValues();
  const hdr = readHeader_(sh);
  const activeIdx   = findCol_(hdr, 'Active Name');
  const reqIdx      = findCol_(hdr, 'Request');
  const statusIdx   = findCol_(hdr, 'Status');
  const reqPldgIdx  = findCol_(hdr, 'Required Pledges');
  const asnPldgIdx  = findCol_(hdr, 'Assigned Pledges');
  const lines = [];
  for (let r = 1; r < data.length; r++) {
    const isMatch = String(data[r][activeIdx] || '').trim().toLowerCase() === activeName.toLowerCase();
    if (isMatch) {
      const req = data[r][reqIdx] || '';
      const status = data[r][statusIdx] || '';
      const required = reqPldgIdx > 0 ? data[r][reqPldgIdx] : 1;
      const assigned = asnPldgIdx > 0 ? data[r][asnPldgIdx] : '';
      lines.push(`▫️ ${req} — ${status} (${assigned || 0}/${required})`);
    }
  }
  postToGroupMe(lines.length ? boxMsg(`📋 STATUS — ${activeName}`, lines.join('\n')) : boxMsg('ℹ️ INFO', `No requests for ${activeName}`));
}

function cmdList() {
  const sh = getSheet(cfg().REQUESTS_TAB);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return postToGroupMe('ℹ️ No requests found.');
  const data = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getValues();
  const hdr  = data[0];
  const activeIdx = findCol_(hdr, 'Active Name');
  const reqIdx    = findCol_(hdr, 'Request');
  const statusIdx = findCol_(hdr, 'Status');
  const reqPldgIdx= findCol_(hdr, 'Required Pledges');
  const asnPldgIdx= findCol_(hdr, 'Assigned Pledges');
  const groups = { 'Not Claimed': [], 'Pending': [], 'In Progress': [], 'Done': [] };
  for (let r = 1; r < data.length; r++) {
    const active = data[r][activeIdx];
    const req    = data[r][reqIdx];
    const status = data[r][statusIdx];
    const required = reqPldgIdx > 0 ? data[r][reqPldgIdx] : 1;
    const assigned = asnPldgIdx > 0 ? data[r][asnPldgIdx] : '';
    if (active && req) {
      groups[status || 'Not Claimed'].push(`• ${active} — ${req} (${assigned || 0}/${required})`);
    }
  }
  let msg = '━━━━━━━━━━━━━━━━━━\n📋 ALL REQUESTS\n━━━━━━━━━━━━━━━━━━\n';
  for (const [status, arr] of Object.entries(groups)) {
    msg += `\n${status} (${arr.length})\n${arr.join('\n') || '—'}\n`;
  }
  postToGroupMe(msg);
}

function cmdAnnounce(activeName) {
  if (!activeName) return postToGroupMe('Usage: /announce {Active Name}');
  const sh = getSheet(cfg().REQUESTS_TAB);
  const data = sh.getDataRange().getValues();
  const hdr = readHeader_(sh);
  const activeIdx   = findCol_(hdr, 'Active Name');
  const reqIdx      = findCol_(hdr, 'Request');
  const statusIdx   = findCol_(hdr, 'Status');
  const reqPldgIdx  = findCol_(hdr, 'Required Pledges');
  const asnPldgIdx  = findCol_(hdr, 'Assigned Pledges');
  const tsIdx       = findCol_(hdr, 'Timestamp');
  let newestRow = null, newestTime = 0;
  for (let r = 1; r < data.length; r++) {
    const active = String(data[r][activeIdx] || '').trim().toLowerCase();
    const st = String(data[r][statusIdx] || '').trim();
    const ts = data[r][tsIdx];
    if (active === activeName.toLowerCase() && st !== 'Done' && ts instanceof Date) {
      const t = ts.getTime();
      if (t > newestTime) { newestTime = t; newestRow = r; }
    }
  }
  if (newestRow === null) {
    return postToGroupMe(boxMsg('ℹ️ INFO', `No active requests found for ${activeName}`));
  }
  const row = data[newestRow];
  const active = row[activeIdx];
  const req = row[reqIdx];
  const status = row[statusIdx];
  const required = reqPldgIdx > 0 ? row[reqPldgIdx] : 1;
  const assigned = asnPldgIdx > 0 ? row[asnPldgIdx] : '';
  const msg = boxMsg(
    `📣 NEW REQUEST — ${active}`,
    `📝 ${req}\n` +
    `📌 Status: ${status}\n` +
    `👥 Pledges: ${assigned || 0}/${required}\n\n` +
    `➡️ Take this with: /take {${active}}`
  );
  postToGroupMe(msg);
}

/** ========== /org with full cleanup ========== */
function cmdReorg(displayName) {
  if (displayName !== cfg().ADMIN_NAME) {
    return postToGroupMe('🚫 You are not authorized to run /org.');
  }
  try {
    fixBlanksAndValidate();
    cleanRowColorsSelective();
    deleteInvalidRows();
    promoteHighPriority();
    sortRequests();
    postToGroupMe(boxMsg('✅ REORG', 'Sheets organized and cleaned.'));
  } catch (e) {
    postToGroupMe(boxMsg('❌ ERROR', e.message));
  }
}

/** ========== UTILITIES ========== */
function fixBlanksAndValidate() {
  const sh = getSheet(cfg().REQUESTS_TAB);
  const data = sh.getDataRange().getValues();
  const hdr = readHeader_(sh);
  const statusIdx = findCol_(hdr, 'Status');
  if (statusIdx === -1) return;
  for (let r = 1; r < data.length; r++) {
    if (!data[r][statusIdx]) sh.getRange(r + 1, statusIdx + 1).setValue('Not Claimed');
  }
}

function cleanRowColorsSelective() {
  const sh = getSheet(cfg().REQUESTS_TAB);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow <= 1) return;
  sh.getRange(2, 1, lastRow - 1, lastCol).setBackground(null);
}

function deleteInvalidRows() {
  const sh = getSheet(cfg().REQUESTS_TAB);
  const data = sh.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    const blanks = data[r].filter(v => !v).length;
    if (blanks > 2) sh.deleteRow(r + 1);
  }
}

function promoteHighPriority() {
  const sh = getSheet(cfg().REQUESTS_TAB);
  const data = sh.getDataRange().getValues();
  const hdr = readHeader_(sh);
  const tsIdx = findCol_(hdr, 'Timestamp');
  const statusIdx = findCol_(hdr, 'Status');
  const priorityIdx = findCol_(hdr, 'Priority');
  if (tsIdx === -1 || statusIdx === -1 || priorityIdx === -1) return;
  for (let r = 1; r < data.length; r++) {
    const status = String(data[r][statusIdx] || '').trim();
    if (status === 'Not Claimed') {
      const ts = data[r][tsIdx];
      if (ts instanceof Date) {
        const ageMin = (new Date() - ts) / 60000;
        if (ageMin >= 45) sh.getRange(r + 1, priorityIdx + 1).setValue('High');
      }
    }
  }
}

function sortRequests() {
  const sh = getSheet(cfg().REQUESTS_TAB);
  const hdr = readHeader_(sh);
  const statusIdx = findCol_(hdr, 'Status') + 1;
  const priorityIdx = findCol_(hdr, 'Priority') + 1;
  const tsIdx = findCol_(hdr, 'Timestamp') + 1;
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return;
  const statusOrder = { 'Not Claimed': 1, 'Pending': 2, 'In Progress': 3, 'Done': 4 };
  const lastCol = sh.getLastColumn();
  sh.insertColumnAfter(lastCol);
  sh.insertColumnAfter(lastCol + 1);
  const statusKeyCol = lastCol + 1;
  const priorityKeyCol = lastCol + 2;
  const statuses = sh.getRange(2, statusIdx, lastRow - 1, 

  

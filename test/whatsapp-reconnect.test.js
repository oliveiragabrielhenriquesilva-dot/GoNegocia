import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';

test('restauração retenta falha de início e para ao expirar ou desconectar', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-wa-test-'));
  process.env.BALBINO_RUNTIME_DIR = dir;
  process.env.BALBINO_DATA_DIR = path.join(dir, 'data');
  process.env.BALBINO_SESSIONS_DIR = path.join(dir, 'sessions');
  process.env.BALBINO_BACKUPS_DIR = path.join(dir, 'backups');
  const specifier = 'data:text/javascript,' + encodeURIComponent(
    'export const useMultiFileAuthState = (...a) => globalThis.__goWaTestAuth(...a);' +
    'export const DisconnectReason = { loggedOut: 401, connectionLost: 408 };' +
    'export default () => globalThis.__goWaTestSocket();',
  );
  const hooks = registerHooks({
    resolve(name, context, next) {
      return name === '@whiskeysockets/baileys' ? { url: specifier, shortCircuit: true } : next(name, context);
    },
  });
  const sockets = [];
  let attempts = 0;
  globalThis.__goWaTestAuth = async () => {
    if (++attempts <= 2) throw new Error('Falha temporária de leitura');
    return { state: {}, saveCreds() {} };
  };
  globalThis.__goWaTestSocket = () => {
    const ev = new EventEmitter();
    sockets.push(ev);
    return { ev, user: { id: '5500000000001@s.whatsapp.net' }, end: () => ev.emit('connection.update', { connection:'close' }) };
  };
  t.after(() => {
    hooks.deregister();
    delete globalThis.__goWaTestAuth;
    delete globalThis.__goWaTestSocket;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const { all } = await import('../src/store.js');
  const { connectInstance, disconnectInstance, restoreWhatsAppSession, isWhatsAppReady } = await import('../src/providers/whatsapp-web.js');
  const { connections, settings } = all();
  settings.syncGroupsOnConnect = false;
  settings.syncChannelsOnConnect = false;
  const conn = { id:'wa-test', name:'Teste', state:'CONNECTED' };
  connections.push(conn);
  t.mock.timers.enable({ apis:['setTimeout'] });

  await restoreWhatsAppSession(conn);
  assert.equal(conn.state, 'RECONNECTING');
  assert.equal(attempts, 1);
  assert.match(conn.lastError.message, /Falha temporária/);
  const start = conn.reconnectingSince;

  t.mock.timers.tick(5000);
  await setImmediate();
  assert.equal(attempts, 2);
  assert.equal(conn.reconnectingSince, start);
  t.mock.timers.tick(9999);
  await setImmediate();
  assert.equal(attempts, 2);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.equal(attempts, 3);
  sockets[0].emit('connection.update', { connection:'open' });
  assert.equal(isWhatsAppReady(conn.id), true);
  assert.equal(conn.reconnectingSince, null);
  assert.equal(conn.lastError, null);

  sockets[0].emit('connection.update', { connection:'close', lastDisconnect:{ error:{ statusCode:401 } } });
  assert.equal(conn.state, 'EXPIRED');
  await restoreWhatsAppSession(conn);
  t.mock.timers.tick(60000);
  await setImmediate();
  assert.equal(attempts, 3);

  await connectInstance(conn.id);
  sockets[1].emit('connection.update', { connection:'close', lastDisconnect:{ error:{ statusCode:408 } } });
  assert.equal(conn.state, 'RECONNECTING');
  await disconnectInstance(conn.id);
  await restoreWhatsAppSession(conn);
  t.mock.timers.tick(60000);
  await setImmediate();
  assert.equal(conn.state, 'DISCONNECTED');
  assert.equal(attempts, 4);
});

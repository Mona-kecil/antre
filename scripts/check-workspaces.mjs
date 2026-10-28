import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs, parseEnv } from 'node:util';
import { ConvexHttpClient } from 'convex/browser';
import { WorkOS } from '@workos-inc/node';
import { PROTOCOL_VERSION_META_KEY, CLIENT_CAPABILITIES_META_KEY } from '@modelcontextprotocol/server';
import { api } from '../convex/_generated/api.js';

const { values } = parseArgs({ options: {
  local: { type: 'boolean' }, prod: { type: 'boolean' },
  env: { type: 'string' }, 'foreign-ids': { type: 'string' },
} });
assert(Boolean(values.local) !== Boolean(values.prod), 'Pass exactly one mode: --local or --prod.');
const modes = {
  local: {
    app: 'http://localhost:5173', envFile: '.env.local',
    validate(env, backend) {
      assert(['127.0.0.1', 'localhost', '[::1]'].includes(backend.hostname), 'Use a loopback Convex deployment.');
      assert(env.CONVEX_DEPLOYMENT?.startsWith('anonymous:') || env.CONVEX_DEPLOYMENT?.startsWith('local:'), 'Use a local Convex deployment.');
      assert(env.WORKOS_API_KEY?.startsWith('sk_test_'), 'Use a WorkOS staging API key.');
    },
    credentials: email => ({ email, password: `Antre!9${randomBytes(32).toString('base64url')}` }),
    authenticate: (credentials, session) => workos.userManagement.authenticateWithPassword({
      clientId: env.WORKOS_CLIENT_ID, ...credentials, session,
    }),
  },
  prod: {
    app: 'https://antre.monosodiums.com',
    validate(env) {
      assert(env.CONVEX_URL === 'https://hip-wolverine-557.convex.cloud', 'Use the Antre production Convex deployment.');
      assert(env.WORKOS_API_KEY?.startsWith('sk_live_'), 'Use a WorkOS production API key.');
    },
    credentials: email => ({ email }),
    async authenticate({ email }, session) {
      const magic = await workos.userManagement.createMagicAuth({ email });
      if (typeof magic.code !== 'string' || magic.code.length === 0) {
        console.error('WorkOS Magic Auth did not expose a code; stopping.');
        throw new Error('Missing Magic Auth code');
      }
      return workos.userManagement.authenticateWithMagicAuth({
        clientId: env.WORKOS_CLIENT_ID, code: magic.code, email, session,
      });
    },
  },
};
const mode = modes[values.local ? 'local' : 'prod'];
const envFile = values.env ?? mode.envFile;
let fileEnv = {};
if (envFile) {
  try { fileEnv = parseEnv(readFileSync(envFile, 'utf8')); }
  catch { throw new Error('Cannot read the dotenv file.'); }
}
const env = values.env ? { ...process.env, ...fileEnv } : { ...fileEnv, ...process.env };
assert(env.CONVEX_URL, 'Set CONVEX_URL.');
let backend;
try { backend = new URL(env.CONVEX_URL); }
catch { throw new Error('Set a valid CONVEX_URL.'); }
mode.validate(env, backend);
assert(env.WORKOS_CLIENT_ID, 'Set WORKOS_CLIENT_ID.');
assert(env.WORKOS_COOKIE_PASSWORD?.length >= 32, 'Set the session sealing password (at least 32 characters).');
let foreignIds = [];
if (values['foreign-ids']) {
  try { foreignIds = JSON.parse(readFileSync(values['foreign-ids'], 'utf8')); }
  catch { throw new Error('Cannot read the foreign post ID file as JSON.'); }
  assert(Array.isArray(foreignIds) && foreignIds.length > 0 && foreignIds.every(id => typeof id === 'string' && id.length > 0), 'The foreign post ID file must contain a nonempty array of strings.');
}
const app = new URL(mode.app);
const workos = new WorkOS(env.WORKOS_API_KEY, {
  clientId: env.WORKOS_CLIENT_ID,
  issuer: `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`,
});
const clients = [];
const users = [];
const checks = [];
const stamp = randomBytes(8).toString('hex');
let activeStep = 'start';
const report = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function temporaryUser(label, timeZone) {
  const email = `antre-check-${stamp}-${label}@example.com`;
  const credentials = mode.credentials(email);
  activeStep = `create WorkOS user ${label}`;
  const user = await workos.userManagement.createUser({ ...credentials, emailVerified: true });
  users.push(user.id);
  activeStep = `authenticate WorkOS user ${label}`;
  const auth = await mode.authenticate(credentials, {
    sealSession: true, cookiePassword: env.WORKOS_COOKIE_PASSWORD,
  });
  assert(auth.user.id === user.id, 'WorkOS must authenticate the temporary user.');
  const client = new ConvexHttpClient(backend.origin, { logger: false });
  client.setAuth(auth.accessToken);
  activeStep = `read initial workspace for ${label}`;
  assert(await client.query(api.workspaces.current, {}) === null, 'Temporary user must have no existing workspace.');
  activeStep = `create workspace for ${label}`;
  const workspace = await client.mutation(api.workspaces.ensure, { timeZone });
  clients.push(client);
  assert(workspace?._id);
  activeStep = `check empty workspace for ${label}`;
  for (const view of ['drafts', 'scheduled', 'published', 'failed']) {
    const library = await client.query(api.library.page, { view });
    assert(library.total === 0 && library.items.length === 0 && Object.values(library.counts).every(count => count === 0), 'Temporary workspace library must start empty.');
  }
  const queue = await client.query(api.posts.listQueue, {});
  assert(queue.length === 0, 'Temporary workspace queue must start empty.');
  for (let start = 0; start < foreignIds.length; start += 50) {
    const ids = foreignIds.slice(start, start + 50);
    const result = await client.query(api.posts.getPosts, { ids });
    assert(result.posts.length === ids.length && result.posts.every(post => post === null), 'Owner posts must be unreadable from the temporary workspace.');
  }
  return { client, workspace, cookie: auth.sealedSession };
}

async function mcp(token, method, params = {}) {
  const res = await fetch(new URL('/mcp', app), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`, 'Mcp-Method': method,
      'MCP-Protocol-Version': '2026-07-28',
      ...(params.name ? { 'Mcp-Name': params.name } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {
      ...params, _meta: { [PROTOCOL_VERSION_META_KEY]: '2026-07-28', [CLIENT_CAPABILITIES_META_KEY]: {} },
    } }),
  });
  return res;
}

try {
  const a = await temporaryUser('a', 'America/New_York');
  const b = await temporaryUser('b', 'Europe/London');
  assert.notEqual(a.workspace._id, b.workspace._id);
  report('real WorkOS JWTs create distinct empty Convex workspaces');
  if (foreignIds.length) report('supplied owner posts are unreadable from both temporary workspaces');
  activeStep = 'foreign post rejection';
  const pa = await a.client.mutation(api.posts.createDraft, { source: 'web', parts: [{ text: `Antre check A ${stamp}` }] });
  const pb = await b.client.mutation(api.posts.createDraft, { source: 'web', parts: [{ text: `Antre check B ${stamp}` }] });
  assert.equal((await b.client.query(api.posts.getPosts, { ids: [pa] })).posts[0], null);
  await assert.rejects(b.client.mutation(api.posts.updateDraft, { id: pa, parts: [{ text: 'foreign update' }] }));
  assert.equal((await b.client.query(api.library.page, { view: 'drafts' })).total, 1);
  report('foreign IDs are unreadable and cannot be changed');

  activeStep = 'MCP scoping and revocation';
  const token = `antre_${randomBytes(32).toString('base64url')}`;
  const grant = await a.client.mutation(api.workspaces.createAgentGrant, { label: 'Workspace check', tokenHash: sha256(token) });
  const agent = new ConvexHttpClient(backend.origin, { logger: false });
  const own = await agent.query(api.posts.getPosts, { secret: token, ids: [pa, pb] });
  assert.equal(own.posts[0]?.id, pa);
  assert.equal(own.posts[1], null);
  const response = await mcp(token, 'tools/call', { name: 'get_posts', arguments: { ids: [pa, pb] } });
  assert.equal(response.status, 200);
  const wire = await response.text();
  const payload = JSON.parse(wire.startsWith('event:') ? wire.split('data: ')[1].trim() : wire);
  assert(!payload.result.isError);
  const posts = JSON.parse(payload.result.content[0].text);
  assert.equal(posts[0].id, pa);
  assert.equal(posts[1], null);
  await a.client.mutation(api.workspaces.revokeAgentGrant, { id: grant });
  assert.equal((await mcp(token, 'tools/list')).status, 401);
  report('the live MCP endpoint scopes and revokes personal agent access');

  activeStep = 'media isolation';
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1kAAAAASUVORK5CYII=';
  const uploaded = await a.client.action(api.images.ingest, { bytesBase64: png, contentType: 'image/png' });
  await assert.rejects(b.client.query(api.images.preview, { imageId: uploaded.imageId }));
  await assert.rejects(b.client.mutation(api.posts.updateDraft, { id: pb, parts: [{ text: 'foreign image', imageId: uploaded.imageId }] }));
  await a.client.mutation(api.images.remove, { imageId: uploaded.imageId });
  report('stored media rejects foreign preview and attachment');

  activeStep = 'one-use HTTP upload';
  const uploadUrl = await a.client.mutation(api.images.uploadUrl, {});
  const uploadOptions = { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.from(png, 'base64') };
  const upload = await fetch(uploadUrl, uploadOptions);
  assert.equal(upload.status, 200);
  const { storageId } = await upload.json();
  assert(storageId);
  assert.equal((await a.client.query(api.images.preview, { imageId: storageId })).imageId, storageId);
  await assert.rejects(b.client.query(api.images.preview, { imageId: storageId }));
  assert.equal((await fetch(uploadUrl, uploadOptions)).status, 400);
  await a.client.mutation(api.images.remove, { imageId: storageId });
  report('the HTTP upload registers ownership and consumes its one-use ticket');

  activeStep = 'private session render';
  assert(a.cookie);
  const privatePage = await fetch(new URL('/app', app), { headers: { Cookie: `antre_session=${a.cookie}` }, redirect: 'manual' });
  assert.equal(privatePage.status, 200);
  const html = await privatePage.text();
  assert(html.includes(`Antre check A ${stamp}`));
  assert(!html.includes(`Antre check B ${stamp}`));
  const anonymous = await fetch(new URL('/app', app), { redirect: 'manual' });
  assert.equal(anonymous.status, 303);
  assert(anonymous.headers.get('location')?.startsWith('/login?'));
  report('sealed WorkOS sessions render only the owner’s private app');

  activeStep = 'deletion fencing';
  await a.client.mutation(api.workspaces.deleteWorkspace, {});
  clients.splice(clients.indexOf(a.client), 1);
  await assert.rejects(a.client.query(api.posts.listQueue, {}));
  assert.equal((await b.client.query(api.posts.getPosts, { ids: [pb] })).posts[0]?.id, pb);
  report('deletion fences A while B remains accessible');
} catch (cause) {
  console.error(`FAIL at ${activeStep} after ${checks.length} checks.`);
  if (typeof cause?.status === 'number') console.error(`HTTP status ${cause.status}`);
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled(clients.map(client => client.mutation(api.workspaces.deleteWorkspace, {})));
  const removal = await Promise.allSettled(users.map(id => workos.userManagement.deleteUser(id)));
  if ([...cleanup, ...removal].some(result => result.status === 'rejected')) {
    console.error('Temporary-user cleanup failed; inspect the selected WorkOS environment and temporary workspaces.');
    process.exitCode = 1;
  } else console.log('Temporary WorkOS users removed; workspace cleanup scheduled.');
}

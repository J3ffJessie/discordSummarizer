let _client = null;

function init(client) {
  _client = client;
}

async function notifyAdmin(content) {
  const ADMIN_USER_ID = process.env.ADMIN_USER_ID;
  if (!ADMIN_USER_ID) return;
  try {
    if (!_client) return;
    const user = await _client.users.fetch(ADMIN_USER_ID);
    if (!user) return;
    await user.send({ content: `📣 Admin Notification: ${content}` });
  } catch (err) {
    console.error('Failed to send admin DM:', err?.message || err);
  }
}

async function logError(err, context = '') {
  try {
    if (context) console.error(context, err);
    else console.error(err);
    await notifyAdmin(`${context ? `${context} — ` : ''}${(err && err.message) || String(err)}`);
  } catch (ignore) {
    // swallow
  }
}

module.exports = { init, notifyAdmin, logError };

// Transactional email via Resend. Without RESEND_API_KEY, emails are logged to the console (dev mode).
const FROM = () => process.env.MAIL_FROM || 'ReviewLoom AI <hello@reviewloomai.com>';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sent = []; // last few dev-mode emails, used by tests

async function sendMail({ to, subject, text, html, from, replyTo }) {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[dev mail] to=${to} subject="${subject}"\n${text}\n`);
    sent.push({ to, subject, text, from, replyTo }); if (sent.length > 50) sent.shift();
    return { dev: true };
  }
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: from || FROM(), to: [to], subject, text, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Resend HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`);
  return r.json();
}

const wrap = body => `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2433;line-height:1.55;max-width:520px">${body}<p style="color:#6b7280;font-size:13px">ReviewLoom AI by Bold Forge, LLC &middot; Surprise, AZ</p></div>`;
const button = (href, label) => `<p><a href="${esc(href)}" style="display:inline-block;background:#4f46e5;color:#fff;border-radius:10px;padding:12px 22px;font-weight:700;text-decoration:none">${esc(label)}</a></p>`;

const magicLink = (to, link) => sendMail({
  to, subject: 'Your ReviewLoom AI sign-in link',
  text: `Click to sign in to ReviewLoom AI:\n${link}\n\nThis link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.`,
  html: wrap(`<p>Click below to sign in to ReviewLoom AI.</p>${button(link, 'Sign in')}<p style="font-size:13px;color:#6b7280">This link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.</p>`),
});

const welcome = (to, base) => sendMail({
  to, subject: 'Welcome to ReviewLoom AI',
  text: `Thanks for creating your free ReviewLoom AI account.\n\nYou get 5 free replies a day with your account:\n${base}/#generator\n\nWant unlimited replies, a saved business profile, and reply history? Pro is $9/mo from your account page:\n${base}/account\n\nJust reply to this email if you have questions.`,
  html: wrap(`<p>Thanks for creating your free ReviewLoom AI account.</p><p>You get 5 free replies a day with your account.</p>${button(base + '/#generator', 'Write a reply')}<p>Want unlimited replies, a saved business profile, and reply history? <a href="${esc(base)}/account">Go Pro for $9/mo</a>. Just reply to this email if you have questions.</p>`),
});

const welcomePro = (to, base) => sendMail({
  to, subject: 'You are on ReviewLoom AI Pro',
  text: `Thank you for going Pro!\n\nYou now have unlimited replies, your saved business profile, and reply history. As a Pro member you get priority support: just reply to this email.\n\nGenerate replies: ${base}/#generator\nManage billing anytime from your account: ${base}/account`,
  html: wrap(`<p>Thank you for going Pro!</p><p>You now have unlimited replies, your saved business profile, and reply history. As a Pro member you get priority support: just reply to this email.</p>${button(base + '/#generator', 'Write a reply')}<p>Manage billing anytime from <a href="${esc(base)}/account">your account</a>.</p>`),
});

module.exports = { sendMail, magicLink, welcome, welcomePro, sent };

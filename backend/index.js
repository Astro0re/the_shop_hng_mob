import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import FormData from 'form-data';
import Mailgun from 'mailgun.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigin = process.env.APP_URL || 'http://localhost:5173';
const allowedOrigins = new Set([allowedOrigin, ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)]);
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
app.use(express.json({ limit: '20kb' }));

function isProjectRoot(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash;
  } catch {
    return false;
  }
}

const ready = Boolean(isProjectRoot(process.env.SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY.includes('your-supabase'));
const admin = ready ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const brevoApiKey = process.env.BREVO_API || process.env.BREVO_API_KEY;
const brevoFrom = process.env.BREVO_FROM;
const mailFrom = brevoFrom || process.env.MAILGUN_FROM;
const brevoApiReady = Boolean(brevoApiKey && !brevoApiKey.includes('API_KEY') && brevoFrom);
const brevoSmtpUser = process.env.BREVO_SMTP_USER;
const brevoSmtpKey = process.env.BREVO_SMTP_KEY || process.env.BREVO_SMTP_PASS;
const brevoSmtpReady = Boolean(brevoSmtpUser && brevoSmtpKey && brevoFrom);
let nodemailer = null;
if (brevoSmtpReady) {
  try {
    const nodemailerModule = await import('nodemailer');
    nodemailer = nodemailerModule.default;
  } catch {
    console.warn('Nodemailer is unavailable; using the Brevo API or configured fallback provider.');
  }
}
const brevoSmtp = brevoSmtpReady && nodemailer ? nodemailer.createTransport({
  host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
  port: Number(process.env.BREVO_SMTP_PORT || 587),
  secure: Number(process.env.BREVO_SMTP_PORT || 587) === 465,
  auth: { user: brevoSmtpUser, pass: brevoSmtpKey },
}) : null;
const mailgunApiKey = process.env.MAILGUN_API_KEY || process.env.API_KEY;
const mailgunReady = Boolean(mailgunApiKey && !mailgunApiKey.includes('API_KEY') && process.env.MAILGUN_DOMAIN && process.env.MAILGUN_FROM);
const mailgun = mailgunReady
  ? new Mailgun(FormData).client({
      username: 'api',
      key: mailgunApiKey,
      ...(process.env.MAILGUN_API_URL ? { url: process.env.MAILGUN_API_URL } : {}),
    })
  : null;
const authConfirmationSentAt = new Map();
const emailProvider = brevoSmtp ? 'brevo-smtp' : brevoApiReady ? 'brevo-api' : mailgunReady ? 'mailgun' : null;

app.get('/api/health', (_req, res) => res.json({ ok: true, databaseConfigured: ready, emailConfigured: Boolean(emailProvider), emailProvider }));

async function authenticatedUser(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token || !admin) return res.status(401).json({ error: 'Please sign in to continue.' });
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Your sign-in has expired. Please sign in again.' });
  req.user = user;
  next();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function senderDetails(value) {
  const match = String(value || '').match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  return match ? { email: match[2].trim(), name: match[1].replace(/^"|"$/g, '').trim() || 'The Shop' } : { email: String(value || '').trim(), name: 'The Shop' };
}

function designedEmail({ eyebrow, title, name, intro, rows = [], notice, buttonLabel = 'Visit The Shop' }) {
  const shopUrl = process.env.APP_URL || 'http://localhost:5173';
  const detailsHtml = rows.map(([label, value]) => `<tr><td style="padding:10px 0;color:#74796f;font-size:13px;border-bottom:1px solid #e8e8e1">${escapeHtml(label)}</td><td style="padding:10px 0;color:#272b26;font-size:13px;font-weight:600;text-align:right;border-bottom:1px solid #e8e8e1">${escapeHtml(value)}</td></tr>`).join('');
  const detailsText = rows.length ? `\n${rows.map(([label, value]) => `${label}: ${value}`).join('\n')}\n` : '';
  return {
    html: `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f0;font-family:Arial,sans-serif;color:#272b26"><div style="display:none;max-height:0;overflow:hidden">${escapeHtml(eyebrow)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f5f0;padding:32px 12px"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#fffefa;border:1px solid #e8e8e1"><tr><td style="padding:25px 34px;background:#52684f;color:#fffdf7;font-size:20px;font-weight:700;letter-spacing:-.5px">the shop<span style="color:#d3dbbd">.</span></td></tr><tr><td style="padding:34px"><div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#78836b;font-weight:700">${escapeHtml(eyebrow)}</div><h1 style="margin:12px 0 18px;font-size:28px;line-height:1.25;letter-spacing:-.8px;color:#272b26">${escapeHtml(title)}</h1><p style="margin:0 0 13px;font-size:15px;line-height:1.7">Hi ${escapeHtml(name || 'there')},</p><p style="margin:0;font-size:14px;line-height:1.8;color:#62685f">${escapeHtml(intro)}</p>${rows.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:23px 0;border-top:1px solid #e8e8e1">${detailsHtml}</table>` : ''}${notice ? `<div style="margin:22px 0;padding:15px 16px;background:#eff1e9;border-left:3px solid #849565;color:#515d4b;font-size:13px;line-height:1.7">${escapeHtml(notice)}</div>` : ''}<a href="${escapeHtml(shopUrl)}" style="display:inline-block;margin-top:8px;padding:13px 19px;background:#52684f;color:#fffdf7;text-decoration:none;font-size:13px;font-weight:700">${escapeHtml(buttonLabel)} &nbsp; →</a><p style="margin:28px 0 0;border-top:1px solid #e8e8e1;padding-top:18px;color:#858a80;font-size:12px;line-height:1.7">Good things deserve a second home.<br />The Shop</p></td></tr></table></td></tr></table></body></html>`,
    detailsText,
  };
}

async function sendMail(to, subject, text, html) {
  if (brevoSmtp) {
    await brevoSmtp.sendMail({ from: mailFrom, to, subject, text, ...(html ? { html } : {}) });
    return { sent: true, provider: 'brevo-smtp' };
  }
  if (brevoApiReady) {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': brevoApiKey, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: senderDetails(mailFrom),
        to: [{ email: to }],
        subject,
        textContent: text,
        ...(html ? { htmlContent: html } : {}),
        tags: ['the-shop', 'transactional'],
      }),
    });
    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`Brevo email request failed (${response.status}): ${responseBody.slice(0, 300)}`);
    }
    return { sent: true, provider: 'brevo-api' };
  }
  if (!mailgunReady) return { sent: false };
  await mailgun.messages.create(process.env.MAILGUN_DOMAIN, {
    from: process.env.MAILGUN_FROM,
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });
  return { sent: true, provider: 'mailgun' };
}

app.post('/api/notifications', authenticatedUser, async (req, res) => {
  try {
    if (!ready) return res.status(503).json({ error: 'The marketplace database is not configured yet.' });
    const { action, listingId } = req.body || {};
    if (!['listing_created', 'purchase_inquiry'].includes(action) || typeof listingId !== 'string') return res.status(400).json({ error: 'Invalid notification request.' });
    const { data: listing, error } = await admin.from('listings').select('id,title,price,location,seller_id').eq('id', listingId).single();
    if (error || !listing) return res.status(404).json({ error: 'This listing is no longer available.' });
    if (action === 'listing_created') {
      if (listing.seller_id !== req.user.id) return res.status(403).json({ error: 'You can only confirm your own listing.' });
      const name = req.user.user_metadata?.full_name || 'there';
      const template = designedEmail({ eyebrow: 'Passed on with care', title: 'Your listing is live.', name, intro: `“${listing.title}” is now available in The Shop marketplace.`, rows: [['Listing', listing.title], ['Asking price', new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(listing.price)], ['Neighbourhood', listing.location]], buttonLabel: 'View The Shop' });
      const outcome = await sendMail(req.user.email, 'Your listing is live on The Shop', `Hi ${name},\n\nYour listing “${listing.title}” is now live on The Shop.\n\nThe Shop`, template.html);
      return res.json(outcome);
    }
    if (listing.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot inquire about your own listing.' });
    const { data: sellerData, error: sellerError } = await admin.auth.admin.getUserById(listing.seller_id);
    if (sellerError || !sellerData?.user?.email) return res.status(404).json({ error: 'The seller could not be reached.' });
    const buyerName = req.user.user_metadata?.full_name || req.user.email;
    const price = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(listing.price);
    const buyerTemplate = designedEmail({ eyebrow: 'Before you pay', title: 'Your order inquiry is confirmed.', name: req.user.user_metadata?.full_name || 'there', intro: `We’ve sent your interest in “${listing.title}” to the seller. They can reply to you at ${req.user.email}.`, rows: [['Find', listing.title], ['Listed price', price], ['Collection area', listing.location]], notice: 'This confirms your inquiry only. The Shop has not taken payment and the item is not reserved. Please agree on payment and collection directly with the seller before paying.', buttonLabel: 'Continue browsing' });
    const sellerTemplate = designedEmail({ eyebrow: 'A neighbour is interested', title: 'Someone likes your find.', name: sellerData.user.user_metadata?.full_name || 'there', intro: `${buyerName} (${req.user.email}) is interested in your listing. You can reply to them directly to arrange next steps.`, rows: [['Find', listing.title], ['Listed price', price], ['Collection area', listing.location]], notice: 'No payment has been taken and the listing has not been reserved. Please arrange payment and collection directly with the buyer.', buttonLabel: 'Visit The Shop' });
    const buyerText = `Hi ${req.user.user_metadata?.full_name || 'there'},\n\nYour inquiry for “${listing.title}” (${price}) has been sent to the seller. They can reply to you at ${req.user.email}.\n\nThis confirms your inquiry only. The Shop has not taken payment and the item is not reserved. Arrange payment and collection directly with the seller before paying.\n\nThe Shop`;
    const sellerText = `Hi ${sellerData.user.user_metadata?.full_name || 'there'},\n\n${buyerName} (${req.user.email}) is interested in “${listing.title}” (${price}). Reply to them directly to arrange next steps.\n\nNo payment has been taken and the listing has not been reserved.\n\nThe Shop`;
    await Promise.all([sendMail(req.user.email, 'Your pre-payment order inquiry — The Shop', buyerText, buyerTemplate.html), sendMail(sellerData.user.email, `Someone is interested in ${listing.title} — The Shop`, sellerText, sellerTemplate.html)]);
    return res.json({ sent: mailgunReady });
  } catch (error) {
    console.error('Notification failed:', error.message);
    return res.status(502).json({ error: error.message || 'Could not send confirmation email.' });
  }
});

app.post('/api/auth-confirmations', authenticatedUser, async (req, res) => {
  try {
    const { action } = req.body || {};
    if (!['signup', 'signin'].includes(action)) return res.status(400).json({ error: 'Invalid sign-in confirmation request.' });
    if (!req.user.email) return res.status(400).json({ error: 'There is no email address on this account.' });

    const dedupeKey = `${req.user.id}:${action}`;
    const sentAt = authConfirmationSentAt.get(dedupeKey) || 0;
    if (Date.now() - sentAt < 60_000) return res.json({ sent: true, deduplicated: true });

    const name = req.user.user_metadata?.full_name || 'there';
    const isSignup = action === 'signup';
    const subject = isSignup ? 'Your The Shop account is ready' : 'Your sign-in to The Shop is confirmed';
    const text = isSignup
      ? `Hi ${name},\n\nYour The Shop account has been created. Because you signed in with Google, Google confirms your email address as part of that process; you do not need to follow a separate verification link.\n\nIf you did not create this account, secure your Google account and contact us.\n\nThe Shop`
      : `Hi ${name},\n\nThis is a confirmation that your account was just used to sign in to The Shop.\n\nIf this was not you, secure your Google account and contact us.\n\nThe Shop`;
    const template = isSignup
      ? designedEmail({ eyebrow: 'Welcome to the neighbourhood', title: 'Your account is ready.', name, intro: 'Your The Shop account has been created with Google.', notice: 'Google confirms your email as part of sign-in, so there is no separate verification link to follow.', buttonLabel: 'Explore The Shop' })
      : designedEmail({ eyebrow: 'Account security', title: 'Your sign-in is confirmed.', name, intro: 'Your account was just used to sign in to The Shop.', notice: 'If this was not you, secure your Google account and contact us.', buttonLabel: 'Visit The Shop' });
    const outcome = await sendMail(req.user.email, subject, text, template.html);
    if (outcome.sent) {
      authConfirmationSentAt.set(dedupeKey, Date.now());
      if (authConfirmationSentAt.size > 1000) {
        const cutoff = Date.now() - 60_000;
        for (const [key, timestamp] of authConfirmationSentAt) if (timestamp < cutoff) authConfirmationSentAt.delete(key);
      }
    }
    return res.json(outcome);
  } catch (error) {
    console.error('Sign-in confirmation failed:', error.message);
    return res.status(502).json({ error: error.message || 'Could not send the sign-in confirmation email.' });
  }
});

app.listen(port, () => console.log(`The Shop API listening on http://localhost:${port}`));

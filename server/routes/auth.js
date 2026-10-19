// Signing in with Google is the login: the Gmail account you pick is your account.
import crypto from 'node:crypto';
import { Router } from 'express';
import config from '../config/index.js';
import User from '../models/User.js';
import { getAuthUrl, exchangeCode, storeTokensForUser, getConnectionStatus, disconnect } from '../services/gmailService.js';

const router = Router();
const back = (query) => `${config.clientUrl}/?${query}`;

router.get('/google', (req, res, next) => {
  try {
    // Checked in the callback so a login redirect can't be forged.
    const state = crypto.randomBytes(16).toString('hex');
    // Built before saving: an error inside the save callback would escape this try/catch and crash the server.
    const url = getAuthUrl(state);
    req.session.oauthState = state;
    req.session.save((err) => (err ? next(err) : res.redirect(url)));
  } catch (err) {
    next(err);
  }
});

router.get('/google/callback', async (req, res) => {
  const { code, error, state } = req.query;
  if (error || !code) return res.redirect(back(`gmail=error&reason=${encodeURIComponent(error || 'missing_code')}`));
  if (!state || state !== req.session.oauthState) {
    return res.redirect(back('gmail=error&reason=' + encodeURIComponent('Login expired or was started elsewhere – please try again.')));
  }

  try {
    const { email, tokens } = await exchangeCode(code);
    const user = await User.findOneAndUpdate(
      { email },
      { $set: { lastLoginAt: new Date() }, $setOnInsert: { email } },
      { upsert: true, new: true }
    );
    await storeTokensForUser(user._id, email, tokens);

    // Fresh session id on login to prevent session fixation.
    req.session.regenerate((err) => {
      if (err) return res.redirect(back('gmail=error&reason=session_error'));
      req.session.userId = String(user._id);
      req.session.email = email;
      req.session.save(() => {
        console.log(`[auth] Signed in: ${email}`);
        res.redirect(back('gmail=connected'));
      });
    });
  } catch (err) {
    console.error('[auth] OAuth callback failed:', err.message);
    res.redirect(back(`gmail=error&reason=${encodeURIComponent(err.message)}`));
  }
});

router.get('/status', async (req, res, next) => {
  try {
    const { userId, email } = req.session || {};
    if (!userId) return res.json({ loggedIn: false, connected: false, email: null, needsReconnect: false });
    const gmail = await getConnectionStatus(userId);
    res.json({ loggedIn: true, ...gmail, email });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(config.session.cookieName);
    res.json({ loggedIn: false });
  });
});

router.post('/disconnect', async (req, res, next) => {
  try {
    if (req.session?.userId) await disconnect(req.session.userId);
    req.session.destroy(() => {
      res.clearCookie(config.session.cookieName);
      res.json({ loggedIn: false, connected: false });
    });
  } catch (err) {
    next(err);
  }
});

export default router;

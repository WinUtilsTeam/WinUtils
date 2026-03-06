const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe')('sk_test_51T7uFBPkFMgdlUgaiZ7wej1hXoJHKmJSOdrU2mTdrR6Cqm1CrQm73VD1s7J48Z51FY4AvrMeh1JPXejMWo6aMnrJ00sTulxYmS');

admin.initializeApp();
const db = admin.firestore();

// ═══════════════════════════════════════════════════════════
// Create Stripe Checkout Session (called from website)
// ═══════════════════════════════════════════════════════════
exports.createCheckoutSession = functions.https.onRequest(async (req, res) => {
    // CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { return res.status(204).send(''); }

    const { uid, email } = req.body;
    if (!uid || !email) {
        return res.status(400).json({ error: 'Missing uid or email' });
    }

    try {
        // Create or reuse Stripe customer
        const userRef = db.collection('users').doc(uid);
        const userDoc = await userRef.get();
        let customerId = userDoc.exists ? userDoc.data().stripeCustomerId : null;

        if (!customerId) {
            const customer = await stripe.customers.create({ email, metadata: { firebaseUID: uid } });
            customerId = customer.id;
            await userRef.update({ stripeCustomerId: customerId });
        }

        // Create Checkout Session for $3/month subscription
        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'WinUtils Pro', description: 'Unlimited usage, all tools, early updates' },
                    unit_amount: 300, // $3.00
                    recurring: { interval: 'month' }
                },
                quantity: 1
            }],
            success_url: `${req.headers.origin || 'https://your-domain.com'}?session_id={CHECKOUT_SESSION_ID}&status=success`,
            cancel_url: `${req.headers.origin || 'https://your-domain.com'}?status=cancelled`,
            metadata: { firebaseUID: uid }
        });

        res.json({ sessionId: session.id });
    } catch (error) {
        console.error('Checkout session error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════
// Stripe Webhook Handler
// ═══════════════════════════════════════════════════════════
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // In production, set this via: firebase functions:config:set stripe.webhook_secret="whsec_..."
        const webhookSecret = functions.config().stripe?.webhook_secret || 'whsec_YOUR_WEBHOOK_SECRET';
        event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const session = event.data.object;

    switch (event.type) {
        case 'checkout.session.completed': {
            const uid = session.metadata?.firebaseUID;
            if (uid) {
                await db.collection('users').doc(uid).update({
                    plan: 'pro',
                    subscriptionStatus: 'active',
                    stripeCustomerId: session.customer
                });
            } else {
                await handleSubscriptionChange(session.customer, 'pro', 'active');
            }
            break;
        }
        case 'invoice.payment_succeeded':
            await handleSubscriptionChange(session.customer, 'pro', 'active');
            break;
        case 'invoice.payment_failed':
            await handleSubscriptionChange(session.customer, 'free', 'past_due');
            break;
        case 'customer.subscription.deleted':
            await handleSubscriptionChange(session.customer, 'free', 'cancelled');
            break;
    }

    res.json({ received: true });
});

// ═══════════════════════════════════════════════════════════
// API: Verify User & Get Status (called from desktop app)
// ═══════════════════════════════════════════════════════════
exports.verifyUser = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const uid = context.auth.uid;
    const userDoc = await db.collection('users').doc(uid).get();

    if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User profile not found.');
    }

    const userData = userDoc.data();

    // Check for daily usage reset
    const now = new Date();
    const lastReset = userData.lastUsageReset ? userData.lastUsageReset.toDate() : new Date(0);

    if (now.toDateString() !== lastReset.toDateString()) {
        await db.collection('users').doc(uid).update({
            dailyUsageMinutes: 0,
            lastUsageReset: admin.firestore.FieldValue.serverTimestamp()
        });
        userData.dailyUsageMinutes = 0;
    }

    return {
        plan: userData.plan || 'free',
        subscriptionStatus: userData.subscriptionStatus || 'inactive',
        proAccess: userData.plan === 'pro' || userData.grantedProAccess === true,
        dailyMinutesRemaining: Math.max(0, 20 - (userData.dailyUsageMinutes || 0)),
        banned: userData.banned || false,
        piracyFlag: userData.piracyFlag || false
    };
});

// ═══════════════════════════════════════════════════════════
// API: Report Usage
// ═══════════════════════════════════════════════════════════
exports.reportUsage = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be logged in.');
    }

    const uid = context.auth.uid;
    const minutesUsed = data.minutesUsed || 1;

    await db.collection('users').doc(uid).update({
        dailyUsageMinutes: admin.firestore.FieldValue.increment(minutesUsed)
    });

    return { success: true };
});

// ═══════════════════════════════════════════════════════════
// API: Check for Updates (called from desktop app)
// ═══════════════════════════════════════════════════════════
exports.checkUpdate = functions.https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.json({
        latestVersion: '1.0.0',
        downloadUrl: 'https://your-domain.com/WinUtils.exe',
        required: false
    });
});

// ═══════════════════════════════════════════════════════════
// Admin Commands (callable functions)
// ═══════════════════════════════════════════════════════════
exports.adminCommand = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }

    // Verify admin
    const adminDoc = await db.collection('admins').doc(context.auth.uid).get();
    if (!adminDoc.exists) {
        throw new functions.https.HttpsError('permission-denied', 'Not an admin.');
    }

    const { command, targetUid, reason } = data;
    const targetRef = db.collection('users').doc(targetUid);

    switch (command) {
        case 'grant-pro':
            await targetRef.update({ grantedProAccess: true, plan: 'pro' });
            return { success: true, message: `Granted Pro to ${targetUid}` };
        case 'revoke-pro':
            await targetRef.update({ grantedProAccess: false, plan: 'free' });
            return { success: true, message: `Revoked Pro from ${targetUid}` };
        case 'ban':
            await targetRef.update({ banned: true, banReason: reason || 'No reason provided' });
            return { success: true, message: `Banned ${targetUid}` };
        case 'unban':
            await targetRef.update({ banned: false, banReason: null });
            return { success: true, message: `Unbanned ${targetUid}` };
        case 'reset-usage':
            await targetRef.update({ dailyUsageMinutes: 0, lastUsageReset: admin.firestore.FieldValue.serverTimestamp() });
            return { success: true, message: `Reset usage for ${targetUid}` };
        case 'flag-piracy':
            await targetRef.update({ piracyFlag: true });
            return { success: true, message: `Flagged ${targetUid} for piracy` };
        case 'view':
            const doc = await targetRef.get();
            if (!doc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
            return { success: true, user: doc.data() };
        default:
            throw new functions.https.HttpsError('invalid-argument', `Unknown command: ${command}`);
    }
});

// ═══════════════════════════════════════════════════════════
// Helper: Update user by Stripe customer ID
// ═══════════════════════════════════════════════════════════
async function handleSubscriptionChange(stripeCustomerId, plan, status) {
    const usersSnap = await db.collection('users').where('stripeCustomerId', '==', stripeCustomerId).limit(1).get();
    if (!usersSnap.empty) {
        const userDoc = usersSnap.docs[0];
        await userDoc.ref.update({ plan, subscriptionStatus: status });
    }
}

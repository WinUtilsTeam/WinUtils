# WinUtils — Complete Deployment Guide

## Prerequisites
- A Google account
- Node.js 18+ installed
- Firebase CLI: `npm install -g firebase-tools`

---

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **"Add project"** → Name it **"winutils"**
3. Disable Google Analytics (optional) → Click **Create Project**
4. Once created, click the ⚙ **Settings** gear → **Project settings**
5. Scroll to **"Your apps"** → Click the **Web** icon `</>`
6. Register with nickname: **"WinUtils Web"**
7. **Copy the config object** — you'll need these values:
   ```js
   apiKey: "...",
   authDomain: "...",
   projectId: "...",
   storageBucket: "...",
   messagingSenderId: "...",
   appId: "..."
   ```

## Step 2: Enable Authentication

1. In Firebase Console → **Authentication** → **Sign-in method**
2. Enable **Google** provider
3. Set your support email and save

## Step 3: Create Firestore Database

1. In Firebase Console → **Firestore Database** → **Create database**
2. Choose **production mode**
3. Pick your region (e.g., us-central1)
4. Once created, deploy the security rules:
   ```bash
   cd backend
   firebase deploy --only firestore:rules
   ```

## Step 4: Add Your Firebase Config to the Website

Open `website/index.html` and replace the placeholder config block (around line 240):

```js
const firebaseConfig = {
    apiKey: "YOUR_REAL_API_KEY",
    authDomain: "winutils-XXXXX.firebaseapp.com",
    projectId: "winutils-XXXXX",
    storageBucket: "winutils-XXXXX.appspot.com",
    messagingSenderId: "XXXXXXXXXXXX",
    appId: "1:XXXXXXXXXXXX:web:XXXXXXXXXXXXXX"
};
```

Do the same in `admin/index.html`.

## Step 5: Deploy Cloud Functions

```bash
cd backend
firebase login
firebase init functions  # Select your project, choose JavaScript
# Copy functions/index.js and functions/package.json into the generated functions/ folder
firebase deploy --only functions
```

## Step 6: Set Up Stripe Webhook

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"**
3. Enter URL: `https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/stripeWebhook`
4. Select events:
   - `checkout.session.completed`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
5. Copy the **Webhook Signing Secret** (`whsec_...`)
6. Update it in `backend/functions/index.js` on the webhook handler line

## Step 7: Make Yourself Admin

In Firestore Console, manually create:
```
Collection: admins
Document ID: YOUR_FIREBASE_UID
Fields: { role: "owner" }
```

## Step 8: Deploy Website

Upload the `website/` folder to:
- **GitHub Pages** (free)
- **Vercel** (free)
- **Netlify** (free)
- **Firebase Hosting** (`firebase deploy --only hosting`)

Upload the `admin/` folder separately or at `/admin` path.

## Stripe Keys (Already Configured)

| Key | Value |
|-----|-------|
| Publishable | `pk_test_51T7uFB...` (in website/index.html) |
| Secret | `sk_test_51T7uFB...` (in backend/functions/index.js) |

> ⚠️ **Important**: When going to production, replace `pk_test_` and `sk_test_` keys with your live Stripe keys (`pk_live_` and `sk_live_`).

## Step 9: Build Desktop App

```bash
cd app
pip install PySide6 psutil requests pyinstaller
python -m PyInstaller --onefile --windowed --add-data "tools;tools" --add-data "core;core" main.py
```

The executable will be at `app/dist/main.exe`.

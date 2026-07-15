# Sentry Mobile Integration Plan (Placeholder)

Status: **Deferred — do not implement until EAS Build is configured**

This document describes the steps required to add `@sentry/react-native` to the
Expo/EAS mobile app. No code changes have been made to the app. The Expo build
pipeline (`app.json`, `eas.json`, `metro.config.js`) is untouched.

---

## Prerequisites before starting

1. **EAS Build configured** — the `@sentry/react-native` native module requires a
   native build step (`sentry-expo` or the bare Sentry wizard). Managed Expo Go
   builds do **not** support it.
2. **Sentry project created** — create a React Native project in your Sentry
   organisation at sentry.io and note the DSN.
3. **Auth token** — generate a Sentry auth token with `project:releases` and
   `org:read` scopes. Needed for source-map upload during builds.

---

## Integration steps (when prerequisites are met)

### 1. Install the package

```bash
cd mobile
npx expo install @sentry/react-native
```

Use `expo install` (not `npm install`) to pick an Expo-compatible version.

### 2. Run the Sentry wizard (optional but recommended)

```bash
npx @sentry/wizard -i reactNative
```

The wizard patches `app.json`, `metro.config.js`, and `App.tsx` automatically.
Review every change it makes before committing.

### 3. Manual patches (if wizard not used)

**`mobile/app.json`** — add the Sentry plugin:
```json
{
  "expo": {
    "plugins": [
      [
        "@sentry/react-native/expo",
        {
          "url": "https://sentry.io/",
          "project": "<YOUR_SENTRY_PROJECT_SLUG>",
          "organization": "<YOUR_SENTRY_ORG_SLUG>"
        }
      ]
    ]
  }
}
```

**`mobile/metro.config.js`** — wrap the config with Sentry:
```js
const { getSentryExpoConfig } = require('@sentry/react-native/metro');
const config = getSentryExpoConfig(__dirname);
module.exports = config;
```

**`mobile/App.tsx`** — initialise Sentry before any other code runs:
```tsx
import * as Sentry from '@sentry/react-native';

// TODO: Set SENTRY_DSN in EAS secrets / eas.json env block
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    environment: __DEV__ ? 'development' : 'production',
    tracesSampleRate: 0.1,
  });
}
```

### 4. Wrap the root component

```tsx
export default Sentry.wrap(App);
```

### 5. EAS Build secrets

Add the DSN as an EAS secret so it is available at build time:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_SENTRY_DSN --value "<dsn>"
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value "<auth-token>"
```

Reference in `eas.json`:
```json
{
  "build": {
    "production": {
      "env": {
        "EXPO_PUBLIC_SENTRY_DSN": "$EXPO_PUBLIC_SENTRY_DSN",
        "SENTRY_AUTH_TOKEN": "$SENTRY_AUTH_TOKEN"
      }
    }
  }
}
```

### 6. Source maps

Source maps are uploaded automatically during `eas build` when `SENTRY_AUTH_TOKEN`
is present and the `app.json` plugin is configured. Verify uploads in the Sentry
dashboard under **Releases**.

---

## Files that will change (none changed yet)

| File | Change |
|------|--------|
| `mobile/package.json` | adds `@sentry/react-native` |
| `mobile/app.json` | adds Sentry expo plugin |
| `mobile/metro.config.js` | wraps config with `getSentryExpoConfig` |
| `mobile/App.tsx` | `Sentry.init()` + `Sentry.wrap(App)` |
| `mobile/eas.json` | env block for DSN + auth token |

The existing `ErrorBoundary` component (`mobile/src/components/ErrorBoundary.tsx`)
already captures React render errors and logs them. When Sentry is added,
`componentDidCatch` should additionally call `Sentry.captureException(error)`.

---

## Do NOT do yet

- `expo install @sentry/react-native` — will fail in Expo Go without EAS
- Modify `app.json` or `metro.config.js` — changes the build pipeline
- Add `Sentry.init()` to `App.tsx` — import will crash in Expo Go

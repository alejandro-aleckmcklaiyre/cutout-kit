# Cutout Kit

Run npm ci, then npm run dev to open the editor. Run npm run build to verify a production build.

## Hosted sign-in

Create a Clerk application for Cutout Kit and set VITE_CLERK_PUBLISHABLE_KEY in .env.local for local testing or in the Vercel build environment for deployment. Use the publishable key only. The Vercel build uses the Vite preset and serves dist.

With a key, Clerk handles sign-in and account identity. Images, masks, and editable projects stay in IndexedDB in the current browser. Without a key, the app uses the existing local profiles. Back up any projects from your local profile before switching to Clerk, then restore them into your Clerk profile.

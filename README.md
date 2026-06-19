# PlayRight

Keyboard-controlled piano practice in the browser - practice one hand or both, or use **play mode** to hear the full piece with tempo control.

The app lives in [`playright/`](playright/). See [`playright/README.md`](playright/README.md) for setup, features, keyboard shortcuts, and deployment.

## Quick start

From the repository root:

```bash
npm install
cd playright && npm install && npm run dev
```

## Repository layout

| Path | Purpose |
|------|---------|
| `playright/` | React + Vite application (deploy this folder to Vercel) |
| `package.json` | Shared dependencies used by the app (e.g. OpenSheetMusicDisplay) |
| `playright/supabase/` | SQL helpers for the score library |

## License

Private project.

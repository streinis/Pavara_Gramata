# Pavāra Grāmata — Web App

A recipe book web app built with Flask + vanilla JS.

---

## Folder structure

```
recipe_web/
├── app.py               ← Flask backend (all API routes)
├── requirements.txt     ← Python dependencies
├── Dockerfile           ← For Cloud Run deployment
├── recipes.json         ← Created automatically on first run
├── templates/
│   └── index.html       ← Single-page app shell
└── static/
    ├── css/style.css    ← All styles
    └── js/app.js        ← All frontend logic
```

---

## Run locally

### 1. Install Python dependencies
```bash
pip install -r requirements.txt
```

### 2. (Optional) Copy your existing recipes
If you have a `recipes.json` from the desktop app, copy it into this folder.

### 3. Start the server
```bash
python app.py
```

### 4. Open in browser
```
http://localhost:5000
```

---

## Deploy to Google Cloud Run (free tier)

### Prerequisites
- [Google Cloud account](https://cloud.google.com) (free)
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed
- [Docker](https://www.docker.com/products/docker-desktop/) installed

### Step 1 — log in and set project
```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
```

### Step 2 — enable required APIs
```bash
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com
```

### Step 3 — deploy (builds and deploys in one command)
```bash
gcloud run deploy pavara-gramata \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --platform managed
```

After ~2 minutes you'll get a live URL like:
```
https://pavara-gramata-xxxxxxxx-ew.a.run.app
```

### Step 4 — (important) switch to Firestore for persistent storage

Cloud Run is stateless — `recipes.json` will be wiped on restarts.
Replace file storage with Firestore:

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Search "Firestore" → Create database → Native mode → choose a region
3. Install the Firestore client:
   ```bash
   pip install google-cloud-firestore
   ```
4. In `app.py`, replace the `get_recipes` / `save_all` functions with:

```python
from google.cloud import firestore
db = firestore.Client()

def get_recipes():
    docs = db.collection("recipes").stream()
    return [{"id": int(d.id), **d.to_dict()} for d in docs]

def save_all(data):
    batch = db.batch()
    # Delete all then rewrite (simple approach)
    existing = db.collection("recipes").stream()
    for doc in existing:
        batch.delete(doc.reference)
    for r in data:
        ref = db.collection("recipes").document(str(r["id"]))
        batch.set(ref, r)
    batch.commit()
```

---

## Environment variables

| Variable | Default | Description          |
|----------|---------|----------------------|
| `PORT`   | `5000`  | Port the server runs on |

---

## Adding a custom domain (optional, free)

After deploying to Cloud Run:
1. Cloud Run → your service → Custom Domains → Add mapping
2. Follow the DNS verification steps for your domain provider

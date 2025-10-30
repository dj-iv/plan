# Firebase Storage CORS configuration

The production site (`https://plan.uctel.co.uk`) fetches floorplan images directly from Firebase Storage. The bucket must explicitly allow that origin; otherwise browsers block the request with a CORS error (`No 'Access-Control-Allow-Origin' header`).

## Prerequisites

- Google Cloud SDK (`gcloud` / `gsutil`) installed and authenticated against the project that owns the `plan-13b4e` Firebase bucket.
- Project ID: `plan-13b4e`
- Storage bucket: `plan-13b4e.firebasestorage.app`

## Apply the CORS policy

```bash
# Run from repository root (or provide absolute path)
gsutil cors set firebase/storage-cors.json gs://plan-13b4e.firebasestorage.app

# Verify
 gsutil cors get gs://plan-13b4e.firebasestorage.app
```

The `firebase/storage-cors.json` file currently allows the following origins:

- `http://localhost:3303` (floorplan local development)
- `http://localhost:3300` (portal-based local workflows)
- `https://plan.uctel.co.uk` (production)

The policy exposes common headers required for authenticated fetches and caches pre-flight responses for 1 hour.

> **Tip:** Re-run the `gsutil cors set` command whenever you add more environments or domains.

import "dotenv/config";
import admin from "firebase-admin";
import path from "path";
import fs from "fs";

/**
 * Script to delete Firestore project documents (and related storage assets)
 * that are not part of the allowed list. Run with: npm run cleanup-projects
 */
async function main() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT || "./firebase-adminsdk.json";
  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`Service account file not found at ${serviceAccountPath}`);
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    });
  }

  const firestore = admin.firestore();
  const storage = admin.storage().bucket();

  const allowedProjectsEnv = process.env.ALLOWED_PROJECT_IDS || "";
  const allowedIds = allowedProjectsEnv
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  if (allowedIds.length === 0) {
    console.error("No ALLOWED_PROJECT_IDS provided. Aborting to avoid deleting everything.");
    process.exit(1);
  }

  console.log("Allowed project IDs:", allowedIds);

  const projectsCol = firestore.collection("projects");
  const snapshot = await projectsCol.get();

  if (snapshot.empty) {
    console.log("No projects found in Firestore.");
    return;
  }

  let deletedCount = 0;
  let skippedCount = 0;

  for (const doc of snapshot.docs) {
    const projectId = doc.id;
    if (allowedIds.includes(projectId)) {
      skippedCount += 1;
      continue;
    }

    console.log(`Deleting project ${projectId}`);

    // Delete floors subcollection if exists
    const floorsCol = projectsCol.doc(projectId).collection("floors");
    const floorsSnap = await floorsCol.get();
    for (const floorDoc of floorsSnap.docs) {
      await floorDoc.ref.delete();
    }

    await doc.ref.delete();
    deletedCount += 1;

    // Delete storage files under project folder
    const prefixes = [
      `projects/${projectId}/`,
      `projects/${projectId}/floors/`,
    ];

    for (const prefix of prefixes) {
      const [files] = await storage.getFiles({ prefix });
      await Promise.all(files.map((file) => file.delete().catch(() => undefined)));
    }
  }

  console.log(`Cleanup complete. Deleted ${deletedCount} projects. Skipped ${skippedCount} projects.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

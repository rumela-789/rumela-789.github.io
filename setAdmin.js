// ব্যবহার: GOOGLE_APPLICATION_CREDENTIALS=key.json node setAdmin.js <UID>
const admin = require("firebase-admin"); admin.initializeApp();
admin.auth().setCustomUserClaims(process.argv[2], {admin: true}).then(() => console.log("done"));

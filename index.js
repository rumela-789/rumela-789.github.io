const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentDeleted} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore(), bucket = () => admin.storage().bucket();
const need = r => { if (!r.auth || r.auth.token.admin !== true) throw new HttpsError("permission-denied", "Admins only"); };
const cnt = async q => (await q.count().get()).data().count;
const rmFile = p => p ? bucket().file(p).delete({ignoreNotFound: true}).catch(() => {}) : null;

// অ্যাডমিন পরিসংখ্যান (অ্যানালিটিক্স)
exports.adminStats = onCall(async r => {
  need(r);
  const now = Date.now(), D = 86400000, c = n => db.collection(n);
  const [users, active24, active7, posts, posts7, comments, stories, rs] = await Promise.all([
    cnt(c("profiles")), cnt(c("profiles").where("lastActive", ">", now - D)),
    cnt(c("profiles").where("lastActive", ">", now - 7 * D)), cnt(c("posts")),
    cnt(c("posts").where("ts", ">", now - 7 * D)), cnt(c("comments")),
    cnt(c("stories").where("exp", ">", now)), c("reports").limit(500).get()]);
  const t = {}; rs.docs.forEach(d => { const k = String(d.data().target || ""); t[k] = (t[k] || 0) + 1; });
  const reports = Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([target, n]) => ({target, n}));
  return {users, active24, active7, posts, posts7, comments, stories, reports};
});
exports.adminDeletePost = onCall(async r => {
  need(r);
  const id = String(r.data.id || ""); if (!id) throw new HttpsError("invalid-argument", "id");
  await Promise.all(["posts", "imgs", "voices"].map(c => db.doc(c + "/" + id).delete()));
  return {ok: true};
});
exports.adminSetVerified = onCall(async r => {
  need(r);
  const uid = String(r.data.uid || ""); if (!uid) throw new HttpsError("invalid-argument", "uid");
  await db.doc("profiles/" + uid).set({verified: r.data.verified === true}, {merge: true});
  return {ok: true};
});

// শিডিউল পোস্ট: প্রতি ৫ মিনিটে সময় হওয়া পোস্ট প্রকাশ করে
exports.publishScheduled = onSchedule("every 5 minutes", async () => {
  const q = await db.collection("scheduled").where("at", "<=", Date.now()).limit(100).get();
  const b = db.batch();
  q.docs.forEach(d => { const x = d.data(); b.set(db.doc("posts/" + d.id), {...x, ts: x.at}); b.delete(d.ref); });
  if (!q.empty) await b.commit();
});
// মেয়াদোত্তীর্ণ স্টোরি মোছে (মালিক অ্যাপ না খুললেও)
exports.cleanupStories = onSchedule("every 60 minutes", async () => {
  const q = await db.collection("stories").where("exp", "<", Date.now()).limit(200).get();
  await Promise.all(q.docs.map(async d => { await rmFile(d.data().path); await d.ref.delete(); }));
});
// পোস্ট মুছলে Storage-এর ছবি/ভিডিও-ও মোছে
exports.postCleanup = onDocumentDeleted("posts/{id}", async e => {
  const x = e.data && e.data.data(); if (!x) return;
  await rmFile(x.vpath); await rmFile("imgs/" + x.uid + "/" + e.params.id + ".jpg");
});

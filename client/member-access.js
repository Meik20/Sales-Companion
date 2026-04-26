import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

/* =========================================================
   INITIALISATION
========================================================= */
const db = getFirestore();
const auth = getAuth();

/* =========================================================
   ELEMENTS DOM - CREATION ACCES
========================================================= */
const firstnameInput = document.getElementById("new-access-firstname");
const lastnameInput = document.getElementById("new-access-lastname");
const companyInput = document.getElementById("new-access-company");
const preview = document.getElementById("new-access-preview");
const createAccessBtn = document.getElementById("create-access-btn");
const toast = document.getElementById("toast");

/* =========================================================
   ELEMENTS DOM - ACTIVATION
========================================================= */
const activationAccessIdInput = document.getElementById("activation-access-id");
const activationPasswordInput = document.getElementById("activation-new-password");
const activationConfirmPasswordInput = document.getElementById("activation-confirm-password");
const activateAccessBtn = document.getElementById("activate-access-btn");
const activationErr = document.getElementById("activation-err");

/* =========================================================
   TOAST
========================================================= */
function showToast(message, type = "info") {
  if (!toast) {
    console.log(`[${type.toUpperCase()}] ${message}`);
    return;
  }

  toast.textContent = message;
  toast.className = "toast show";

  if (type === "error") {
    toast.style.background = "#d32f2f";
    toast.style.color = "#fff";
  } else if (type === "success") {
    toast.style.background = "#2e7d32";
    toast.style.color = "#fff";
  } else {
    toast.style.background = "#333";
    toast.style.color = "#fff";
  }

  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => {
    toast.className = "toast";
  }, 3000);
}

/* =========================================================
   AFFICHAGE ERREUR ACTIVATION
========================================================= */
function setActivationError(message = "") {
  if (!activationErr) return;

  activationErr.textContent = message;
  activationErr.style.display = message ? "block" : "none";
}

/* =========================================================
   UTILITAIRES
========================================================= */
function normalizeText(text) {
  return (text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function buildAccessId(firstname, lastname, company) {
  const first = normalizeText(firstname);
  const last = normalizeText(lastname);
  const comp = normalizeText(company);

  if (!first && !last && !comp) return "@entreprise";
  return `${first}${last}@${comp}`;
}

function normalizeTextAccessId(accessId) {
  if (!accessId) return "";

  const parts = accessId.split("@");
  if (parts.length !== 2) {
    return accessId.trim().toLowerCase();
  }

  const left = normalizeText(parts[0]);
  const right = normalizeText(parts[1]);

  return `${left}@${right}`;
}

function clearCreateAccessForm() {
  if (firstnameInput) firstnameInput.value = "";
  if (lastnameInput) lastnameInput.value = "";
  if (companyInput) companyInput.value = "";
  updateAccessPreview();
}

function clearActivationForm() {
  if (activationAccessIdInput) activationAccessIdInput.value = "";
  if (activationPasswordInput) activationPasswordInput.value = "";
  if (activationConfirmPasswordInput) activationConfirmPasswordInput.value = "";
}

function getCurrentManagerUid() {
  const user = auth.currentUser;
  return user ? user.uid : null;
}

/* =========================================================
   APERCU DYNAMIQUE
========================================================= */
function updateAccessPreview() {
  if (!preview) return;

  const firstname = firstnameInput?.value || "";
  const lastname = lastnameInput?.value || "";
  const company = companyInput?.value || "";

  if (!firstname && !lastname && !company) {
    preview.textContent = "@Entreprise";
    return;
  }

  preview.textContent = buildAccessId(firstname, lastname, company);
}

/* =========================================================
   COMPTER LES ACCES CREES PAR LE MANAGER
========================================================= */
async function countManagerAccesses(managerUid) {
  const q = query(
    collection(db, "team_accesses"),
    where("createdBy", "==", managerUid)
  );

  const snap = await getDocs(q);
  return snap.size;
}

/* =========================================================
   CREATION D'UN ACCES MEMBRE
========================================================= */
async function createMemberAccess() {
  try {
    const managerUid = getCurrentManagerUid();

    if (!managerUid) {
      showToast("Vous devez être connecté en tant que manager.", "error");
      return;
    }

    const firstname = firstnameInput?.value.trim() || "";
    const lastname = lastnameInput?.value.trim() || "";
    const company = companyInput?.value.trim() || "";

    if (!firstname || !lastname || !company) {
      showToast("Veuillez remplir prénom, nom et entreprise.", "error");
      return;
    }

    const accessId = buildAccessId(firstname, lastname, company);

    if (!accessId || accessId === "@entreprise") {
      showToast("Impossible de générer un identifiant valide.", "error");
      return;
    }

    if (createAccessBtn) {
      createAccessBtn.disabled = true;
      createAccessBtn.textContent = "Création...";
    }

    const accessCount = await countManagerAccesses(managerUid);
    if (accessCount >= 10) {
      showToast("Vous avez atteint la limite maximale de 10 accès.", "error");
      return;
    }

    const memberRef = doc(db, "team_accesses", accessId);
    const existing = await getDoc(memberRef);

    if (existing.exists()) {
      showToast("Cet identifiant d'accès existe déjà.", "error");
      return;
    }

    await setDoc(memberRef, {
      accessId,
      firstname,
      lastname,
      company,
      role: "member",
      status: "pending",
      activated: false,
      passwordSet: false,
      createdBy: managerUid,
      createdAt: serverTimestamp()
    });

    showToast(`Accès créé avec succès : ${accessId}`, "success");
    clearCreateAccessForm();

    if (window.TeamManager && typeof window.TeamManager.closeSheet === "function") {
      window.TeamManager.closeSheet("create-access-sheet");
    }
  } catch (error) {
    console.error("Erreur lors de la création de l'accès :", error);
    showToast("Erreur lors de la création de l'accès.", "error");
  } finally {
    if (createAccessBtn) {
      createAccessBtn.disabled = false;
      createAccessBtn.textContent = "Créer l'accès";
    }
  }
}

/* =========================================================
   ACTIVATION DU COMPTE MEMBRE
   IMPORTANT :
   - cette version met seulement à jour Firestore
   - ne stocke PAS le mot de passe en clair
========================================================= */
async function activateMemberAccount(accessId, password, confirmPassword) {
  try {
    const normalizedAccessId = normalizeTextAccessId(accessId);

    if (!normalizedAccessId || !password || !confirmPassword) {
      showToast("Veuillez remplir tous les champs.", "error");
      return { success: false, message: "Veuillez remplir tous les champs." };
    }

    if (password.length < 8) {
      showToast("Le mot de passe doit contenir au moins 8 caractères.", "error");
      return { success: false, message: "Le mot de passe doit contenir au moins 8 caractères." };
    }

    if (password !== confirmPassword) {
      showToast("Les mots de passe ne correspondent pas.", "error");
      return { success: false, message: "Les mots de passe ne correspondent pas." };
    }

    const memberRef = doc(db, "team_accesses", normalizedAccessId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      showToast("Identifiant d'accès introuvable.", "error");
      return { success: false, message: "Identifiant d'accès introuvable." };
    }

    const memberData = memberSnap.data();

    if (memberData.activated === true) {
      showToast("Ce compte est déjà activé.", "error");
      return { success: false, message: "Ce compte est déjà activé." };
    }

    await updateDoc(memberRef, {
      activated: true,
      passwordSet: true,
      status: "active",
      activatedAt: serverTimestamp()
    });

    showToast("Compte activé avec succès.", "success");
    return { success: true };
  } catch (error) {
    console.error("Erreur lors de l'activation du compte :", error);
    showToast("Erreur lors de l'activation du compte.", "error");
    return { success: false, message: "Erreur lors de l'activation du compte." };
  }
}

/* =========================================================
   SUPPRESSION D'UN ACCES MEMBRE
========================================================= */
async function deleteMemberAccess(accessId) {
  try {
    const managerUid = getCurrentManagerUid();

    if (!managerUid) {
      showToast("Vous devez être connecté.", "error");
      return;
    }

    const normalizedAccessId = normalizeTextAccessId(accessId);
    const memberRef = doc(db, "team_accesses", normalizedAccessId);
    const memberSnap = await getDoc(memberRef);

    if (!memberSnap.exists()) {
      showToast("Accès introuvable.", "error");
      return;
    }

    const data = memberSnap.data();

    if (data.createdBy !== managerUid) {
      showToast("Vous n'êtes pas autorisé à supprimer cet accès.", "error");
      return;
    }

    await deleteDoc(memberRef);
    showToast("Accès supprimé avec succès.", "success");
  } catch (error) {
    console.error("Erreur suppression accès :", error);
    showToast("Erreur lors de la suppression.", "error");
  }
}

/* =========================================================
   VERIFIER SI UN ACCES EXISTE
========================================================= */
async function checkMemberAccessExists(accessId) {
  try {
    const normalizedAccessId = normalizeTextAccessId(accessId);
    const memberRef = doc(db, "team_accesses", normalizedAccessId);
    const snap = await getDoc(memberRef);

    if (!snap.exists()) {
      return { exists: false, data: null };
    }

    return { exists: true, data: snap.data() };
  } catch (error) {
    console.error("Erreur vérification accès :", error);
    return { exists: false, data: null };
  }
}

/* =========================================================
   BIND EVENTS CREATION
========================================================= */
if (firstnameInput) firstnameInput.addEventListener("input", updateAccessPreview);
if (lastnameInput) lastnameInput.addEventListener("input", updateAccessPreview);
if (companyInput) companyInput.addEventListener("input", updateAccessPreview);

if (createAccessBtn) {
  createAccessBtn.addEventListener("click", createMemberAccess);
}

/* =========================================================
   BIND EVENTS ACTIVATION
========================================================= */
if (activateAccessBtn) {
  activateAccessBtn.addEventListener("click", async () => {
    setActivationError("");

    const accessId = activationAccessIdInput?.value || "";
    const password = activationPasswordInput?.value || "";
    const confirmPassword = activationConfirmPasswordInput?.value || "";

    if (activateAccessBtn) {
      activateAccessBtn.disabled = true;
      activateAccessBtn.textContent = "Activation...";
    }

    const result = await activateMemberAccount(accessId, password, confirmPassword);

    if (!result.success) {
      setActivationError(result.message || "Erreur lors de l'activation.");
    } else {
      setActivationError("");
      clearActivationForm();

      // Redirection optionnelle
      // window.location.href = "/login";
    }

    if (activateAccessBtn) {
      activateAccessBtn.disabled = false;
      activateAccessBtn.textContent = "Activer mon compte →";
    }
  });
}

/* =========================================================
   INIT
========================================================= */
updateAccessPreview();
setActivationError("");

/* =========================================================
   EXPOSER GLOBALEMENT SI BESOIN
========================================================= */
window.MemberAccessManager = {
  createMemberAccess,
  activateMemberAccount,
  deleteMemberAccess,
  checkMemberAccessExists,
  buildAccessId,
  normalizeTextAccessId
};
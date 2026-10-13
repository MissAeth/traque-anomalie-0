/**
 * Traque : Anomalie 0 — système Foundry VTT (v13 / v14)
 */
import { AMORCE_BIS, construirePioche, phaseDe, indexPhase } from "./pioche.mjs";

const SYS = "traque-anomalie-0";
const CHEMIN = `systems/${SYS}`;
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const esc = (t) => Handlebars.escapeExpression(t ?? "");

let DONNEES = null; // contenu de data/cartes.json

/* -------------------------------------------- */
/*  Modèle de données du personnage             */
/* -------------------------------------------- */

class PersonnageData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const f = foundry.data.fields;
    return {
      objetFetiche: new f.StringField({ initial: "" }),
      objetDetruit: new f.BooleanField({ initial: false }),
      souffle: new f.SchemaField({
        value: new f.NumberField({ integer: true, min: 0, max: 3, initial: 3 }),
        max: new f.NumberField({ integer: true, initial: 3 })
      }),
      etat: new f.StringField({ initial: "vivant", choices: ["vivant", "spectre"] })
    };
  }

  /** Les anciennes fiches « n'est plus » deviennent des Spectres. */
  static migrateData(source) {
    if (source.etat === "mort") source.etat = "spectre";
    return super.migrateData(source);
  }
}

const ETATS = { vivant: "Survivant", spectre: "Spectre" };

/* -------------------------------------------- */
/*  Outils                                      */
/* -------------------------------------------- */

const getEtat = () => game.settings.get(SYS, "etatPioche") ?? {};
const getCarte = (n) => DONNEES?.cartes.find(c => c.numero === n);
const getPhase = (id) => DONNEES?.phases.find(p => p.id === id);
const personnages = () => game.actors.filter(a => a.type === "personnage");

/** Personnages qui participent à la traque en cours (tous si aucune partie lancée avec sélection). */
function participants(etat = getEtat()) {
  if (!etat.participants?.length) return personnages();
  return etat.participants.map(id => game.actors.get(id)).filter(a => a?.type === "personnage");
}
const survivants = () => participants().filter(a => a.system.etat === "vivant");

function indexPhaseActuelle() {
  const p = getEtat().phase;
  return p ? indexPhase(DONNEES, p) : 0;
}

/** Ordre de passage : uniquement les participants, dans l'ordre choisi en début de partie. */
function ordreJoueurs(etat = getEtat()) {
  return participants(etat).map(a => a.id);
}

function prochainJoueur(etat = getEtat()) {
  const ordre = ordreJoueurs(etat);
  if (!ordre.length) return null;
  const debut = etat.tour ?? 0;
  return game.actors.get(ordre[debut % ordre.length]) ?? null;
}

async function message(contenu, actor = null) {
  return ChatMessage.create({
    content: `<div class="traque-msg">${contenu}</div>`,
    speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: "Traque : Anomalie 0" },
    flags: { [SYS]: { info: true } }
  });
}

/* -------------------------------------------- */
/*  Règles de survie                            */
/* -------------------------------------------- */

/** Fixe le Souffle d'un personnage : à 0 il devient Spectre, au-dessus il redevient Survivant. */
async function majSouffle(actor, valeur, { annoncer = true } = {}) {
  const avant = actor.system.souffle.value;
  valeur = Math.clamp(valeur, 0, 3);
  if (valeur === avant) return;
  const maj = { "system.souffle.value": valeur };
  let nouvelEtat = null;
  if (valeur === 0 && actor.system.etat !== "spectre") nouvelEtat = "spectre";
  else if (valeur > 0 && actor.system.etat === "spectre") nouvelEtat = "vivant"; // correction manuelle
  if (nouvelEtat) maj["system.etat"] = nouvelEtat;
  await actor.update(maj);
  if (!annoncer) return;
  const n = avant - valeur;
  if (n > 0) {
    await message(`<p><strong>${esc(actor.name)}</strong> noircit ${n} Souffle${n > 1 ? "s" : ""} `
      + `<span class="traque-reste">(reste ${valeur}/3)</span>.</p>`, actor);
  }
  if (nouvelEtat === "spectre") {
    await message(`<div class="traque-bandeau spectre"><i class="fa-solid fa-ghost"></i> ${esc(actor.name)} devient un Spectre</div>`
      + `<p>Désormais, ${esc(actor.name)} joue la version Spectre des cartes qu'il pioche.</p>`, actor);
  }
}

async function perdreSouffle(actor, n) {
  if (!actor || actor.system.etat !== "vivant") return;
  await majSouffle(actor, actor.system.souffle.value - n);
}

async function detruireObjet(actor) {
  if (actor.system.objetDetruit) {
    await message(`<p><strong>${esc(actor.name)}</strong> n'a plus d'objet fétiche à sacrifier.</p>`, actor);
    return false;
  }
  await actor.update({ "system.objetDetruit": true });
  const objet = actor.system.objetFetiche || "son objet fétiche";
  await message(`<p><strong>${esc(actor.name)}</strong> perd <em>${esc(objet)}</em> à jamais.</p>`, actor);
  return true;
}

/* -------------------------------------------- */
/*  Actions exécutées par le MJ (via socket)    */
/* -------------------------------------------- */

let file = Promise.resolve();
const enFile = (fn) => (file = file.then(fn).catch(err => console.error(`${SYS} |`, err)));

const ACTIONS_MJ = {
  async piocher({ actorId }) {
    const etat = foundry.utils.deepClone(getEtat());
    const actor = game.actors.get(actorId);
    if (!actor) return;
    if (!ordreJoueurs(etat).includes(actor.id)) return; // ne participe pas à cette traque
    if (!etat.pile?.length) return;
    if (Date.now() < (etat.sasFin ?? 0) - 1000) return; // SAS en cours

    const entree = etat.pile.shift();
    const phase = phaseDe(DONNEES, entree);
    if (phase !== etat.phase) {
      etat.phase = phase;
      await annoncerPhase(phase);
    }

    let carte, bis = false;
    if (entree === AMORCE_BIS) {
      const resolues = etat.defausse.filter(n => phaseDe(DONNEES, n) === "miseEnPlace" && n !== AMORCE_BIS);
      carte = getCarte(resolues[Math.floor(Math.random() * resolues.length)]);
      bis = true;
    } else carte = getCarte(entree);

    etat.defausse.push(entree);
    const ordre = ordreJoueurs(etat);
    etat.tour = ordre.indexOf(actor.id) + 1;
    etat.derniere = { numero: carte.numero, titre: carte.titre, acteur: actor.name };
    etat.sasFin = Date.now() + game.settings.get(SYS, "dureeSas") * 1000;
    await game.settings.set(SYS, "etatPioche", etat);
    await posterCarte(carte, actor, { bis, derniere: etat.pile.length === 0 });
  },

  async effet({ messageId, type, valeur, label, piocheurId, cibleId }) {
    const msg = game.messages.get(messageId);
    if (!msg || msg.getFlag(SYS, "resolu")) return;
    const piocheur = game.actors.get(piocheurId);
    const cible = cibleId ? game.actors.get(cibleId) : null;
    let ok = true;
    switch (type) {
      case "souffle": await perdreSouffle(piocheur, valeur); break;
      case "objet": ok = await detruireObjet(piocheur); break;
      case "tous": for (const a of survivants()) await perdreSouffle(a, valeur); break;
      case "cible": await perdreSouffle(cible, valeur); break;
      case "allieSouffle": await perdreSouffle(piocheur, valeur); await perdreSouffle(cible, valeur); break;
      case "allieObjet": ok = await detruireObjet(cible); break;
    }
    if (ok) await msg.setFlag(SYS, "resolu", label + (cible ? ` (${cible.name})` : ""));
  },

  async leverSas() {
    const etat = foundry.utils.deepClone(getEtat());
    etat.sasFin = 0;
    await game.settings.set(SYS, "etatPioche", etat);
  }
};

function executer(action, data = {}) {
  const mj = game.users.activeGM;
  if (!mj) return ui.notifications.warn("Un utilisateur Gamemaster doit être connecté pour gérer la pioche.");
  if (mj.isSelf) return enFile(() => ACTIONS_MJ[action](data));
  game.socket.emit(`system.${SYS}`, { action, data });
}

/* -------------------------------------------- */
/*  Messages de chat : cartes                   */
/* -------------------------------------------- */

async function annoncerPhase(phaseId) {
  const p = getPhase(phaseId);
  if (!p) return;
  await message(`<div class="traque-bandeau phase"><i class="${p.icone}"></i> ${esc(p.nom)} — ${esc(p.sousTitre)}</div>`
    + (p.annonce ? `<p class="traque-annonce">${esc(p.annonce)}</p>` : ""));
}

async function posterCarte(carte, actor, { bis = false, derniere = false } = {}) {
  const phase = getPhase(carte.phase);
  const estSpectre = actor.system.etat === "spectre";
  const cote = estSpectre && carte.spectre ? "spectre" : "survivant";
  const effets = carte.effets?.[cote] ?? [];
  const nb = game.settings.get(SYS, "nbJoueurs");

  let html = `<div class="traque-carte phase-${carte.phase} ${cote}">
    <header><span class="traque-num">${bis ? "↺" : carte.numero}</span>
      <h3>${esc(carte.titre)}</h3><i class="${phase.icone}"></i></header>
    <div class="traque-phase">${esc(phase.nom)} — ${esc(phase.sousTitre)}</div>`;
  if (bis) html += `<div class="traque-note">Amorce déjà résolue : reprends-la et <strong>ajoutes-y un détail</strong>.</div>`;
  if (carte.spectre) html += `<div class="traque-cote">${cote === "spectre" ? "Version Spectre" : "Version Survivant"}</div>`;
  if (estSpectre && !carte.spectre) html += `<div class="traque-note">Pas de version Spectre pour cette carte : interprète-la depuis l'au-delà.</div>`;
  html += `<div class="traque-texte">${carte.consigne ? `<p class="traque-consigne">${carte.consigne}</p>` : ""}<p>${carte[cote]}</p></div>`;
  if (carte.note5joueurs && nb === 5) html += `<div class="traque-note">${carte.note5joueurs}</div>`;
  if (effets.length) {
    html += `<div class="traque-effets"><div class="traque-effets-titre">${effets.length > 1 ? "Ton choix" : "Coût"}</div>`;
    for (const e of effets) {
      html += `<button type="button" class="traque-effet" data-type="${e.type}" data-valeur="${e.valeur ?? 1}" data-label="${esc(e.label)}">${esc(e.label)}</button>`;
    }
    html += `</div>`;
  }
  html += `<footer class="traque-sas"><strong>SAS</strong> — la parole est à toute la table, en jeu, pendant 2 à 3 minutes. Oui, et… On ne pioche pas tout de suite la carte suivante !</footer>`;
  if (derniere) html += `<div class="traque-note">Dernière carte. Après le SAS, le MJ clique sur <strong>Fin de partie</strong> dans le panneau de pioche.</div>`;
  html += `</div>`;

  return ChatMessage.create({
    content: html,
    speaker: ChatMessage.getSpeaker({ actor }),
    flags: { [SYS]: { piocheur: actor.id, carte: carte.numero, cote, effets } }
  });
}

async function choisirPersonnage(candidats, titre) {
  if (!candidats.length) {
    ui.notifications.warn("Aucun personnage ne peut être choisi.");
    return null;
  }
  const options = candidats.map(a => `<option value="${a.id}">${esc(a.name)} (${a.system.souffle.value}/3)</option>`).join("");
  return DialogV2.prompt({
    window: { title: titre },
    classes: ["traque"],
    content: `<div class="form-group"><label>Personnage</label><select name="cible">${options}</select></div>`,
    ok: { label: "Valider", callback: (event, button) => button.form.elements.cible.value },
    rejectClose: false
  });
}

/** Un choix est-il encore possible pour ce personnage ? */
function choixDisponible(effet, piocheur) {
  if (effet.type === "objet") return !piocheur?.system.objetDetruit;
  if (effet.type === "allieObjet") return survivants().some(a => a.id !== piocheur?.id && !a.system.objetDetruit);
  if (effet.type === "allieSouffle") return survivants().some(a => a.id !== piocheur?.id);
  return true;
}

/** Applique un choix de carte (depuis le chat ou la fenêtre de choix). Renvoie true si appliqué. */
async function appliquerChoix(msg, effet) {
  const piocheur = game.actors.get(msg.getFlag(SYS, "piocheur"));
  if (!piocheur) return false;
  if (!piocheur.isOwner) { ui.notifications.warn(`C'est à ${piocheur.name} de faire ce choix.`); return false; }
  if (msg.getFlag(SYS, "resolu")) return false;
  const { type, label } = effet;
  let cibleId = null;
  if (type === "cible") {
    cibleId = await choisirPersonnage(survivants(), label);
  } else if (type === "allieSouffle") {
    cibleId = await choisirPersonnage(survivants().filter(a => a.id !== piocheur.id), "Quel allié t'accompagne ?");
  } else if (type === "allieObjet") {
    cibleId = await choisirPersonnage(
      survivants().filter(a => a.id !== piocheur.id && !a.system.objetDetruit), "Quel allié sacrifie son objet ?");
  }
  if (["cible", "allieSouffle", "allieObjet"].includes(type) && !cibleId) return false;
  executer("effet", {
    messageId: msg.id, type, valeur: Number(effet.valeur) || 1,
    label, piocheurId: piocheur.id, cibleId
  });
  return true;
}

async function onClicEffet(msg, bouton) {
  const ok = await appliquerChoix(msg, {
    type: bouton.dataset.type, valeur: bouton.dataset.valeur, label: bouton.dataset.label
  });
  if (ok) bouton.closest(".traque-effets")?.querySelectorAll("button").forEach(b => (b.disabled = true));
}

/** Utilisateur qui doit recevoir la fenêtre de choix : le joueur du personnage, sinon le MJ. */
function decideur(actor) {
  const joueurs = game.users.filter(u => u.active && !u.isGM
    && actor.testUserPermission(u, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER));
  return joueurs.find(u => u.character?.id === actor.id) ?? joueurs[0] ?? game.users.activeGM;
}

/** Fenêtre qui s'ouvre chez celui qui a pioché, avec un bouton par choix. */
async function proposerChoix(msg) {
  const effets = msg.getFlag(SYS, "effets");
  const piocheur = game.actors.get(msg.getFlag(SYS, "piocheur"));
  if (!effets?.length || !piocheur || msg.getFlag(SYS, "resolu")) return;
  if (decideur(piocheur)?.id !== game.user.id) return;

  const possibles = effets.filter(e => choixDisponible(e, piocheur));
  if (!possibles.length) return;
  const carte = getCarte(msg.getFlag(SYS, "carte"));
  const texte = carte?.[msg.getFlag(SYS, "cote")] ?? "";
  const unSeul = effets.length === 1;

  const index = await DialogV2.wait({
    window: { title: `${carte?.titre ?? "Carte"} — ${piocheur.name}`, icon: "fa-solid fa-hand" },
    classes: ["traque", "traque-choix"],
    position: { width: 420 },
    content: `<div class="traque-choix-texte">${texte}</div>
      <p class="traque-choix-question">${unSeul ? "Coût à appliquer :" : "Que choisis-tu ?"}</p>`,
    buttons: [
      ...possibles.map((e, i) => ({
        action: `choix${i}`, label: e.label, default: i === 0,
        icon: ["objet", "allieObjet"].includes(e.type) ? "fa-solid fa-heart-crack" : "fa-solid fa-lungs",
        callback: () => i
      })),
      { action: "plusTard", label: "Plus tard (dans le chat)", icon: "fa-solid fa-clock", callback: () => null }
    ],
    rejectClose: false
  });
  if (index === null || index === undefined) return;
  await appliquerChoix(msg, possibles[index]);
}

function decorerMessage(msg, html) {
  const zone = html.querySelector(".traque-effets");
  if (!zone) return;
  const resolu = msg.getFlag(SYS, "resolu");
  const piocheur = game.actors.get(msg.getFlag(SYS, "piocheur"));
  if (resolu) {
    zone.querySelectorAll("button").forEach(b => (b.disabled = true));
    zone.insertAdjacentHTML("beforeend", `<div class="traque-resolu"><i class="fa-solid fa-check"></i> ${esc(resolu)}</div>`);
    return;
  }
  for (const b of zone.querySelectorAll("button")) {
    if (!choixDisponible({ type: b.dataset.type }, piocheur)) {
      b.disabled = true;
      b.title = "Objet fétiche déjà détruit";
    }
    if (!piocheur?.isOwner) b.disabled = true;
    b.addEventListener("click", (ev) => { ev.preventDefault(); onClicEffet(msg, b); });
  }
}

/* -------------------------------------------- */
/*  Fiche de personnage                         */
/* -------------------------------------------- */

class FicheSurvie extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["traque", "traque-fiche"],
    position: { width: 400, height: "auto" },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      noircir: FicheSurvie.#noircir,
      reinitialiser: FicheSurvie.#reinitialiser
    }
  };

  static PARTS = { fiche: { template: `${CHEMIN}/templates/fiche.hbs` } };

  async _prepareContext(options) {
    const ctx = await super._prepareContext(options);
    const s = this.document.system;
    const perdus = 3 - s.souffle.value;
    return Object.assign(ctx, {
      actor: this.document,
      system: s,
      editable: this.isEditable,
      isGM: game.user.isGM,
      coches: [1, 2, 3].map(i => ({ index: i, noircie: i <= perdus })),
      etats: ETATS,
      etatLabel: ETATS[s.etat]
    });
  }

  static async #noircir(event, target) {
    if (!this.isEditable) return;
    const i = Number(target.dataset.index);
    const perdus = 3 - this.document.system.souffle.value;
    const nouveauxPerdus = i <= perdus ? i - 1 : i;
    await majSouffle(this.document, 3 - nouveauxPerdus);
  }

  static async #reinitialiser() {
    if (!this.isEditable) return;
    await this.document.update({ "system.souffle.value": 3, "system.objetDetruit": false, "system.etat": "vivant" });
  }
}

/* -------------------------------------------- */
/*  Panneau de pioche                           */
/* -------------------------------------------- */

class PanneauPioche extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "traque-panneau",
    classes: ["traque", "traque-panneau"],
    window: { title: "Traque : la pioche", icon: "fa-solid fa-layer-group" },
    position: { width: 320, height: "auto", top: 70, left: 110 },
    actions: {
      piocher: PanneauPioche.#piocher,
      nouvellePartie: PanneauPioche.#nouvellePartie,
      leverSas: PanneauPioche.#leverSas,
      finPartie: PanneauPioche.#finPartie
    }
  };

  static PARTS = { panneau: { template: `${CHEMIN}/templates/panneau.hbs` } };

  _selection = null;
  _tic = null;

  async _prepareContext() {
    if (!DONNEES) return { chargement: true };
    const etat = getEtat();
    const pile = etat.pile ?? [];
    const defausse = etat.defausse ?? [];
    const iActuelle = etat.phase ? indexPhase(DONNEES, etat.phase) : -1;
    const phases = DONNEES.phases.map((p, i) => {
      const restantes = pile.filter(n => phaseDe(DONNEES, n) === p.id).length;
      let statut = "a-venir";
      if (i < iActuelle || (i === iActuelle && !restantes && !pile.length)) statut = "faite";
      else if (i === iActuelle) statut = "en-cours";
      return { ...p, restantes, statut };
    });

    const eligibles = participants(etat).filter(a => game.user.isGM || a.isOwner);
    const prochain = prochainJoueur(etat);
    let choix = eligibles.find(a => a.id === this._selection)
      ?? (game.user.character && eligibles.find(a => a.id === game.user.character.id))
      ?? (prochain && eligibles.find(a => a.id === prochain.id))
      ?? eligibles[0];

    const restantSas = Math.max(0, Math.ceil(((etat.sasFin ?? 0) - Date.now()) / 1000));
    const sasActif = restantSas > 0;
    const enCours = pile.length > 0 || defausse.length > 0;

    return {
      isGM: game.user.isGM,
      nbJoueurs: game.settings.get(SYS, "nbJoueurs"),
      enCours,
      termine: enCours && !pile.length,
      terminee: !!etat.terminee,
      phases,
      restantes: pile.length,
      derniere: etat.derniere,
      prochain: prochain?.name,
      acteurs: eligibles.map(a => ({ id: a.id, name: a.name, selected: a.id === choix?.id, spectre: a.system.etat === "spectre" })),
      sasActif,
      sasTexte: `${Math.floor(restantSas / 60)}:${String(restantSas % 60).padStart(2, "0")}`,
      peutPiocher: pile.length > 0 && !!choix && !sasActif
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    clearTimeout(this._tic);
    if (context.sasActif) this._tic = setTimeout(() => this.rendered && this.render(), 1000);
    this.element.querySelector("select[name=acteur]")?.addEventListener("change", ev => {
      this._selection = ev.currentTarget.value;
    });
  }

  _onClose(options) {
    clearTimeout(this._tic);
    super._onClose?.(options);
  }

  static #piocher() {
    const id = this.element.querySelector("select[name=acteur]")?.value;
    if (!id) return;
    if (game.user.isGM) this._selection = null; // le MJ suit ensuite l'ordre de passage
    executer("piocher", { actorId: id });
  }

  static #leverSas() {
    executer("leverSas");
  }

  static async #finPartie() {
    if (!game.user.isGM) return;
    const etat = getEtat();
    const joueurs = participants(etat);
    const groupes = { vivant: [], spectre: [] };
    for (const a of joueurs) groupes[a.system.etat]?.push(a);

    const ligne = (a) => {
      const s = a.system;
      const objet = s.objetFetiche ? esc(s.objetFetiche) : "<em>sans objet</em>";
      const etatObjet = s.objetDetruit ? `<s>${objet}</s> (perdu)` : `${objet} (intact)`;
      const souffle = "●".repeat(3 - s.souffle.value) + "○".repeat(s.souffle.value);
      return `<li><strong>${esc(a.name)}</strong> <span class="traque-souffle">${souffle}</span><br><span class="traque-reste">${etatObjet}</span></li>`;
    };
    const bloc = (titre, icone, liste, classe) => liste.length
      ? `<div class="traque-bilan-groupe ${classe}"><h4><i class="${icone}"></i> ${titre}</h4><ul>${liste.map(ligne).join("")}</ul></div>`
      : "";

    const issue = groupes.vivant.length
      ? `${groupes.vivant.length} rescapé${groupes.vivant.length > 1 ? "s" : ""} sur ${joueurs.length}.`
      : "Personne n'en est sorti vivant.";

    await message(`<div class="traque-bandeau fin"><i class="fa-solid fa-flag-checkered"></i> Fin de partie</div>
      <p class="traque-annonce">${issue}</p>
      ${bloc("Rescapés", "fa-solid fa-person-running", groupes.vivant, "vivant")}
      ${bloc("Spectres", "fa-solid fa-ghost", groupes.spectre, "spectre")}      <p class="traque-reste">Merci d'avoir joué à Traque : Anomalie 0.</p>`);

    // On clôt la traque en gardant les participants pour proposer les mêmes à la prochaine partie.
    await game.settings.set(SYS, "etatPioche", { participants: etat.participants ?? [], terminee: true });
  }

  static async #nouvellePartie() {
    if (!game.user.isGM) return;
    const tous = personnages();
    if (tous.length < 3) {
      return ui.notifications.warn("Il faut au moins 3 fiches de personnage pour lancer une traque.");
    }
    const actuel = game.settings.get(SYS, "nbJoueurs");
    const precedents = getEtat().participants ?? [];
    // Ordre proposé : participants de la partie précédente, puis fiches de joueurs, puis le reste.
    const rang = (a) => (precedents.includes(a.id) ? 0 : a.hasPlayerOwner ? 1 : 2);
    const listes = [...tous].sort((a, b) => rang(a) - rang(b) || a.name.localeCompare(b.name));
    const options = [3, 4, 5].map(n => `<option value="${n}" ${n === actuel ? "selected" : ""}>${n} joueurs</option>`).join("");
    const cases = listes.map((a, i) => `<label class="traque-case">
        <input type="checkbox" name="perso" value="${a.id}" ${i < actuel ? "checked" : ""}> ${esc(a.name)}</label>`).join("");

    const synchroniser = (racine, depuisMenu) => {
      const nb = Number(racine.querySelector("select[name=nb]").value);
      const boites = [...racine.querySelectorAll("input[name=perso]")];
      if (depuisMenu) boites.forEach((b, i) => (b.checked = i < nb));
      const coches = boites.filter(b => b.checked).length;
      const info = racine.querySelector(".traque-compte");
      info.textContent = `${coches} / ${nb} personnages cochés`;
      info.classList.toggle("erreur", coches !== nb);
      const ok = racine.querySelector("button[data-action=ok]");
      if (ok) ok.disabled = coches !== nb;
    };

    const choix = await DialogV2.prompt({
      window: { title: "Nouvelle traque", icon: "fa-solid fa-shuffle" },
      classes: ["traque", "traque-nouvelle-partie"],
      content: `<div class="form-group"><label>Nombre de joueurs</label><select name="nb">${options}</select></div>
        <p class="traque-aide">3 : cartes 4 et 24 retirées + une carte au hasard par Acte.
        5 : une amorce rejouée et le 5e joueur intervient sur la carte 26.</p>
        <fieldset class="traque-participants"><legend>Qui joue ?</legend>${cases}
          <p class="traque-compte"></p></fieldset>
        <label class="traque-case"><input type="checkbox" name="reinit" checked> Remettre les fiches des participants à zéro (3 Souffle, objet intact, survivant)</label>`,
      ok: {
        label: "Mélanger", icon: "fa-solid fa-shuffle",
        callback: (event, button) => {
          const f = button.form.elements;
          const ids = [...button.form.querySelectorAll("input[name=perso]:checked")].map(b => b.value);
          return { nb: Number(f.nb.value), reinit: f.reinit.checked, ids };
        }
      },
      render: (event, dialog) => {
        const racine = dialog.element;
        racine.querySelector("select[name=nb]").addEventListener("change", () => synchroniser(racine, true));
        racine.querySelectorAll("input[name=perso]").forEach(b => b.addEventListener("change", () => synchroniser(racine, false)));
        synchroniser(racine, false);
      },
      rejectClose: false
    });
    if (!choix) return;
    const { nb, reinit, ids } = choix;
    if (ids.length !== nb) {
      return ui.notifications.error(`Coche exactement ${nb} personnages (${ids.length} cochés).`);
    }
    if (nb !== actuel) await game.settings.set(SYS, "nbJoueurs", nb);
    if (reinit) {
      for (const id of ids) {
        await game.actors.get(id)?.update({ "system.souffle.value": 3, "system.objetDetruit": false, "system.etat": "vivant" });
      }
    }
    const etat = {
      pile: construirePioche(DONNEES, nb),
      defausse: [],
      phase: null,
      derniere: null,
      tour: 0,
      participants: ids,
      sasFin: 0
    };
    await game.settings.set(SYS, "etatPioche", etat);
    await message(`<div class="traque-bandeau phase"><i class="fa-solid fa-shuffle"></i> Une nouvelle traque commence</div>
      <p>${etat.pile.length} cartes pour ${nb} joueurs : ${ids.map(id => `<strong>${esc(game.actors.get(id)?.name)}</strong>`).join(", ")}.</p>
      <p>Chacun pioche à son tour, décrit l'action, subit les coûts et répond à la question.</p>
      <p><strong>Oui, et…</strong> On accepte toujours la description et les choix des autres, et on les enrichit pendant le SAS.</p>`);
  }
}

/* -------------------------------------------- */
/*  Initialisation                              */
/* -------------------------------------------- */

Hooks.once("init", () => {
  CONFIG.Actor.dataModels.personnage = PersonnageData;
  CONFIG.Actor.typeLabels = { ...(CONFIG.Actor.typeLabels ?? {}), personnage: "Personnage" };

  const DSC = foundry.applications.apps?.DocumentSheetConfig;
  if (DSC?.registerSheet) {
    DSC.registerSheet(Actor, SYS, FicheSurvie, { types: ["personnage"], makeDefault: true, label: "Feuille de survie" });
  } else {
    foundry.documents.collections.Actors.registerSheet(SYS, FicheSurvie, { types: ["personnage"], makeDefault: true, label: "Feuille de survie" });
  }

  const rafraichir = () => game.traque?.panneau?.rendered && game.traque.panneau.render();

  game.settings.register(SYS, "nbJoueurs", {
    name: "Nombre de joueurs",
    hint: "3 joueurs : les cartes 4 et 24 et une carte au hasard par Acte sont retirées. 5 joueurs : le 5e pioche une amorce déjà résolue et intervient sur la carte 26. S'applique à la prochaine « Nouvelle partie ».",
    scope: "world",
    config: true,
    type: Number,
    choices: { 3: "3 joueurs", 4: "4 joueurs", 5: "5 joueurs" },
    default: 4,
    onChange: rafraichir
  });

  game.settings.register(SYS, "dureeSas", {
    name: "Durée du SAS (secondes)",
    hint: "Temps pendant lequel la pioche est bloquée après chaque carte, pour laisser la table réagir. 0 pour désactiver.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 0, max: 300, step: 15 },
    default: 150,
    onChange: rafraichir
  });

  game.settings.register(SYS, "etatPioche", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: rafraichir
  });
});

Hooks.once("ready", async () => {
  try {
    DONNEES = await (await fetch(`${CHEMIN}/data/cartes.json`)).json();
  } catch (err) {
    console.error(`${SYS} | Impossible de charger data/cartes.json`, err);
    ui.notifications.error("Traque : impossible de charger les cartes (data/cartes.json).");
  }

  game.traque = {
    panneau: new PanneauPioche(),
    ouvrir() { return this.panneau.render({ force: true }); }
  };

  game.socket.on(`system.${SYS}`, ({ action, data }) => {
    if (game.users.activeGM?.isSelf && ACTIONS_MJ[action]) enFile(() => ACTIONS_MJ[action](data));
  });

  game.traque.ouvrir();
});

Hooks.on("preCreateActor", (actor) => {
  if (actor.type !== "personnage") return;
  actor.updateSource({ "prototypeToken.actorLink": true, "prototypeToken.bar1.attribute": "souffle" });
});

const rafraichirPanneau = foundry.utils.debounce(() => {
  if (game.traque?.panneau?.rendered) game.traque.panneau.render();
}, 100);
Hooks.on("updateActor", rafraichirPanneau);
Hooks.on("createActor", rafraichirPanneau);
Hooks.on("deleteActor", rafraichirPanneau);

Hooks.on("renderChatMessageHTML", (msg, html) => {
  if (msg.flags?.[SYS] || html.querySelector?.(".traque-carte, .traque-msg")) html.classList.add("traque-chat");
  decorerMessage(msg, html);
});
Hooks.on("createChatMessage", (msg) => { proposerChoix(msg); });

/* Bannière de pause aux couleurs de la traque */
Hooks.on("renderGamePause", (app, html) => {
  const el = (html instanceof HTMLElement ? html : html?.[0]) ?? document.getElementById("pause");
  if (!el) return;
  el.classList.add("traque-pause");
  el.classList.toggle("traque-masquee", !game.paused);
  el.innerHTML = `
    <div class="tq-pause-souffle" aria-hidden="true"><span></span><span></span><span></span></div>
    <figcaption>La traque est suspendue</figcaption>
    <p class="tq-pause-sous">Retenez votre souffle…</p>`;
});

/* Masque / affiche la bannière à chaque pause ou reprise (barre d'espace) */
Hooks.on("pauseGame", (enPause) => {
  document.getElementById("pause")?.classList.toggle("traque-masquee", !enPause);
});

Hooks.on("renderActorDirectory", (app, html) => {
  const racine = html instanceof HTMLElement ? html : html[0];
  if (!racine || racine.querySelector(".traque-ouvrir")) return;
  const zone = racine.querySelector(".header-actions") ?? racine.querySelector(".directory-header");
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "traque-ouvrir";
  bouton.innerHTML = `<i class="fa-solid fa-layer-group"></i> Pioche de la traque`;
  bouton.addEventListener("click", () => game.traque?.ouvrir());
  zone?.append(bouton);
});
